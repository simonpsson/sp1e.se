import fs from 'node:fs';

const files = {
  api: 'functions/api/[[route]].ts',
  hub: 'fredagsfett/index.html',
  calendar: 'fredagsfett/kalender/index.html',
  sp1wise: 'fredagsfett/sp1wise/index.html',
  karta: 'fredagsfett/karta/index.html',
  lightUi: 'fredagsfett/light-ui.css',
  availabilityTimesMigration: 'fredagsfett-migration-002-availability-times.sql',
  redirects: '_redirects',
};

const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
// Post-split: Fredagsfett code lives in /api/fredagsfett/[[route]].ts as well as
// the parent /api/[[route]].ts. Concat both so regex assertions still match.
const api = read(files.api) + '\n' + read('functions/api/fredagsfett/[[route]].ts');
const hub = read(files.hub);
const calendar = read(files.calendar);
const sp1wise = read(files.sp1wise);
const karta = read(files.karta);
const lightUi = read(files.lightUi);
const availabilityTimesMigration = read(files.availabilityTimesMigration);
const redirects = read(files.redirects);

let failures = 0;
function check(name, ok) {
  if (ok) {
    console.log(`OK   ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${name}`);
}

check('Fredagsfett entry skips the old hub and sends registered users straight to Kalender', !/id=["']hub-panel["']/.test(hub) && !/class=["']link-card/.test(hub) && /location\.(?:href|assign)\s*=\s*['"]\/fredagsfett\/kalender['"]/.test(hub));
check('Fredagsfett visible section labels use 𓀂 while routes stay stable', /<title>𓀂<\/title>/.test(hub) && /<h1>𓀂<\/h1>/.test(hub) && /<title>𓀂 · \(S\)planner<\/title>/.test(calendar) && /<p class=["']kicker["']>𓀂<\/p>/.test(calendar) && /<title>𓀂 · SP1Wise<\/title>/.test(sp1wise) && /<p class=["']kicker["']>𓀂<\/p>/.test(sp1wise));
check('Fredagsfett static routes exist for Kalender, SP1Wise and Karta', fs.existsSync(files.calendar) && fs.existsSync(files.sp1wise) && fs.existsSync(files.karta));
check('Redirects serve Kalender, SP1Wise and Karta as Pages routes', /\/fredagsfett\/kalender\s+\/fredagsfett\/kalender\/index\.html\s+200/.test(redirects) && /\/fredagsfett\/sp1wise\s+\/fredagsfett\/sp1wise\/index\.html\s+200/.test(redirects) && /\/fredagsfett\/karta\s+\/fredagsfett\/karta\/index\.html\s+200/.test(redirects));
check('Fredagsfett shared light Gotland UI skin exists', fs.existsSync(files.lightUi) && /--ff-bg/.test(lightUi) && /ff-topbar/.test(lightUi) && /ff-card/.test(lightUi));
check('Fredagsfett core pages use the shared light topbar shell', /ff-light-page/.test(calendar) && /ff-light-page/.test(sp1wise) && /ff-light-page/.test(karta) && /ff-topbar/.test(calendar) && /ff-topbar/.test(sp1wise) && /ff-topbar/.test(karta));
check('Kalender uses the light month-board layout from the reference', /ff-calendar-page/.test(calendar) && /calendar-shell/.test(calendar) && /calendar-page-grid/.test(calendar) && /locked-events-panel/.test(calendar) && /view-switch-card/.test(calendar));
check('SP1Wise uses the light debt-dashboard layout from the reference', /ff-sp1wise-page/.test(sp1wise) && /sp1wise-shell/.test(sp1wise) && /sp1wise-hero/.test(sp1wise) && /simplified-debts-panel/.test(sp1wise) && /member-balance-panel/.test(sp1wise) && /distribution-panel/.test(sp1wise));
check('Karta uses the light Stockholm map layout from the reference', /ff-karta-page/.test(karta) && /karta-shell/.test(karta) && /map-searchbar/.test(karta) && /map-category-pills/.test(karta) && /map-sidebar/.test(karta) && /next-event-card/.test(karta));
check('Fredagsfett feature pages no longer use the dark gallery skin', !/gallery-wall-wide\.png/.test(calendar + sp1wise + karta) && !/--bg:\s*#050505/.test(sp1wise + karta));

check('Availability API dispatch exists', /fredagsfettAvailability/.test(api) && /id === ['"]availability['"]/.test(api));
check('Availability API supports GET POST DELETE', /fredagsfettAvailabilityList/.test(api) && /fredagsfettAvailabilityUpsert/.test(api) && /fredagsfettAvailabilityDelete/.test(api));
check('Availability API ranks best dates', /best_dates/.test(api) && /available_count/.test(api) && /unavailable_count/.test(api));
check('Calendar page renders month grid and summer shortcuts', /calendar-grid/.test(calendar) && /Juni/.test(calendar) && /Juli/.test(calendar) && /Augusti/.test(calendar));
check('Calendar page can save available maybe unavailable and notes', /AVAILABLE/.test(calendar) && /MAYBE/.test(calendar) && /UNAVAILABLE/.test(calendar) && /note-input/.test(calendar) && /\/api\/fredagsfett\/availability/.test(calendar));
check('Availability time migration adds start, end and time note fields', /ALTER TABLE ff_availability ADD COLUMN start_time TEXT/.test(availabilityTimesMigration) && /ALTER TABLE ff_availability ADD COLUMN end_time TEXT/.test(availabilityTimesMigration) && /ALTER TABLE ff_availability ADD COLUMN time_note TEXT/.test(availabilityTimesMigration));
check('Availability API persists and returns time windows', /start_time/.test(api) && /end_time/.test(api) && /time_note/.test(api) && /normalizeFredagsfettTime/.test(api) && /normalizeFredagsfettTimeNote/.test(api));
check('Calendar UI can enter a time range and time comment', /id=["']time-start-input["']/.test(calendar) && /id=["']time-end-input["']/.test(calendar) && /id=["']time-note-input["']/.test(calendar) && /Tidsintervall/.test(calendar));
check('Calendar renders time windows visibly on days and detail cards', /class=["']time-chip["']/.test(calendar) && /formatTimeWindow/.test(calendar) && /time_note/.test(calendar));
check('Calendar page polls for updates (visibility-aware)',
  /(setInterval|pollWhenVisible)\(\s*(loadAvailability|reloadCalendarData)\s*,\s*15000\s*\)/.test(calendar)
  && /document\.hidden/.test(calendar));
check('Calendar page has direct SP1Wise navigation without old hub link', /href=["']\/fredagsfett\/sp1wise["']/.test(calendar) && !/>\s*Hub\s*</i.test(calendar));
check('Calendar exposes a small gear link to the admin console', /href=["']\/fredagsfett\/admin["']/.test(calendar) && /class=["'][^"']*icon-button/.test(calendar) && />⚙<\/a>/.test(calendar));
check('Calendar removes intro copy and note placeholder text', !/class=["']subtitle["']/.test(calendar) && !/placeholder=/.test(calendar));
check('Calendar uses exact SP1E four-column wordmark from landing page', /class=["']sp1e-wordmark["']/.test(calendar) && /<span>S<\/span><span>P<\/span><span>1<\/span><span>E<\/span>/.test(calendar) && !/class=["']mark["'][^>]*>SP1E/.test(calendar));

check('SP1Wise API dispatch exists', /fredagsfettSp1wise/.test(api) && /id === ['"]sp1wise['"]/.test(api));
check('SP1Wise API supports groups, expenses, settlements, comments and CSV export', /fredagsfettSp1wiseGroups/.test(api) && /fredagsfettSp1wiseCreateExpense/.test(api) && /fredagsfettSp1wiseCreateSettlement/.test(api) && /fredagsfettSp1wiseCreateComment/.test(api) && /text\/csv/.test(api));
check('SP1Wise backend computes simplified debts', /simplified_debts/.test(api) && /fredagsfettSimplifyDebts/.test(api));
check('SP1Wise page can add expense, settle up, comment and export CSV', /expense-form/.test(sp1wise) && /settlement-form/.test(sp1wise) && /comment-form/.test(sp1wise) && /Exportera CSV/.test(sp1wise));
check('SP1Wise page shows balances and debt simplification', /balance-list/.test(sp1wise) && /debt-list/.test(sp1wise));
check('SP1Wise page has direct Kalender navigation without old hub link', /href=["']\/fredagsfett\/kalender["']/.test(sp1wise) && !/>\s*Hub\s*</i.test(sp1wise));
check('SP1Wise page has direct Karta navigation', /href=["']\/fredagsfett\/karta["']/.test(sp1wise));
check('SP1Wise removes intro copy and uses exact SP1E four-column wordmark', !/class=["']subtitle["']/.test(sp1wise) && /class=["']sp1e-wordmark["']/.test(sp1wise) && /<span>S<\/span><span>P<\/span><span>1<\/span><span>E<\/span>/.test(sp1wise) && !/class=["']mark["'][^>]*>SP1E/.test(sp1wise));
check('SP1Wise heading uses lining numeric 1 styling', /h1\s*\{[\s\S]*font-variant-numeric:\s*lining-nums[\s\S]*font-feature-settings:\s*'lnum' 1/.test(sp1wise));

check('Karta page keeps Leaflet draw route persistence', /L\.Control\.Draw/.test(karta) && /\/api\/fredagsfett\/routes/.test(karta) && /saveCurrentRoute/.test(karta) && /loadRoutes/.test(karta));
check('Karta page adds group places layer from imported design concept', /GROUP_PLACES/.test(karta) && /PLACE_FILTERS/.test(karta) && /place-rail/.test(karta) && /renderPlaceFilters/.test(karta) && /renderPlaces/.test(karta));
check('Karta group places avoid exact addresses but include useful Stockholm zones', /Hagaparken/.test(karta) && /Söderzon/.test(karta) && /Hemzon · inga exakta adresser/.test(karta));
check('Karta page links back to Kalender and SP1Wise', /href=["']\/fredagsfett\/kalender["']/.test(karta) && /href=["']\/fredagsfett\/sp1wise["']/.test(karta));

check('Events GET list endpoint exists and is user-gated',
  /fredagsfettEventsList/.test(api)
  && /id === ['"]events['"]/.test(api)
  && /requireFredagsfettUser\(request, env\)/.test(api));
check('Events GET joins availability for attendees (incl. TENTATIVE)',
  /fredagsfettEventsList[\s\S]*?ff_availability[\s\S]*?status IN \('AVAILABLE','TENTATIVE','MAYBE'\)/.test(api));

// QoL #10 — TENTATIVE availability status across the stack
check('TENTATIVE status wired in API normalize, label and TS type',
  /value === 'TENTATIVE'/.test(api)
  && /status === 'TENTATIVE'/.test(api)
  && /'AVAILABLE' \| 'TENTATIVE' \| 'MAYBE' \| 'UNAVAILABLE'/.test(api));
check('Calendar exposes a TENTATIVE pill and includes it in the tap-cycle',
  /data-status="TENTATIVE"/.test(calendar)
  && /TAP_CYCLE = \['AVAILABLE', 'TENTATIVE', 'MAYBE', 'UNAVAILABLE'/.test(calendar));
// QoL polish pass (#31-35)
check('Brand assets exist at site root (favicon, apple-touch-icon, og, manifest)',
  fs.existsSync('favicon.svg')
  && fs.existsSync('apple-touch-icon.svg')
  && fs.existsSync('og-fredagsfett.svg')
  && fs.existsSync('site.webmanifest'));
check('All fredagsfett pages link the SVG favicon',
  /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/.test(hub)
  && /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/.test(calendar)
  && /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/.test(sp1wise)
  && /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/.test(karta));
// SW reduced to a tombstone after the v1/v2 install-time bug left some
// visitors with ERR_FAILED on /fredagsfett/* pages. theme.js no longer
// re-registers it; instead it actively unregisters any leftover SW.
check('Service Worker is a tombstone + theme.js cleans up existing registrations',
  fs.existsSync('sw.js')
  && /TOMBSTONE/i.test(fs.readFileSync('sw.js', 'utf8'))
  && /self\.registration\.unregister/.test(fs.readFileSync('sw.js', 'utf8'))
  && /getRegistrations/.test(fs.readFileSync('fredagsfett/theme.js', 'utf8')));
check('theme.js exposes ffPrompt and ffConfirm modal helpers',
  /window\.ffPrompt\s*=/.test(fs.readFileSync('fredagsfett/theme.js', 'utf8'))
  && /window\.ffConfirm\s*=/.test(fs.readFileSync('fredagsfett/theme.js', 'utf8')));
check('Loading skeletons replace bare "Laddar..." copy on Kalender + Hem',
  /class="ff-skeleton/.test(calendar)
  && !/<h2 id="month-title">Laddar/.test(calendar));

check('Migration 008 widens the ff_availability CHECK to include TENTATIVE',
  fs.existsSync('fredagsfett-migration-008-tentative-status.sql')
  && /CHECK \(status IN \('AVAILABLE', 'TENTATIVE', 'MAYBE', 'UNAVAILABLE'\)\)/.test(
       fs.readFileSync('fredagsfett-migration-008-tentative-status.sql', 'utf8')));

check('Events POST gated on requireFredagsfettAdminUser',
  /fredagsfettEventsCreate/.test(api)
  && /requireFredagsfettAdminUser\(request, env\)/.test(api));
check('Events POST upserts via ON CONFLICT(group_id, date)',
  /INSERT INTO ff_events[\s\S]*?ON CONFLICT\(group_id, date\)\s*DO UPDATE/.test(api));
check('Events POST writes event_locked to activity log',
  /event_locked/.test(api));

check('Events PATCH updates non-date fields and bumps updated_at',
  /fredagsfettEventsUpdate/.test(api)
  && /requireFredagsfettAdminUser\(request, env\)/.test(api)
  && /UPDATE ff_events SET[\s\S]*?updated_at = datetime\('now'\)/.test(api));
check('Events DELETE soft-cancels with status=CANCELLED and cancelled_at',
  /fredagsfettEventsCancel/.test(api)
  && /status\s*=\s*'CANCELLED'/.test(api)
  && /cancelled_at\s*=\s*datetime\('now'\)/.test(api));
check('Events activity log emits event_updated and event_cancelled',
  /event_updated/.test(api) && /event_cancelled/.test(api));

// Weekday-default-time prefill was removed: the project is event-agnostic and
// no longer treats Friday/Saturday/Sunday specially. The helper still exists as
// a no-op for backwards compat with the call site.
check('Availability upsert no longer encodes Friday-specific default times',
  /fredagsfettWeekdayDefaultTimes/.test(api)
  && !/return\s*\{\s*start_time:\s*['"]18:00['"]/.test(api));
check('Availability upsert distinguishes missing key from empty string',
  /'start_time' in body/.test(api) && /'end_time' in body/.test(api));
check('Availability upsert allows standalone start_time when default applies',
  !/(body\.start_time \|\| body\.end_time \|\| timeNote)\s*\)\s*&&\s*\(!startTime \|\| !endTime\)/.test(api));

check('Calendar loads events alongside availability',
  /loadEvents/.test(calendar)
  && /\/api\/fredagsfett\/events/.test(calendar));
check('Calendar reads is_admin from session and gates the lock button',
  /session\.user\.is_admin/.test(calendar)
  && /lock-event-btn/.test(calendar));
check('Calendar renders LOCKED events with a glyph and ring',
  /class=["']day[^"']*locked-event/.test(calendar)
  && /𓀂/.test(calendar));
check('Calendar shows event-card with edit and cancel actions for admins',
  /id=["']event-card["']/.test(calendar)
  && /data-action=["']edit-event["']/.test(calendar)
  && /data-action=["']cancel-event["']/.test(calendar));

check('Calendar implements tap-cycle on day cells with sessionStorage hint',
  /tapCycleStatus|cycleAvailability/.test(calendar)
  && /ff-tap-cycle-hint-seen/.test(calendar));
check('Calendar edit form always sends both time keys (value or empty string)',
  /start_time:\s*timeStartInput\.value\s*(\?\?|\|\|)\s*['"]/.test(calendar)
  && /end_time:\s*timeEndInput\.value\s*(\?\?|\|\|)\s*['"]/.test(calendar));

check('Calendar has a view-mode toggle for initials / heatmap',
  /data-view-mode=["']initials["']/.test(calendar)
  && /data-view-mode=["']heatmap["']/.test(calendar)
  && /Värmekarta/.test(calendar));
check('Calendar persists view mode in sessionStorage',
  /ff-calendar-view-mode/.test(calendar));
check('Calendar replaces "Bästa datum" panel with the locked-events panel (no Friday wording)',
  /Inlåsta event/.test(calendar)
  && !/Inlåsta fredagar/.test(calendar)
  && !/Markera 4 fredagar/.test(calendar)
  && /id=["']locked-events-list["']/.test(calendar)
  && !/Bästa datum/.test(calendar) // header text removed
);

if (failures) {
  console.error(`\n${failures} Fredagsfett feature contract checks failed.`);
  process.exit(1);
}

console.log('\nFredagsfett feature contract checks passed.');
