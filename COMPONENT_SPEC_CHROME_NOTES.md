# COMPONENT SPEC: Better Quick Notes (chrome-notes-plugin)

## 1. Rola i Cel
- **Główna funkcja:** Rozszerzenie przeglądarki Chromium do tworzenia, edycji i organizacji notatek Markdown w pływającym dokowalnym panelu wstrzykiwanym w DOM strony lub oknie popup, automatycznie wzbogacające treść o kontekst strony (YAML frontmatter dla Obsidian) oraz synchronizujące dane lokalnie (File System Access API) i chmurowo (Google Drive API v3).
- **Typ aplikacji:** Wtyczka Chrome MV3 (Manifest V3: Background Service Worker, Content Scripts w Shadow DOM, Options Page, Action Popup).

## 2. Stack Technologiczny i Zależności
- **Język i środowisko uruchomieniowe:** JavaScript (ES2022+), środowisko wykonawcze Google Chrome / Chromium (silnik Blink / V8).
- **Główne biblioteki / frameworki:** Vanilla JavaScript (zero zewnętrznych zależności npm, brak frameworków SPA), Shadow DOM v1 (pełna izolacja stylów i drzewa DOM panelu na stronie hosta), File System Access API + IndexedDB (persistowanie uchwytów `FileSystemDirectoryHandle`), Chrome Extensions API (`chrome.storage.local`, `chrome.contextMenus`, `chrome.identity`, `chrome.alarms`, `chrome.scripting`).
- **Zewnętrzne zależności / wymagania systemowe:** Przeglądarka internetowa oparta na Chromium ze wsparciem Manifest V3; dostęp do sieci Internet wyłącznie na potrzeby synchronizacji z Google Drive (OAuth2 + REST API); brak wymagań GPU; pełna praca offline dla edycji, storage lokalnego oraz zapisu do vaulta dyskowego.

## 3. Kontrakty Danych (Wejście i Wyjście)
- **Dane wejściowe (Input):**
  - Kontekst przeglądarki: Aktywna karta (`tab.url`, `tab.title`), zaznaczony tekst (`info.selectionText` przez menu kontekstowe), adresy URL odnośników (`info.linkUrl`).
  - Schowek systemowy: `clipboardRead` (opcjonalny mechanizm auto-paste z domen skonfigurowanych w regułach `autoPasteSites`).
  - Interakcja użytkownika: Wprowadzany tekst Markdown w kontrolce `<textarea>`, globalne i lokalne skróty klawiszowe (`commands`: `Alt+N`, `Alt+Shift+N`, `Alt+Shift+R`).
  - Zewnętrzne API: Google Drive API v3 (pobieranie treści notatek przy akcji pull: `GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media`).
- **Dane wyjściowe (Output):**
  - `chrome.storage.local`: Przechowuje główny stan aplikacji – kolekcję notatek `notes`, mapę powiązań `noteFileIds`, historię schowka `history`, ustawienia widoku i motywów `settings`.
  - IndexedDB (`quick-notes-fs`, object store `handles`): Przechowuje binarny uchwyt katalogu `FileSystemDirectoryHandle` pod kluczem `vault-dir`.
  - Lokalny system plików (Vault Obsidian): Pliki Markdown `${Title}_${noteId:0:6}.md` z wstrzykniętym nagłówkiem YAML frontmatter zapisywane strumieniowo przez `FileSystemFileHandle.createWritable()`.
  - Google Drive REST API v3: Pliki Markdown w dedykowanym folderze użytkownika (`POST /upload/drive/v3/files?uploadType=multipart` dla nowych plików, `PATCH /upload/drive/v3/files/{fileId}?uploadType=media` dla aktualizacji treści) w ramach uprawnienia OAuth `https://www.googleapis.com/auth/drive.file`.
- **Format wymiany danych:**
Przykład rekordu notatki w `chrome.storage.local` oraz formatu wyjściowego `.md`:
```json
{
  "id": "m1b9f2c8",
  "title": "Architektura Systemu",
  "content": "---\ntitle: \"Architektura Systemu\"\nsource: \"https://example.com/docs/arch\"\ndomain: \"example.com\"\ncreated: \"2026-11-10 14:30:00\"\nupdated: \"2026-11-10 16:15:00\"\ntags:\n  - quicknotes\n  - web-clip\n---\n\n## Notatka techniczna\nTreść notatki z zachowaniem Markdown...",
  "updatedAt": 1793742900000,
  "driveFileId": "1AbC2dEf3GhIjKlMnOpQrStUv",
  "vaultFileName": "Architektura Systemu_m1b9f2.md"
}
```

Struktura mapy identyfikatorów (`noteFileIds` w `chrome.storage.local`):
```json
{
  "m1b9f2c8": {
    "driveFileId": "1AbC2dEf3GhIjKlMnOpQrStUv",
    "vaultFileName": "Architektura Systemu_m1b9f2.md"
  }
}
```

## 4. Model Uruchamiania i Cykl Życia (Lifecycle)
- **Sposób egzekucji:** On-Demand / Event-Driven. Background Service Worker nie działa nieprzerwanie w tle (nie jest demonem 24/7) – jest aktywowany zdarzeniowo przez przeglądarkę w odpowiedzi na akcje użytkownika (skrót klawiszowy, menu kontekstowe), zdarzenia `chrome.storage.onChanged`, komunikaty IPC z content scriptu lub cykliczne alarmy `chrome.alarms` (`qn-auto-sync`). Po zakończeniu obsługi zdarzenia worker przechodzi w stan uśpienia (idle termination po ok. 30s bezczynności). Content script jest wstrzykiwany leniwie (lazy injection) i istnieje w pamięci wyłącznie do momentu zamknięcia danej karty.
- **Czas trwania zadania:** Natychmiastowy (< 50 ms dla operacji I/O na `chrome.storage.local` i lokalnym vault; 300–1200 ms dla sieciowych wywołań HTTP do Google Drive API przy autosave).

## 5. Szacunek Zużycia Zasobów (Oracle Cloud Fit)
- **Zużycie RAM:** < 100 MB (~15–35 MB w wątku renderera otwartej karty przeglądarki; ~20–30 MB w procesie Service Workera; 0 MB na serwerze).
- **Obciążenie CPU:** Znikome (I/O bound – mikrosekundowe obciążenie podczas parsowania Markdown i asynchronicznego zapisu do magazynów danych).
- **Kompatybilność z Linux ARM64:** Częściowa / Zależna od środowiska uruchomieniowego. Kod wtyczki (JavaScript / Web APIs) działa bez zmian w przeglądarkach Chromium na maszynach Linux ARM64 (np. stacja robocza ARM64, Raspberry Pi z GUI). Moduł ten jest jednak komponentem stricte klienckim (frontend browser extension) – bezpośrednie uruchomienie go jako autonomiczny serwis chmurowy (headless daemon) na instancji Oracle Cloud (ARM Ampere) wymagałoby wirtualnego serwera wyświetlania (Xvfb) oraz instancji headless Chromium sterowanej przez Puppeteer/Playwright.

## 5b. Checklists i auto-popup per URL (v1.1)

- **Checklists:** Podgląd Markdown renderuje wiersze checklisty (`-`/`*`/`+` + `[ ]`/`[x]`) jako interaktywne wiersze. Indeks `data-line` dotyczy ciała notatki po YAML (`noteBody` / `QN_NoteMeta.bodyOf`); toggle mapuje go na pełną treść (`bodyLineOffset` + `toggleCheckInContent`), zapisuje `note.content` i odświeża podgląd ze skreśleniem.
- **Bindingi URL:** `settings.floatingPanelSites` (auto-show panelu) oraz `settings.siteDefaults` (domyślna notatka). UI w panelu (🎯 / 📌) oferuje trzy poziomy wzorców dla bieżącego URL: host (`https://host/*`), ścieżka (`…/@kanal/*`, `…/watch?*`), exact (bez hash). Przy wielu matchach wybierany jest najbardziej szczegółowy wzorzec.
- **SPA:** `background.js` nasłuchuje `tabs.onUpdated` (`complete` + `changeInfo.url`); `content.js` patchuje `history.pushState`/`replaceState`, nasłuchuje `popstate`/`hashchange` i polluje `location.href`, wywołując `applyUrlBindings()` / `show` bez agresywnego zamykania panelu.

## 6. Punkty Integracji i Ograniczenia
- **Wystawiane API / Porty:** Brak portów sieciowych i serwera HTTP. Komunikacja wewnętrzna odbywa się poprzez szyny Extensions API: `chrome.runtime.sendMessage`, `chrome.runtime.onMessage`, `chrome.storage.onChanged` oraz `window.postMessage` w odizolowanym Shadow DOM.
- **Potencjalne wąskie gardła:**
  - Ograniczenia File System Access API: Wymaga jednorazowej interakcji użytkownika (User Gesture) w `options.html` w celu przyznania uprawnień zapisu. Po restarcie przeglądarki uchwyt w IndexedDB może wymagać ponownego kliknięcia „Reconnect folder”.
  - Limity Google Drive API (Quotas): Standardowy limit Google Workspace (1000 zapytań / 100 s / użytkownik); zapis wymaga debouncingu (`saveTimer`), by zapobiec przekroczeniu limitów przy szybkim pisaniu.
  - Limit pojemności `chrome.storage.local`: Domyślny limit 10 MB per rozszerzenie (brak uprawnienia `unlimitedStorage` w `manifest.json`); przechowywanie osadzonych grafik base64 (`images`) może nasycić lokalny bufor.
  - Ograniczenie zakresu OAuth2: Scope `drive.file` uniemożliwia zapis do folderów, które nie zostały utworzone bezpośrednio przez dany identyfikator aplikacji OAuth rozszerzenia.
