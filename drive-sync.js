// drive-sync.js · Google Drive sync for Quick Notes
// Auth is unchanged (chrome.identity, with a web-flow fallback). The scope is
// https://www.googleapis.com/auth/drive.file — not drive.appdata.
//
// Notes are Markdown files in a user-chosen folder (parents: [folderId]).
// drive.file can only see files this app created or that the user opened with
// this app, so an arbitrary pasted folder ID fails unless this extension
// created that folder. There is no appDataFolder fallback.
// Each note's Drive file id is kept by sync-ids.js. Later autosaves PATCH that
// file. A 404 clears the stale id by creating a new file and storing the new id.

const DRIVE_API   = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API  = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SYNC_ALARM  = 'qn-auto-sync';

// ----- Auth -----

// Web Application OAuth client ID for launchWebAuthFlow fallback.
// Required on browsers where chrome.identity.getAuthToken is unavailable
// (Edge, Brave, Opera, Vivaldi, Arc — all Chromium but no Chrome account).
// This is a PUBLIC identifier; no client_secret is used (implicit flow).
const WEB_APP_CLIENT_ID = '872447937251-3sfejbbko37mis39mld134jit2uko8as.apps.googleusercontent.com';

async function getAuthTokenNative(interactive) {
  return new Promise((resolve, reject) => {
    if (!chrome.identity || typeof chrome.identity.getAuthToken !== 'function') {
      reject(new Error('getAuthToken not available'));
      return;
    }
    try {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        const err = chrome.runtime.lastError;
        if (err || !token) {
          reject(new Error((err && err.message) || 'no token returned'));
        } else {
          resolve(token);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function getAuthTokenWebFlow(interactive) {
  if (!WEB_APP_CLIENT_ID || WEB_APP_CLIENT_ID.startsWith('YOUR_')) {
    throw new Error('Sign-in in this browser requires a Web Application OAuth client. Please use Chrome, or ask the developer to configure one.');
  }
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', WEB_APP_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', DRIVE_SCOPE);
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive },
      (redirectUrl) => {
        const err = chrome.runtime.lastError;
        if (err || !redirectUrl) {
          reject(new Error((err && err.message) || 'sign-in cancelled'));
          return;
        }
        try {
          const u = new URL(redirectUrl);
          const params = new URLSearchParams(u.hash.slice(1));
          const token = params.get('access_token');
          if (!token) reject(new Error('no access_token in response'));
          else resolve(token);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

async function getAuthToken(interactive = true) {
  // Try the native Chrome path first (best UX, no popup needed in Chrome).
  try {
    return await getAuthTokenNative(interactive);
  } catch (e) {
    const msg = String((e && e.message) || e);
    // Edge (and other Chromium browsers without Chrome account) responds with
    // "This API is not supported on Microsoft Edge" or similar. Fall back to
    // the standard OAuth2 web flow, which works everywhere.
    const isUnsupported = /not supported|not available|Unsupported|Not implemented/i.test(msg);
    if (!isUnsupported) {
      console.warn('[QuickNotes Drive] getAuthToken failed:', msg);
      throw e;
    }
    console.info('[QuickNotes Drive] Native auth unavailable, using web-flow fallback');
    return await getAuthTokenWebFlow(interactive);
  }
}

async function revokeAuthToken() {
  try {
    const token = await getAuthToken(false);
    // removeCachedAuthToken only exists when native path is used
    if (chrome.identity && typeof chrome.identity.removeCachedAuthToken === 'function') {
      await new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token }, resolve));
    }
    // Revoke on Google's side — works for both flows
    try {
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
    } catch {}
  } catch {}
}

// ----- Drive REST helpers -----

function driveStatus(err) {
  const match = String(err && err.message || err).match(/Drive API (\d+)/);
  return match ? Number(match[1]) : 0;
}

function explainDriveError(message) {
  const s = String(message || 'Drive request failed');
  if (/Drive API (403|404)/.test(s)) {
    return s + ' With the drive.file scope this app can only use folders and files it created, or that you opened with this app. Create a folder from Options, then use that folder ID.';
  }
  return s;
}

async function driveFetch(url, options = {}) {
  const token = await getAuthToken(false);
  const headers = Object.assign(
    { Authorization: `Bearer ${token}` },
    options.headers || {}
  );
  const resp = await fetch(url, Object.assign({}, options, { headers }));
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Drive API ${resp.status}: ${text}`);
  }
  return resp;
}

async function getFolderId() {
  const data = await chrome.storage.local.get('driveFolderId');
  const id = String(data.driveFolderId || '').trim();
  return id || null;
}

async function isDriveEnabled() {
  const data = await chrome.storage.local.get('driveSync');
  return !!(data.driveSync && data.driveSync.enabled);
}

async function markDrivePush() {
  const cur = await chrome.storage.local.get('driveLastSyncError');
  const payload = {
    driveLastSync: new Date().toISOString(),
    driveLastSyncDirection: 'push'
  };
  if (cur.driveLastSyncError) payload.driveLastSyncError = null;
  await chrome.storage.local.set(payload);
}

async function setDriveError(error) {
  const cur = await chrome.storage.local.get('driveLastSyncError');
  if ((cur.driveLastSyncError || null) === (error || null)) return;
  await chrome.storage.local.set({ driveLastSyncError: error || null });
}

let lastDriveWarn = '';
function warnDrive(message) {
  if (message === lastDriveWarn) return;
  lastDriveWarn = message;
  console.warn('[QuickNotes Drive]', message);
}

async function getFileMeta(fileId) {
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime`;
  const resp = await driveFetch(url);
  return resp.json();
}

async function downloadText(fileId) {
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
  const resp = await driveFetch(url);
  return resp.text();
}

async function listMarkdownFiles(folderId) {
  const files = [];
  let pageToken = '';
  const safeId = String(folderId).replace(/'/g, "\\'");
  do {
    const q = `'${safeId}' in parents and trashed = false and mimeType = 'text/markdown'`;
    const params = new URLSearchParams({
      q,
      spaces: 'drive',
      fields: 'nextPageToken,files(id,name,modifiedTime,mimeType)',
      pageSize: '200'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const resp = await driveFetch(`${DRIVE_API}/files?${params.toString()}`);
    const data = await resp.json();
    if (Array.isArray(data.files)) files.push.apply(files, data.files);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}

function multipartBody(metadata, markdown) {
  const boundary = '---------------314159265358979323846';
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: text/markdown; charset=UTF-8\r\n\r\n' +
    String(markdown == null ? '' : markdown) +
    `\r\n--${boundary}--`;
  return { boundary, body };
}

// Create (POST, with parents) or update (PATCH, no parents).
async function uploadMultipart({ method, fileId, metadata, markdown }) {
  const packed = multipartBody(metadata, markdown);
  const url = fileId
    ? `${UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,modifiedTime`
    : `${UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime`;
  const resp = await driveFetch(url, {
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${packed.boundary}` },
    body: packed.body
  });
  return resp.json();
}

async function createDriveFolder(name) {
  const resp = await driveFetch(`${DRIVE_API}/files?fields=id,name,mimeType`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name || 'Quick Notes',
      mimeType: 'application/vnd.google-apps.folder'
    })
  });
  return resp.json();
}

function requireMeta() {
  if (!self.QN_NoteMeta) throw new Error('note-meta.js is not loaded');
  return self.QN_NoteMeta;
}

async function loadFreshNote(hint) {
  const data = await chrome.storage.local.get('notes');
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const found = notes.find((n) => n && n.id === hint.id);
  return found || hint;
}

async function rememberDriveId(noteId, fileId) {
  if (self.QN_SyncIds) {
    await self.QN_SyncIds.setSyncIds(noteId, { driveFileId: fileId || null });
    return;
  }
}

const driveQueue = new Map();

function enqueueDrive(noteId, fn) {
  const prev = driveQueue.get(noteId) || Promise.resolve();
  const run = prev.then(fn, fn);
  driveQueue.set(noteId, run);
  run.then(() => {
    if (driveQueue.get(noteId) === run) driveQueue.delete(noteId);
  }, () => {
    if (driveQueue.get(noteId) === run) driveQueue.delete(noteId);
  });
  return run;
}

// opts.manual — user pressed Push / Sync (attempt even if the enabled flag
// races). opts.forceCreate — skip PATCH and make a new file.
async function uploadNoteMarkdownNow(hint, opts) {
  const options = opts || {};
  if (!hint || !hint.id) return { ok: false, error: 'missing note' };

  if (!options.manual) {
    const enabled = await isDriveEnabled();
    if (!enabled) return { ok: true, skipped: true, reason: 'disabled' };
  }

  const folderId = await getFolderId();
  if (!folderId) {
    const error = 'A Google Drive folder ID is required. Set it in Options. Drive upload was skipped.';
    await setDriveError(error);
    warnDrive(error);
    return { ok: false, skipped: true, error };
  }

  const meta = requireMeta();
  const fresh = await loadFreshNote(hint);
  const ids = self.QN_SyncIds ? await self.QN_SyncIds.getSyncIds(fresh.id) : {};
  let fileId = options.forceCreate ? null : (ids.driveFileId || fresh.driveFileId || null);
  const name = meta.driveFileName(fresh.title);
  const markdown = fresh.content || '';

  try {
    if (fileId) {
      try {
        const updated = await uploadMultipart({
          method: 'PATCH',
          fileId,
          metadata: { name, mimeType: 'text/markdown' },
          markdown
        });
        await rememberDriveId(fresh.id, updated.id || fileId);
        await markDrivePush();
        return { ok: true, fileId: updated.id || fileId, name };
      } catch (e) {
        if (driveStatus(e) !== 404) throw e;
        warnDrive('Drive file ' + fileId + ' was not found. Creating a new file in the target folder.');
        fileId = null;
      }
    }

    const created = await uploadMultipart({
      method: 'POST',
      metadata: { name, mimeType: 'text/markdown', parents: [folderId] },
      markdown
    });
    if (!created || !created.id) throw new Error('Drive did not return a file id');
    await rememberDriveId(fresh.id, created.id);
    await markDrivePush();
    return { ok: true, fileId: created.id, name };
  } catch (e) {
    const error = explainDriveError(e && e.message || e);
    await setDriveError(error);
    warnDrive(error);
    return { ok: false, error };
  }
}

function uploadNoteMarkdown(note, opts) {
  if (!note || !note.id) return Promise.resolve({ ok: false, error: 'missing note' });
  return enqueueDrive(note.id, () => uploadNoteMarkdownNow(note, opts));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function titleFromMarkdown(content, fileName) {
  const meta = self.QN_NoteMeta;
  const body = meta ? meta.bodyOf(content || '') : String(content || '');
  const line = (body.split('\n')[0] || '').trim().slice(0, 40);
  if (line) return line;
  const fromName = String(fileName || '').replace(/\.md$/i, '').trim().slice(0, 40);
  return fromName || 'Untitled';
}

async function pushToDrive() {
  const folderId = await getFolderId();
  if (!folderId) {
    const error = 'A Google Drive folder ID is required. Set it in Options before syncing.';
    await setDriveError(error);
    throw new Error(error);
  }
  const data = await chrome.storage.local.get('notes');
  const list = Array.isArray(data.notes) ? data.notes : [];
  let count = 0;
  for (const note of list) {
    const result = await uploadNoteMarkdown(note, { manual: true });
    if (!result || result.ok === false) {
      throw new Error((result && result.error) || 'upload failed');
    }
    count++;
  }
  const stamp = new Date().toISOString();
  await chrome.storage.local.set({
    driveLastSync: stamp,
    driveLastSyncDirection: 'push',
    driveLastSyncError: null
  });
  return { ok: true, direction: 'push', at: stamp, count };
}

function replaceNoteFromDrive(notes, file, text) {
  const meta = self.QN_NoteMeta;
  let note = notes.find((n) => n && n.driveFileId === file.id);
  if (!note && meta) {
    note = notes.find((n) => n && !n.driveFileId && meta.driveFileName(n.title) === file.name);
  }
  if (note) {
    note.content = text;
    note.driveFileId = file.id;
    note.updatedAt = Date.now();
    if (!note.titleLocked) note.title = titleFromMarkdown(text, file.name);
  } else {
    note = {
      id: genId(),
      title: titleFromMarkdown(text, file.name),
      content: text,
      updatedAt: Date.now(),
      pinned: false,
      driveFileId: file.id
    };
    notes.push(note);
  }
  return note;
}

async function pullFromDrive() {
  const folderId = await getFolderId();
  if (!folderId) {
    const error = 'A Google Drive folder ID is required. Set it in Options before syncing.';
    await setDriveError(error);
    throw new Error(error);
  }
  const files = await listMarkdownFiles(folderId);
  const data = await chrome.storage.local.get('notes');
  const notes = Array.isArray(data.notes) ? data.notes.slice() : [];
  for (const file of files) {
    const text = await downloadText(file.id);
    replaceNoteFromDrive(notes, file, text);
  }
  const stamp = new Date().toISOString();
  const payload = {
    notes,
    driveLastSync: stamp,
    driveLastSyncDirection: 'pull',
    driveLastSyncError: null
  };
  if (self.QN_SyncIds) payload.noteFileIds = await self.QN_SyncIds.stampFromNotes(notes);
  await chrome.storage.local.set(payload);
  return { ok: true, direction: 'pull', at: stamp, count: files.length };
}

// Per note: if the Drive copy is newer than note.updatedAt, download it.
// Otherwise upload. Notes with no file id are created in the target folder.
async function smartSync() {
  const folderId = await getFolderId();
  if (!folderId) {
    const error = 'A Google Drive folder ID is required. Set it in Options before syncing.';
    await setDriveError(error);
    throw new Error(error);
  }
  const data = await chrome.storage.local.get('notes');
  const list = Array.isArray(data.notes) ? data.notes : [];
  let pushed = 0;
  let pulled = 0;
  for (const note of list) {
    const ids = self.QN_SyncIds ? await self.QN_SyncIds.getSyncIds(note.id) : {};
    const fileId = ids.driveFileId || note.driveFileId || null;
    if (!fileId) {
      const created = await uploadNoteMarkdown(note, { manual: true });
      if (!created || created.ok === false) throw new Error((created && created.error) || 'upload failed');
      pushed++;
      continue;
    }
    let remote = null;
    try {
      remote = await getFileMeta(fileId);
    } catch (e) {
      if (driveStatus(e) === 404) {
        const created = await uploadNoteMarkdown(note, { manual: true, forceCreate: true });
        if (!created || created.ok === false) throw new Error((created && created.error) || 'upload failed');
        pushed++;
        continue;
      }
      throw e;
    }
    const remoteTime = remote && remote.modifiedTime ? new Date(remote.modifiedTime).getTime() : 0;
    const localTime = note.updatedAt || 0;
    if (remoteTime > localTime + 2000) {
      const text = await downloadText(fileId);
      const fresh = await chrome.storage.local.get('notes');
      const notes = Array.isArray(fresh.notes) ? fresh.notes : [];
      replaceNoteFromDrive(notes, { id: fileId, name: remote.name || '' }, text);
      const payload = { notes };
      if (self.QN_SyncIds) payload.noteFileIds = await self.QN_SyncIds.stampFromNotes(notes);
      await chrome.storage.local.set(payload);
      pulled++;
    } else {
      const up = await uploadNoteMarkdown(note, { manual: true });
      if (!up || up.ok === false) throw new Error((up && up.error) || 'upload failed');
      pushed++;
    }
  }
  const stamp = new Date().toISOString();
  await chrome.storage.local.set({
    driveLastSync: stamp,
    driveLastSyncDirection: pulled && !pushed ? 'pull' : 'push',
    driveLastSyncError: null
  });
  return { ok: true, direction: 'sync', at: stamp, pushed, pulled };
}

// ----- Auto-sync scheduling -----

async function setupAutoSync() {
  const { driveSync } = await chrome.storage.local.get(['driveSync']);
  const cfg = driveSync || {};
  chrome.alarms.clear(SYNC_ALARM);
  if (cfg.enabled && cfg.autoSync && cfg.intervalMinutes) {
    chrome.alarms.create(SYNC_ALARM, {
      delayInMinutes: cfg.intervalMinutes,
      periodInMinutes: cfg.intervalMinutes
    });
  }
}

async function onAlarm(alarm) {
  if (alarm.name !== SYNC_ALARM) return;
  try {
    await smartSync();
  } catch (e) {
    await setDriveError(explainDriveError(e.message || e));
  }
}

// ----- Exported message handler -----

async function handleDriveMessage(msg) {
  try {
    switch (msg.op) {
      case 'signIn': {
        const token = await getAuthToken(true);
        // Fetch user info (best effort)
        let email = null;
        try {
          const r = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (r.ok) { const info = await r.json(); email = info.email; }
        } catch {}
        const cur = (await chrome.storage.local.get(['driveSync'])).driveSync || {};
        await chrome.storage.local.set({
          driveSync: Object.assign(
            { autoSync: true, intervalMinutes: 15 },
            cur,
            { enabled: true, email }
          )
        });
        await setupAutoSync();
        return { ok: true, email };
      }
      case 'signOut': {
        await revokeAuthToken();
        const cur = (await chrome.storage.local.get(['driveSync'])).driveSync || {};
        await chrome.storage.local.set({
          driveSync: Object.assign({}, cur, { enabled: false, email: null })
        });
        chrome.alarms.clear(SYNC_ALARM);
        return { ok: true };
      }
      case 'push':     return await pushToDrive();
      case 'pull':     return await pullFromDrive();
      case 'sync':     return await smartSync();
      case 'status': {
        const d = await chrome.storage.local.get([
          'driveSync', 'driveLastSync', 'driveLastSyncDirection', 'driveLastSyncError', 'driveFolderId'
        ]);
        let remoteInfo = null;
        const folderId = String(d.driveFolderId || '').trim();
        if (d.driveSync && d.driveSync.enabled) {
          if (!folderId) {
            remoteInfo = { error: 'A Google Drive folder ID is required.' };
          } else {
            try {
              const folder = await getFileMeta(folderId);
              remoteInfo = { folderName: folder.name, folderId: folder.id, mimeType: folder.mimeType };
            } catch (e) {
              remoteInfo = { error: explainDriveError(e.message || e) };
            }
          }
        }
        return {
          ok: true,
          driveSync: d.driveSync,
          driveLastSync: d.driveLastSync,
          driveLastSyncDirection: d.driveLastSyncDirection,
          driveLastSyncError: d.driveLastSyncError,
          driveFolderId: folderId,
          remote: remoteInfo
        };
      }
      case 'configure': {
        const cur = (await chrome.storage.local.get(['driveSync'])).driveSync || {};
        const next = Object.assign({}, cur, msg.config || {});
        await chrome.storage.local.set({ driveSync: next });
        await setupAutoSync();
        return { ok: true, driveSync: next };
      }
      case 'testFolder': {
        const id = String(msg.folderId || await getFolderId() || '').trim();
        if (!id) return { ok: false, error: 'A Google Drive folder ID is required.' };
        try {
          const folder = await getFileMeta(id);
          if (folder.mimeType && folder.mimeType !== 'application/vnd.google-apps.folder') {
            return { ok: false, error: 'That ID is not a folder.' };
          }
          return { ok: true, id: folder.id, name: folder.name };
        } catch (e) {
          return { ok: false, error: explainDriveError(e.message || e) };
        }
      }
      case 'createFolder': {
        const created = await createDriveFolder(msg.name || 'Quick Notes');
        if (!created || !created.id) return { ok: false, error: 'Drive did not return a folder id' };
        await chrome.storage.local.set({ driveFolderId: created.id, driveLastSyncError: null });
        return { ok: true, id: created.id, name: created.name };
      }
    }
    return { ok: false, error: 'unknown op' };
  } catch (e) {
    return { ok: false, error: explainDriveError(e.message || e) };
  }
}

if (typeof self !== 'undefined') {
  self.QN_Drive = {
    handleDriveMessage,
    onAlarm,
    setupAutoSync,
    uploadNoteMarkdown,
    getFolderId
  };
}
