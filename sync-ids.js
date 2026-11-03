// sync-ids.js · Drive file id and vault filename for each note.
// Stored in chrome.storage under noteFileIds. This map is the source of truth.
// It is not written by replacing the notes array: an upload finishing in the
// service worker must not overwrite keystrokes saved while the request was
// in flight. The editor copies the ids onto the note (driveFileId,
// vaultFileName) the next time it autosaves. Pull, which intentionally
// replaces note content, writes the ids onto the notes in the same update.

const SYNC_IDS_KEY = 'noteFileIds';

function emptySyncIds() {
  return { driveFileId: null, vaultFileName: null };
}

async function getSyncIds(noteId) {
  const data = await chrome.storage.local.get(SYNC_IDS_KEY);
  const map = data[SYNC_IDS_KEY] || {};
  return Object.assign(emptySyncIds(), map[noteId] || {});
}

async function setSyncIds(noteId, fields) {
  const data = await chrome.storage.local.get(SYNC_IDS_KEY);
  const map = Object.assign({}, data[SYNC_IDS_KEY] || {});
  const next = Object.assign(emptySyncIds(), map[noteId] || {});
  if (fields && 'driveFileId' in fields) next.driveFileId = fields.driveFileId || null;
  if (fields && 'vaultFileName' in fields) next.vaultFileName = fields.vaultFileName || null;
  map[noteId] = next;
  // Do not write `notes` here. Autosave owns that array; replacing it from
  // the worker can drop keystrokes that landed while the upload was in flight.
  // The editor copies these ids onto the note the next time it saves.
  const toSet = {};
  toSet[SYNC_IDS_KEY] = map;
  await chrome.storage.local.set(toSet);
  return next;
}

// Merge ids already sitting on note objects into the map, without writing.
// Callers save the returned map in the same chrome.storage.set as the notes.
async function stampFromNotes(notes) {
  const data = await chrome.storage.local.get(SYNC_IDS_KEY);
  const map = Object.assign({}, data[SYNC_IDS_KEY] || {});
  (notes || []).forEach((note) => {
    if (!note || !note.id) return;
    const prev = Object.assign(emptySyncIds(), map[note.id] || {});
    if (note.driveFileId) prev.driveFileId = note.driveFileId;
    if (note.vaultFileName) prev.vaultFileName = note.vaultFileName;
    map[note.id] = prev;
  });
  return map;
}

self.QN_SyncIds = { getSyncIds, setSyncIds, stampFromNotes, SYNC_IDS_KEY };
