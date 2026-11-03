# Quick Notes setup

This guide is for loading the extension unpacked and turning on the two new save destinations: a local folder (an Obsidian vault or any other directory) and a visible Google Drive folder.

The sticky-note panel, docking, and editor are unchanged. Notes still autosave in `chrome.storage.local` even if the folder write or Drive upload fails.

## 1. Load the unpacked extension

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and choose this folder (`better Quick Notes`, the directory that contains `manifest.json`).
4. Pin the extension if you want the toolbar button.
5. After later code changes, click **Reload** on the extension card, then refresh any open tabs. The floating panel is injected into the page, so an old tab keeps the previous content script until you reload it.

Confirm the extension ID on the card. The `key` already in `manifest.json` is the base64 public key for this project and produces:

`aelknahnnjimdajnjkjochpejeanobik`

That is the same ID the published listing uses. Leave the existing `key` in place if you want that ID to stay stable. See [section 5](#5-stable-extension-id-manifest-key) if you are forking and need a different ID.

## 2. Google OAuth client

Drive sync uses the scope `https://www.googleapis.com/auth/drive.file` (not `drive.appdata`). After this change, everyone who had already signed in must **sign out and sign in again** so Google issues a token for the new scope. The old token cannot create files in a normal Drive folder.

`drive.file` is narrower than full Drive access, and it is also narrower than it looks:

- The app can create files and folders, and then read and update those.
- It can use a folder the user opened with this app (for example through Google Picker, which this build does not include).
- It **cannot** open an arbitrary folder just because you pasted its ID. If this extension did not create that folder, Test connection returns 404 or 403. Use **Create a Quick Notes folder** on the options page. That folder is created by this app, so later uploads are allowed, and it is visible in your Drive.

### Create the client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or pick a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen**. Add the scope `https://www.googleapis.com/auth/drive.file`. If the app is in testing, add your Google account as a test user.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
5. Application type: **Chrome extension** (older consoles label this **Chrome app**).
6. Application ID: the extension ID from `chrome://extensions` (for this manifest key, `aelknahnnjimdajnjkjochpejeanobik`).
7. Copy the client ID (`….apps.googleusercontent.com`) into `manifest.json` under `oauth2.client_id` if you are not using the client already shipped in this repo.
8. Reload the extension. Open the options page, **Sign in with Google**, then create or test the folder.

Browsers without `chrome.identity.getAuthToken` (Edge, Brave, and similar) use the web OAuth fallback in `drive-sync.js` (`WEB_APP_CLIENT_ID`). That client must allow the same `drive.file` scope and the redirect URI from `chrome.identity.getRedirectURL()`.

## 3. Google Drive folder ID

A folder URL looks like:

`https://drive.google.com/drive/folders/FOLDER_ID`

The folder ID is the segment after `/folders/`. Paste that into **Google Drive folder ID** on the options page and click **Save folder ID**, then **Test connection**.

Prefer **Create a Quick Notes folder**. The extension creates the folder with the Drive API, stores its ID, and can upload into it under `drive.file`. A pasted ID works only when this same OAuth client created the folder (or you later add Google Picker and the user picks the folder with it).

There is no fallback to the hidden `appDataFolder`. If the folder ID is empty, autosave still stores the note locally and skips Drive. The options page shows that a folder ID is required.

Each note is one Markdown file named `Title.md` (`text/markdown`). The extension stores the Drive file id in `noteFileIds` (and copies it onto the note as `driveFileId` on the next autosave). The next autosave sends:

`PATCH https://www.googleapis.com/upload/drive/v3/files/{fileId}?uploadType=multipart`

with metadata JSON (`name`, `mimeType`) and the markdown body. `parents` is sent only when creating a file. If that PATCH returns 404, the stale id is dropped, a new file is created in the configured folder, and the new id is saved.

Sync no longer uploads one JSON blob of settings, history, and images. Image bytes stay in local storage. The Markdown file keeps `qn-img:` references. **Backup & restore** on the options page is still the full local JSON export.

## 4. Local vault folder

1. Open the extension options page.
2. Under **Local vault folder**, click **Choose folder** and pick the vault directory (or any directory). Chrome asks for read/write access. That click is required. The content script cannot show this prompt on each keystroke.
3. The handle is stored in IndexedDB (`quick-notes-fs`), not in `chrome.storage`, because a `FileSystemDirectoryHandle` cannot be serialized there.
4. Autosave messages the service worker, which calls `queryPermission({ mode: 'readwrite' })` and, when the result is `granted`, `getFileHandle` + `createWritable()`.
5. If the permission is only `prompt` or `denied`, the write is skipped and a warning is logged. Click **Reconnect folder** on the options page (that button calls `requestPermission` from a click). If the options page is open and the worker cannot use the handle, the options page tries the write itself.
6. A failed vault write does not roll back the `chrome.storage` autosave.

File name:

`Title_noteId.md`

- `Title` is the note title, not the page title.
- `< > : " / \ | ? *` become hyphens.
- Control characters are removed.
- Trailing dots and spaces are removed.
- An empty title becomes `note`.
- The title portion is capped at 80 characters.
- `noteId` is the first 6 characters of the note id.

Example: note id `abcdef123`, title `My: Note?.` → `My- Note-_abcdef.md`.

Renaming the note writes the new file name and deletes the previous `.md` in that folder when the old name is still known.

## 5. Stable extension ID (`manifest` key)

`manifest.json` cannot contain comments, and an invalid `key` prevents Chrome from loading the extension. This repo **already has a valid `key`**. Do not replace it unless you intend to change the extension ID. Do not commit a private key or a `.pem` file.

The `key` value is the base64-encoded public key (SPKI/DER), not the private key. Chrome derives the extension ID from it, which is what the OAuth client is bound to.

To create a new key for a fork:

```bash
openssl genrsa -out key.pem 2048
openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A
```

Put only the base64 public key in the manifest. Keep `key.pem` outside the repo.

```json
"key": "PASTE_THE_BASE64_PUBLIC_KEY_HERE"
```

Reload the extension and copy the new ID from `chrome://extensions` into the Chrome-extension OAuth client. A private key in git is not required for unpacked loading; only the public `key` field is.

## Page metadata

On create or autosave from the floating panel, the note markdown keeps a single YAML block:

```yaml
---
title: "<document title>"
source: "<page url>"
domain: "<hostname>"
created: "<ISO 8601>"
updated: "<ISO 8601>"
tags:
  - quicknotes
  - web-clip
---
```

`created`, `source`, `domain`, and `title` stay as they were when the note is later edited on a different URL. On the same URL, title, source, and domain refresh from the current page. `updated` always refreshes. The editor is a raw Markdown textarea, so the block is part of `note.content` (that is what is saved, written to the vault, and uploaded). Autosave does not write a timestamp-only change back into the focused textarea, so the caret and undo stack stay put. The preview and the note title use the body under the block, not the YAML line `---`.

## What could not be verified in a browser

`node test-note-meta.js` checks YAML build/parse, same-page vs other-page updates, filename sanitization, and the caret shift when a block is first inserted. `node --check` parses the extension scripts. `chrome.*`, `showDirectoryPicker`, IndexedDB handles, and the Drive HTTP API were not exercised here.
