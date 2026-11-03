# Better Quick Notes — inspiracja i założenia

## Inspiracja

Ten projekt rozwija pomysł i interfejs rozszerzenia **[Quick Notes](https://github.com/quicknotes/quick-notes)** (autor [@mthcht](https://github.com/mthcht)). Chodzi o ten sam charakter pracy: szybkie notatki Markdown, panel „przyklejony” do kontekstu, stos notatek, tagi kolorystyczne, podgląd, wyszukiwanie, historia, opcjonalna synchronizacja z Google Drive oraz zapis do folderu vault (Obsidian).

Kod rozszerzenia Chrome w tym repozytorium jest bazą wizualną i funkcjonalną; warstwa **`desktop/`** to samodzielna aplikacja Electron na Windows, która przenosi ten UX na natywne okna aplikacji zamiast adresów URL.

## Założenia aplikacji desktopowej (`desktop/`)

1. **Parzystość z rozszerzeniem** — ten sam wygląd (motywy, kształty, pasek narzędzi, stos notatek na aplikację), te same skróty edytora (`Ctrl+B/I/U`, `Ctrl+Shift+X/L` itd.).
2. **Przypięcie do procesu Windows** — notatka wiąże się z `.exe` (np. `Code.exe`), nie z domeną; śledzenie aktywnego okna (HWND, granice, minimalizacja) przez Win32 (`koffi`).
3. **Cztery stany UI** — rozwinięty panel, zwinięty pasek u góry okna, stan „mrożony” (niska przezroczystość paska), daemon w zasobniku systemowym.
4. **Globalne skróty** — `Alt+Shift+Q` (otwórz/zwijaj), `Alt+Shift+W` (menu notatek aplikacji), `Alt+Shift+A` (dashboard wszystkich notatek); konfigurowalne w Ustawieniach.
5. **Lokalnie i pliki Markdown** — stan w `%APPDATA%`, opcjonalny vault z frontmatter YAML (`title`, `app_name`, `process`, `created`, `updated`, tagi `quicknotes` + `desktop-app`); watcher (chokidar) dla edycji z Obsidian.
6. **Google Drive (opcjonalnie)** — OAuth Desktop + folder ID, upload/patch bez duplikatów; sekrety szyfrowane `safeStorage`.
7. **Prywatność** — brak telemetrii; sync tylko na życzenie użytkownika.
8. **Windows 10/11 x64** — Electron (obecnie 39; po Node ≥22 można podnieść do 40+), `electron-builder` pod instalator/portable.

Szczegóły instalacji i użycia desktopu: [`desktop/README.md`](desktop/README.md).
