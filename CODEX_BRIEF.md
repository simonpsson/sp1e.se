# sp1e.se / Fredagsfett — Codex Project Brief
> Uppdaterad: 2026-06-14 av Claude (Sonnet 4.6)  
> Branch: `claude/recommend-improvements-8ekdO` (PR mot `main`)

---

## 1. Vad är projektet?

**Fredagsfett** är en privat gruppwebbapp för en fast vänkrets. Ingen publik registrering — lösenordsskyddad via `?pw=...` URL-param som sätter en sessionstoken. Tillgänglig på `sp1e.se/fredagsfett`.

**Stack:**
- Cloudflare Pages (statisk HTML/CSS/JS, inga bundlers, inga npm-beroenden i frontenden)
- Cloudflare Pages Functions (TypeScript, single route file: `functions/api/fredagsfett/[[route]].ts`)
- Cloudflare D1 (SQLite-databas, binding: `DB`)
- Cloudflare R2 (filer/foton, binding: `FILES`)
- Autentisering: lösenord i `.dev.vars` (env: `FREDAGSFETT_PW`), genererar HttpOnly sessionstoken lagrad i D1

---

## 2. Filstruktur

```
sp1e.se/
├── wrangler.toml                          # D1 + R2 bindings, pages config
├── fredagsfett/
│   ├── index.html                         # Landningssida / inloggning
│   ├── style.css                          # MÖRKT tema — används ej längre av sidorna (legacy)
│   ├── light-ui.css                       # LJUST tema — delad stilmall (1003 rader)
│   ├── theme.js                           # Tema-toggler (dark/light cyklar bakgrundsbilder)
│   ├── hem/index.html                     # Startsida (1558 rader)
│   ├── kalender/index.html                # Kalender + tillgänglighet (2557 rader)
│   ├── karta/index.html                   # Leaflet-karta med rutter/platser (1178 rader)
│   ├── casino/
│   │   ├── index.html                     # Casino shell (870 rader)
│   │   └── casino.js                      # Spellogik: Blackjack, Roulette, Hold'em (1121 rader)
│   ├── sp1wise/index.html                 # Utgiftsdelning / kassakoll (777 rader)
│   ├── rsvp/index.html                    # Publik RSVP-sida (280 rader) — FRISTÅENDE, eget tema
│   └── admin/index.html                   # Admin-panel (460 rader) — MÖRKT tema (avsiktligt)
└── functions/api/fredagsfett/[[route]].ts # ALL backend-logik (~2600 rader)
```

---

## 3. Designsystem

### Tema: "Gotlandskalksten" (light, används av alla sidor utom admin)

**Källa: `/fredagsfett/light-ui.css`** — länkas av varje sida FÖRE inline `<style>`.

**CSS-tokens (`:root`):**
```css
--ff-bg:         #eeebe2    /* krämvit bakgrund */
--ff-paper:      #f5f1e8    /* kortbakgrund */
--ff-paper-2:    #ebe7dc
--ff-panel:      rgba(249,246,237,0.90)
--ff-ink:        #282218    /* djup svart */
--ff-text:       #4f493d
--ff-muted:      #948c79
--ff-faint:      #b8b09f
--ff-line:       rgba(80,72,55,0.14)
--ff-line-strong:rgba(80,72,55,0.25)
--ff-sage:       #6c7450    /* olivgrön accent */
--ff-sage-2:     #dfe5d2
--ff-gold:       #a4925d    /* guldbrun */
--ff-rust:       #a45b3d    /* rost/röd */
--ff-blue:       #dfe9ec
--ff-lilac:      #e8e0ec
--ff-font-display: "EB Garamond","Cormorant Garamond",serif
--ff-font-body:    "Public Sans",system-ui,sans-serif
--ff-font-num:     "Bricolage Grotesque",system-ui,sans-serif
--ff-font-mono:    "DM Mono",ui-monospace,monospace
```

**Fonts** laddas från Google Fonts (extern länk i varje sida).

**Komponenter i light-ui.css:**
- `.room` — glassmorphism-panel med blur
- `.ff-topbar`, `.ff-nav-row` — navigationslist
- `.ff-skeleton`, `.ff-skeleton-stack` — skeletonladdning
- `.ff-toast-in` — toast-animation
- `.ff-av` — avatar-komponent
- `.ff-error-row` — felmeddelande med retry-knapp
- `.ff-light-page button:focus-visible` — globala fokusringar (a11y)
- `@media (max-width: 720px) .ff-light-page button { min-height: 44px }` — touch-targets

### Admin-tema (mörkt, avsiktligt separat)
Svart panel, whisky-amber accent. Ingen light-ui.css. Behåll detta.

### RSVP-tema (fristående ljust)
Inline CSS i `rsvp/index.html`, kalksten-färger, card-layout. Länkas via unik token-URL.

---

## 4. API-endpunkter (`/api/fredagsfett/`)

Alla kräver giltig sessionstoken (cookie `ff_session`) — förutom `/rsvp-public/*`.

| Endpoint | Metod | Funktion |
|----------|-------|----------|
| `auth` | POST | Logga in med lösenord |
| `session` | GET | Validera session, hämta inloggad användare |
| `register` | POST | Registrera nytt konto |
| `logout` | POST | Logga ut |
| `availability` | GET/POST/DELETE | Tillgänglighetsdata per dag |
| `availability/export` | GET | CSV-export |
| `casino/blackjack` | GET/POST | Blackjack-spelstate |
| `casino/roulette` | GET/POST | Roulette-state |
| `casino/holdem` | GET/POST | Texas Hold'em state |
| `rsvp-public/:eventId/:token` | GET/POST | Publik RSVP (ingen auth) |
| `events` | GET/POST | Lista/skapa events |
| `events/:id` | PATCH/DELETE | Uppdatera/avboka event |
| `events/:id/comments` | GET/POST | Kommentarer |
| `events/:id/items` | GET/POST | Checklistpunkter |
| `events/:id/photos` | GET/POST | Foton (R2) |
| `events/:id/rsvp` | GET/POST/DELETE | RSVP-svar |
| `events/:id/share-token` | GET | Generera RSVP-delningslänk |
| `items/:id` | PATCH/DELETE | Uppdatera/ta bort item |
| `photos/:id` | GET/DELETE | Hämta/ta bort foto |
| `activity` | GET | Aktivitetsflöde |
| `chat` | GET/POST | Gruppchat |
| `routes` | GET/POST/PATCH/DELETE | Kartrutter |
| `ical-url` | GET | Generera iCal-URL |
| `ical/:token` | GET | iCal-feed |
| `sp1wise` | GET | Utgiftsdata + balanser |
| `sp1wise/export` | GET | CSV-export |
| `sp1wise/expenses` | POST | Lägg till utgift |
| `sp1wise/settlements` | POST | Registrera betalning |
| `sp1wise/expenses/:id/comments` | GET/POST | Kommentarer |
| `members` | GET | Gruppmedlemmar |
| `push` | GET/POST | Web Push-prenumerationer |

---

## 5. Sidor — nuläge och kända problem

### `hem/index.html` — Startsida
- **Sektioner:** Kommande events (hero), To-do-lista, Utgiftsbalans, Gruppchat
- **Problem (ÖPPET):** Alla sektioner visas samtidigt → vertikalt kaos, måste scrolla. Behöver redesign till "fokus på ett ämne i taget"
- **Gjort:** light-ui.css länkad, hero-skeleton, toast på claimItem/addItem/sendChat, debt arrow a11y

### `kalender/index.html` — Tillgänglighetskalender (2557 rader, TYNGST fil)
- **Sektioner:** Månadsvy, Dagsdetaljpanel, Nyhetsflöde, Aktivitetslogg, Chatt
- **Problem (ÖPPET):** ALLA paneler visas direkt → överlappning och scrollkaos (bild 1+2). Lösning: visa bara kalendern och låt sidopanelerna poppa upp EFTER att man klickat på en dag
- **Gjort:** dead CSS borttaget, bridge-vars, today-highlight (#6c7450 vänstertrefik), smooth chat-scroll + refocus, retry-banners på alla loaders, optimistisk save (disabled knapp + toast), alla CSS-tokens lösta

### `karta/index.html` — Leaflet-karta
- **Problem (ÖPPET, KRITISKT):** Kartan renderas "knasigt" — trolig orsak är containerstorleksproblem (Leaflet kräver explicit höjd på #map-elementet), möjligen att tile-laddning misslyckas eller zoom/bounds är fel
- **Gjort:** karta-spinner (div inuti #map visas tills map.whenReady()), SRI-kommentar på CDN-taggar, persistent felmeddelanden, bridge-vars (--faint, --font-display, --accent-soft, --font-body tillagda)
- **Behöver:** Noggrann felsökning av varför kartan inte renderar korrekt; kolla console-errors i webbläsaren

### `casino/index.html` + `casino.js` — Casino
- **Spel:** Blackjack ✓, Roulette ✓, Texas Hold'em (delvis implementerat)
- **Problem (ÖPPET — PRIO 1):** Hold'em är enbart mot bot, single-player. Önskat: multiplayer (riktiga spelare i "rummet") + bot-alternativ. Nuvarande backend (`casino/holdem`) är per-session, ej delat game-state
- **Gjort:** retry-knappar på alla boot-errors, 6s timeout på holdem-init, aria-label på dolda kort, fokusringar

### `sp1wise/index.html` — Utgiftsdelning
- **Gjort:** ledger-skeleton-rader, disable-on-submit (3 formulär), debt-pil bold + aria-label, dark token-overrides borttagna
- **Status:** Fungerar väl

### `rsvp/index.html` — Publik RSVP
- **Gjort:** "Skickar…" under submit, "Skickat ✓" vid success, textåterställning vid fel
- **Status:** Fungerar väl

### `admin/index.html` — Admin-panel
- **Gjort:** "← Hem"-länk i toolbar, focus-rings, 44px touch-targets
- **Status:** Avsiktligt mörkt tema

---

## 6. Beställda förbättringar (ej implementerade — BACKLOG)

### KRITISKA (från Simon 2026-06-14)

**A. Kalender — progressiv disclosure**
> "Behövs verkligen alla boxar synas direkt, eller är det inte bättre om majoriteten poppar upp när man ex. valt en dag i kalendern?"

Lösning: Kalender startar i "kompakt läge" — bara månadsrutnätet syns. Sidopanelerna (detaljer, nyheter, aktivitet, chatt) döljs. Klick på en dag → panel glider/tonar in. Mobil: bottom-sheet. Desktop: sidebar.

**B. Karta — felsökning + fix once and for all**
> "Kartan är helt knasig"

Troliga orsatker att utreda:
1. `#map` saknar explicit `height` i CSS (Leaflet-krav)
2. `map.invalidateSize()` anropas inte efter att containern blivit synlig
3. Tile-URL fel eller nätverksproblem (se console)
4. Karta initieras innan DOM är redo

**C. Casino Hold'em — multiplayer + botar**
> "Spela med riktiga människor som befinner sig i rummet men ett alternativ att kunna välja att spela mot botar"

Kräver delat game-state i D1:
- Nytt DB-schema: `holdem_tables`, `holdem_seats`, `holdem_hands`, `holdem_actions`
- SSE eller polling (var 2s) för live-updates
- "Skapa bord" / "Gå med" flöde
- Bot-läge: väljer slumpmässiga handlingar med grundläggande GTO-logik

**D. Generell UI/UX tightening**
> "Tighta till sidan ännu mer; göra UI/UX mer användarvänligt samt intuitivt"

- Apple/minimalism-princip: ett fokus per vy, resten progressivt
- Hem: visa bara nästa event + snabbåtgärder på start
- Minska vertikal scrollmassa på alla sidor
- Touch-first interaktion (44px targets ✓ gjort)

### ÖVRIGA FÖRSLAG (genererade av design-review)

1. **PWA offline-cache** — service worker för offline-kalendervy
2. **Push-notiser** — redan delvis implementerat (`/api/fredagsfett/push`), koppla till fler events
3. **Kalender iCal-sync** — redan implementerat, exponera tydligare i UI
4. **Foto-galleri** — Events har fotostöd via R2, men inget galleri-UI
5. **Kartrutter dela** — Rita rutt, dela som länk
6. **SP1wise kvitton** — Foton på kvitton kopplade till utgifter

---

## 7. UX-principer för detta projekt

1. **Progressiv disclosure**: Visa bara det som behövs just nu. Mer info på begäran.
2. **Minimalism (Apple-stil)**: Vita ytor, tydlig typografi, en action per vy.
3. **Touch-first**: Minst 44px tap-targets, stora klickbara ytor.
4. **Optimistisk UI**: Inaktivera knappar direkt vid submit, visa "Skickar…", återställ vid fel.
5. **Robust felhantering**: Varje async-anrop har retry-knapp, aldrig tom/tyst failure.
6. **Tema-konsekvens**: Alla sidor (utom admin + rsvp) använder light-ui.css + `--ff-*`-tokens.

---

## 8. Tekniska constraints för Codex

- **Inga bundlers** — all frontend är vanilla JS/CSS/HTML. Inga npm-imports i klientkod.
- **Cloudflare Workers runtime** — backend stöder inte Node.js-APIs. Ingen `fs`, ingen `net`, ingen `crypto.randomBytes` (använd `crypto.getRandomValues`).
- **D1 är SQLite** — inga stored procedures, inga JSON-kolumner (serialisera manuellt), transaktioner via `db.batch([])`.
- **Storlek** — kalender/index.html är 2557 rader. Redigera kirurgiskt, rör inte vad du inte måste.
- **`style.css` är legacy** — länka inte till den från nya eller redigerade sidor. Använd light-ui.css + `--ff-*`-tokens.
- **`admin/index.html` behåller mörkt tema** — rör inte detta.
- **`rsvp/index.html` är fristående** — ingen light-ui.css, inline CSS, gästvy.

---

## 9. Git-flöde

- **Feature-branch:** `claude/recommend-improvements-8ekdO`
- **Pushas mot:** `main` (via PR)
- **Commitformat:** `git push -u origin claude/recommend-improvements-8ekdO` (force om divergerat)
- **Author:** `git config user.email "noreply@anthropic.com" && git config user.name "Claude"`
- **.gitignore:** `.claude/`, `.wrangler/`, `node_modules/`, `.dev.vars`

---

## 10. Gjorda ändringar i denna session (PR e5b81a6 → 085c60b)

| Fil | Ändringar |
|-----|-----------|
| `light-ui.css` | +fokusringar, +44px touch-targets, +`.ff-error-row` |
| `kalender/index.html` | -style.css, +bridge-vars, +today-highlight, +smooth scroll, +retry-banners, +optimistisk save, +saknade palette-vars |
| `karta/index.html` | -style.css, +bridge-vars (alla), +map-spinner, +SRI-kommentar |
| `casino/index.html` | +fokusringar |
| `casino/casino.js` | +retry på boot-errors, +6s holdem-timeout, +aria-label dolda kort |
| `sp1wise/index.html` | -style.css, +bridge-vars, +skeleton, +disable-on-submit, +debt-arrow |
| `hem/index.html` | +light-ui.css-länk, +hero-skeleton, +toasts, +debt-arrow |
| `rsvp/index.html` | +"Skickar…"/"Skickat ✓" feedback |
| `admin/index.html` | +"← Hem"-länk, +fokusringar, +44px targets |
| `.gitignore` | +`.claude/` |
