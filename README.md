# Better Quick Notes

Rozszerzenie Chrome do szybkich notatek na stronie — oparte na projekcie open source, rozszerzone o zapis do Obsidiana i widocznego folderu Google Drive.

<p align="center">
  <img src="icons/icon128.png" alt="Quick Notes logo" width="96" height="96" />
</p>

---

## O tym projekcie

### Inspiracja

Ten fork powstał na bazie **[Quick Notes](https://github.com/quicknotes/quick-notes)** autorstwa [@mthcht](https://github.com/mthcht) — lekkiego rozszerzenia MV3 z pływającym panelem, autosave, Markdownem, podglądem, historią schowka i opcjonalną synchronizacją z Google Drive. Zachowałem **ten sam charakter UI**: dokowanie, przesuwanie panelu, przezroczystość, skróty klawiszowe i sposób pracy z notatkami na stronie.

Upstream: [https://github.com/quicknotes/quick-notes](https://github.com/quicknotes/quick-notes)

### Moje założenia

1. **Nie psuć tego, co już działa** — warstwa prezentacji (content script, Shadow DOM, sticky note) została nietknięta; zmiany dotyczą głównie zapisu i synchronizacji.
2. **Notatka = plik Markdown z kontekstem strony** — każda notatka ma powiązanie z URL, z którego powstała (YAML frontmatter pod Obsidian).
3. **Lokalnie najpierw** — `chrome.storage.local` nadal jest źródłem prawdy; zapis do vaultu na dysku i upload do Drive są **opcjonalne** i nie blokują autosave, gdy brakuje uprawnień.
4. **Drive bez ukrytego `appDataFolder`** — pliki mają być normalnymi `.md` w folderze, który widać w Drive (np. pod Obsidian Sync / ręcznym backupem), z węższym scope OAuth `drive.file`.
5. **Modułowo** — logika metadanych, vaultu i mapowania ID plików Drive w osobnych plikach (`note-meta.js`, `vault-sync.js`, `sync-ids.js`), żeby łatwo utrzymywać fork.

### Co dodałem / zmieniłem względem upstream

| Obszar | Zmiana |
|--------|--------|
| **Metadane strony** | Automatyczny blok YAML (`title`, `source`, `domain`, `created`, `updated`, tagi `quicknotes`, `web-clip`) w treści Markdown; aktualizacja przy autosave bez duplikowania frontmatter. |
| **Vault lokalny** | Wybór folderu w opcach (`showDirectoryPicker`), handle w IndexedDB, zapis `${tytuł}_${6 znaków id}.md` z sanityzacją nazwy pliku. |
| **Google Drive** | Scope `https://www.googleapis.com/auth/drive.file`, upload do **skonfigurowanego folderu** (nie `appDataFolder`), `PATCH` przy kolejnych autosave, śledzenie `driveFileId`. |
| **Opcje** | Sekcje vault + folder Drive, test połączenia, „Create a Quick Notes folder”, reconnect vaultu. |
| **Dokumentacja** | [SETUP_GUIDE.md](SETUP_GUIDE.md) — OAuth, ID folderu, vault, klucz `manifest.key`. |
| **URL + checklisty (1.1)** | Binding notatki i auto-float na 3 poziomach (site / path / exact), SPA watcher, poprawka toggle checklist przy YAML. |
| **Desktop (Windows)** | Osobne repozytorium — [**better-quick-notes-desktop**](https://github.com/Sliskislimak/better-quick-notes-desktop) (Electron, notatki na `.exe`). Nie ładuj `desktop/` w Chrome. [DESKTOP.md](DESKTOP.md). |

Szczegóły techniczne syncu: [SETUP_GUIDE.md](SETUP_GUIDE.md).

---

## Instalacja w Chrome (wersja z repozytorium)

1. **Pobierz kod** — sklonuj repo albo pobierz ZIP i rozpakuj.
2. Otwórz **`chrome://extensions`**.
3. Włącz **Tryb deweloperski** (przełącznik u góry po prawej).
4. Kliknij **Załaduj rozpakowane** i wskaż folder z plikiem **`manifest.json`** (korzeń tego repozytorium, nie podfolder `desktop/`).
5. Przypnij ikonę rozszerzenia (puzzle → pinezka).
6. Po aktualizacji kodu: **Odśwież** kartę rozszerzenia na `chrome://extensions`, potem **odśwież otwarte karty** — panel wstrzykuje content script przy ładowaniu strony.

### Skróty (jak w oryginale)

| Akcja | Skrót |
|--------|--------|
| Otwórz / zamknij panel | `Alt+N` |
| Panel na karcie | `Alt+Shift+N` |
| Wyszukiwanie | `Ctrl+F` / `⌘+F` |
| Wycentruj panel | `Alt+Shift+R` |

### Opcjonalnie: vault Obsidian i Google Drive

1. Kliknij prawym na ikonę rozszerzenia → **Opcje** (lub otwórz stronę opcji z `chrome://extensions`).
2. **Vault lokalny** → **Choose folder** → wybierz folder w vaultcie Obsidian → ewentualnie **Reconnect folder**, jeśli zapis przestanie działać po restarcie przeglądarki.
3. **Google Drive** → zaloguj się (**Sign in with Google**). Po zmianie scope w tym forkzie: **wyloguj i zaloguj ponownie**. Użyj **Create a Quick Notes folder** (scope `drive.file` zwykle **nie** pozwala pisać do dowolnego folderu po samym wklejeniu ID — patrz SETUP_GUIDE).
4. Pełna konfiguracja OAuth i stabilnego ID rozszerzenia: [SETUP_GUIDE.md](SETUP_GUIDE.md).

---

## Funkcje (dziedziczone z Quick Notes)

- Pływający panel, autosave, wiele notatek, split view, podgląd Markdown, checklisty, tabele, obrazy/GIF, focus mode, tagi kolorów, przezroczystość, historia schowka, reguły per-URL, backup JSON, jasny/ciemny motyw.

### Checklists (v1.1)

W podglądzie Markdown kliknięcie wiersza `- [ ]` / `- [x]` przełącza stan, skreśla tekst i zapisuje notatkę. Indeksy linii są mapowane przez ciało notatki (po YAML frontmatter), więc checklisty działają także gdy na górze jest blok `---`.

### Auto-popup per URL (v1.1)

Z panelu:

- **🎯 Default** — powiąż aktywną notatkę z całą witryną, ścieżką (np. `https://www.youtube.com/@kanal/*`, `…/watch?*`) albo dokładnym URL.
- **📌 Float pin** — dodaj ten sam poziom wzorca do auto-pokazywania panelu.

Przy wejściu na pasujący adres (także nawigacja SPA bez F5) panel otwiera się sam i wybiera najbardziej szczegółowy matching `siteDefaults`.

## Struktura (rozszerzenie Chrome)

```
├── manifest.json
├── background.js          # service worker, sync vault/Drive
├── content.js             # panel na stronie (bez zmian UX)
├── note-meta.js           # YAML frontmatter
├── vault-sync.js          # File System Access API
├── sync-ids.js            # mapowanie Drive / nazw plików vault
├── drive-sync.js
├── options.html / options.js
├── popup.*
└── icons/
```

## Licencja

MIT — jak upstream; pełny tekst w [LICENSE](LICENSE).

## Podziękowania

Oryginalny **Quick Notes**: [quicknotes/quick-notes](https://github.com/quicknotes/quick-notes) — [@mthcht](https://github.com/mthcht).
