// vault-sync.js · write notes into a user-picked directory.
//
// The directory handle is stored in IndexedDB (chrome.storage cannot clone a
// FileSystemDirectoryHandle). Permission is granted on the options page, from
// a click. Autosave then asks the service worker to createWritable().
// Chrome can use a stored handle from a service worker after that grant.
// If queryPermission is not "granted" there, we ask the options page (when it
// is open) to write, and otherwise skip. A failed vault write must never
// reject the caller's autosave — writeNote always returns a result object.
//
// Limitation: requestPermission() needs a user gesture in an extension page.
// A content script cannot prompt on each keystroke. Use Options → Reconnect
// folder if writes start being skipped.

const VAULT_DB = 'quick-notes-fs';
const VAULT_STORE = 'handles';
const VAULT_KEY = 'vault-dir';

let lastVaultWarn = '';

function warnVault(message) {
  if (message === lastVaultWarn) return;
  lastVaultWarn = message;
  console.warn('[QuickNotes Vault]', message);
}

function openVaultDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VAULT_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VAULT_STORE)) db.createObjectStore(VAULT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function idbGet() {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readonly');
    const req = tx.objectStore(VAULT_STORE).get(VAULT_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
  });
}

async function idbSet(handle) {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readwrite');
    tx.objectStore(VAULT_STORE).put(handle, VAULT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
  });
}

async function idbDelete() {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readwrite');
    tx.objectStore(VAULT_STORE).delete(VAULT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
  });
}

function isSafeVaultFileName(name) {
  return typeof name === 'string'
    && name.length > 3
    && name.length < 180
    && name.endsWith('.md')
    && !/[\\/]/.test(name)
    && name !== '.'
    && name !== '..';
}

async function getHandle() {
  try {
    return await idbGet();
  } catch (e) {
    warnVault('Could not read the saved folder handle: ' + (e && e.message || e));
    return null;
  }
}

async function saveHandle(handle) {
  await idbSet(handle);
  await chrome.storage.local.set({
    vaultFolderName: handle && handle.name || '',
    vaultLastError: null
  });
}

async function forgetHandle() {
  await idbDelete();
  await chrome.storage.local.set({
    vaultFolderName: '',
    vaultLastError: null,
    vaultLastWrite: null
  });
}

async function getStatus() {
  const stored = await chrome.storage.local.get(['vaultFolderName', 'vaultLastError', 'vaultLastWrite']);
  const handle = await getHandle();
  if (!handle) {
    return {
      configured: false,
      name: '',
      permission: 'missing',
      lastError: stored.vaultLastError || '',
      lastWrite: stored.vaultLastWrite || ''
    };
  }
  let permission = 'unknown';
  try {
    permission = await handle.queryPermission({ mode: 'readwrite' });
  } catch (e) {
    permission = 'unsupported';
    warnVault('queryPermission failed: ' + (e && e.message || e));
  }
  return {
    configured: true,
    name: handle.name || stored.vaultFolderName || '',
    permission,
    lastError: stored.vaultLastError || '',
    lastWrite: stored.vaultLastWrite || ''
  };
}

function askOptionsPageToWrite(note) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'vault-write-direct', note: publicNote(note) }, (resp) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(resp || null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function publicNote(note) {
  return {
    id: note.id,
    title: note.title || '',
    content: note.content || '',
    driveFileId: note.driveFileId || null,
    vaultFileName: note.vaultFileName || null
  };
}

const vaultQueue = new Map();

function enqueueVault(noteId, fn) {
  const prev = vaultQueue.get(noteId) || Promise.resolve();
  const run = prev.then(fn, fn);
  vaultQueue.set(noteId, run);
  run.then(() => {
    if (vaultQueue.get(noteId) === run) vaultQueue.delete(noteId);
  }, () => {
    if (vaultQueue.get(noteId) === run) vaultQueue.delete(noteId);
  });
  return run;
}

async function writeNoteNow(note, opts) {
  const options = opts || {};
  if (!note || !note.id) return { ok: false, error: 'missing note' };

  const handle = await getHandle();
  if (!handle) return { ok: true, skipped: true, reason: 'no-folder' };
  if (typeof handle.queryPermission !== 'function' || typeof handle.getFileHandle !== 'function') {
    const message = 'This context cannot use the saved folder handle. Open Options and click Reconnect folder.';
    warnVault(message);
    await chrome.storage.local.set({ vaultLastError: message });
    return { ok: false, skipped: true, reason: 'permission', error: message };
  }

  let permission = 'prompt';
  try {
    permission = await handle.queryPermission({ mode: 'readwrite' });
  } catch (e) {
    const message = 'Could not check folder permission: ' + (e && e.message || e);
    warnVault(message);
    await chrome.storage.local.set({ vaultLastError: message });
    return { ok: false, skipped: true, reason: 'permission', error: message };
  }

  if (permission !== 'granted') {
    const message = 'Folder permission is "' + permission + '", not granted. Open Options and click Reconnect folder. Autosave cannot show the permission prompt.';
    warnVault(message);
    await chrome.storage.local.set({ vaultLastError: message });
    if (options.fallback !== false) {
      const viaOptions = await askOptionsPageToWrite(note);
      if (viaOptions && viaOptions.ok) return viaOptions;
    }
    return { ok: false, skipped: true, reason: 'permission', error: message };
  }

  const meta = self.QN_NoteMeta;
  if (!meta) {
    const message = 'Filename helper is not loaded.';
    warnVault(message);
    return { ok: false, error: message };
  }

  let fresh = note;
  try {
    const data = await chrome.storage.local.get('notes');
    if (Array.isArray(data.notes)) {
      const found = data.notes.find((n) => n && n.id === note.id);
      if (found) fresh = found;
    }
  } catch { /* use the payload we were given */ }

  const ids = self.QN_SyncIds ? await self.QN_SyncIds.getSyncIds(fresh.id) : emptyIds(fresh);
  const fileName = meta.vaultFileName(fresh.title, fresh.id);
  const previous = ids.vaultFileName || fresh.vaultFileName || '';
  const markdown = fresh.content || '';

  try {
    if (previous && previous !== fileName && isSafeVaultFileName(previous)) {
      try { await handle.removeEntry(previous); }
      catch { /* previous file may already be gone */ }
    }
    const fileHandle = await handle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(markdown);
    } finally {
      await writable.close();
    }
  } catch (e) {
    const message = 'Vault write failed: ' + (e && e.message || e);
    warnVault(message);
    await chrome.storage.local.set({ vaultLastError: message });
    return { ok: false, error: message };
  }

  if (self.QN_SyncIds) {
    try { await self.QN_SyncIds.setSyncIds(fresh.id, { vaultFileName: fileName }); }
    catch (e) { warnVault('Saved the file but could not store its name: ' + (e && e.message || e)); }
  }
  await chrome.storage.local.set({
    vaultLastError: null,
    vaultLastWrite: new Date().toISOString(),
    vaultFolderName: handle.name || ''
  });
  return { ok: true, fileName };
}

function emptyIds(note) {
  return {
    driveFileId: note && note.driveFileId || null,
    vaultFileName: note && note.vaultFileName || null
  };
}

function writeNote(note, opts) {
  if (!note || !note.id) return Promise.resolve({ ok: false, error: 'missing note' });
  return enqueueVault(note.id, () => writeNoteNow(note, opts));
}

self.QN_Vault = {
  getHandle,
  saveHandle,
  forgetHandle,
  getStatus,
  writeNote
};
