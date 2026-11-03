# Better Quick Notes — inspiracja i założenia (rozszerzenie Chrome)

## Inspiracja

Fork **[Quick Notes](https://github.com/quicknotes/quick-notes)** ([@mthcht](https://github.com/mthcht)) — pływający panel, autosave, Markdown, historia, opcjonalny Google Drive.

## Założenia tego repozytorium

1. **MV3, tylko Chrome** — content script + popup + service worker; bez zmian w warstwie UI panelu poza integracją zapisu.
2. **Notatka = Markdown z kontekstem strony** — YAML frontmatter (`source`, `domain`, tagi `quicknotes`, `web-clip`).
3. **Lokalnie najpierw** — `chrome.storage.local`; vault i Drive opcjonalne.
4. **Drive w widocznym folderze** — scope `drive.file`, PATCH przy autosave.
5. **Modułowo** — `note-meta.js`, `vault-sync.js`, `sync-ids.js`.

## Aplikacja Windows (osobne repo)

Wersja desktop (Electron, proces `.exe`, globalne skróty) jest w:

**https://github.com/Sliskislimak/better-quick-notes-desktop**

Patrz też [DESKTOP.md](DESKTOP.md).
