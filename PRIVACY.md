# Privacy Policy — Quick Notes

**Last updated**: April 2026

## Summary

Quick Notes is a local-first Chrome extension. By default, all your data stays on your device. Optional Google Drive sync is opt-in. It uses the `drive.file` scope, which can only see files and folders this extension created or that you opened with this app — not your Drive in general. See [SETUP_GUIDE.md](SETUP_GUIDE.md).

## What data the extension handles

Quick Notes handles the following data **only on your local device**, never on a remote server owned by the developer:

- **Notes content** — the text, images, and formatting you type into notes.
- **History** — records of paste / selection / URL-capture operations you trigger (capped at 200 entries).
- **Settings** — your configured themes, URL-pattern rules, per-site default notes, panel opacity, and shape preferences.
- **Pasted page content** — if you click the "Paste clipboard," "Insert URL," or "Insert selection" buttons, the content goes into your active note.
- **Page association** — when you create or edit a note from the floating panel, the note stores that page's document title, URL, and hostname in YAML frontmatter. The rest of the page is not read unless you use a capture button or the context menu.

This data is stored in Chrome's built-in `chrome.storage.local` API, which is sandboxed per-extension and local to your browser profile.

## What the extension does NOT do

- It does **not** collect, transmit, or share your notes with the developer, any analytics service, any advertiser, or any third party.
- It does **not** contain tracking code, telemetry, or remote logging.
- It does **not** read page content automatically. Page content is only captured when you explicitly click a capture button.
- It does **not** make any network requests at all, unless you opt into Google Drive sync (see below).

## Optional: Google Drive sync

If you **explicitly** enable Google Drive sync in the options page:

- You grant the extension the `https://www.googleapis.com/auth/drive.file` scope. This lets the extension create a folder and create or update Markdown files in folders it created (or that you opened with this app). It does not grant access to the rest of your Drive, and it does not use the hidden `appDataFolder`.
- Pasting a folder ID for a folder this app did not create will fail. Create the folder from the options page so the app is allowed to use it. See [SETUP_GUIDE.md](SETUP_GUIDE.md).
- Each note is uploaded as a Markdown file. History, settings, and image bytes stay in local storage unless you export the JSON backup yourself. The Markdown file may contain `qn-img:` references to those local images.
- Sync frequency is configurable (manual, or every 5/15/30/60 minutes). You can sign out at any time from the options page.

No other Google APIs or services are contacted.

## Third-party services

Quick Notes uses exactly one optional third-party service:

- **Google Drive** (only when sync is enabled). Its own privacy policy applies: <https://policies.google.com/privacy>.

No other third parties are involved.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save notes and settings locally in `chrome.storage.local`. |
| `scripting` | Inject the floating panel into the active tab on user command. |
| `clipboardRead` | The Paste button reads the clipboard — only when you click it. |
| `contextMenus` | Right-click menu entries for sending selected text / URLs to notes. |
| `identity` | Google sign-in (only if you enable Drive sync). |
| `alarms` | Schedule periodic auto-sync to Drive (only if enabled). |
| `host_permissions: <all_urls>` | So the floating panel can be shown on any page. **No page content is read** unless you click Insert URL / Insert Selection. |

## Data you can export

At any time, you can export **all** your local data as a JSON file via the options page's Backup & Restore section. This file is saved via your browser's normal download flow — the extension does not upload it anywhere.

## Data deletion

To delete all your Quick Notes data:

- **Local**: Options page → Storage → "Reset everything." Or uninstall the extension.
- **Google Drive (if sync was enabled)**: Options → Google Drive sync → Sign out. Then visit <https://myaccount.google.com/permissions>, find Quick Notes, and revoke access. Markdown files the extension created remain in the Drive folder you chose; delete that folder yourself if you want them gone. They are not removed automatically on uninstall.

## Children's privacy

Quick Notes is not directed at children under 13. If you are the parent or guardian of a child under 13 who has installed this extension, you may remove it at any time.

## Changes to this policy

If this policy changes, the new version will be committed to the public repository at
<https://github.com/quicknotes/quick-notes/blob/main/PRIVACY.md> with a new "Last updated" date.

## Contact

Open an issue at <https://github.com/quicknotes/quick-notes/issues>.

---

**Developer**: @mthcht · <https://github.com/mthcht>
**Source code**: <https://github.com/quicknotes/quick-notes>
**License**: MIT
