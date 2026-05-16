import fs from 'node:fs';

const files = {
  api: 'functions/api/[[route]].ts',
  hub: 'fredagsfett/index.html',
  calendar: 'fredagsfett/kalender/index.html',
  sp1wise: 'fredagsfett/sp1wise/index.html',
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
// Brand sigil 𓀂 is visible on every page. The gateway keeps the legacy <title>𓀂</title>
// and <h1>𓀂</h1>; the Gotland-themed internal pages render it in a .brand>.sigil span.
check('Fredagsfett visible section labels use 𓀂 while routes stay stable', /<title>𓀂<\/title>/.test(hub) && /<h1>𓀂<\/h1>/.test(hub) && /<title>𓀂 · \(S\)planner<\/title>/.test(calendar) && /<span class=["']sigil["'][^>]*>𓀂<\/span>/.test(calendar) && /<title>𓀂 · SP1Wise<\/title>/.test(sp1wise) && /<span class=["']sigil["'][^>]*>𓀂<\/span>/.test(sp1wise));
check('Fredagsfett static routes exist for Kalender and SP1Wise', fs.existsSync(files.calendar) && fs.existsSync(files.sp1wise));
check('Redirects serve Kalender and SP1Wise as Pages routes', /\/fredagsfett\/kalender\s+\/fredagsfett\/kalender\/index\.html\s+200/.test(redirects) && /\/fredagsfett\/sp1wise\s+\/fredagsfett\/sp1wise\/index\.html\s+200/.test(redirects));

check('Availability API dispatch exists', /fredagsfettAvailability/.test(api) && /id === ['"]availability['"]/.test(api));
check('Availability API supports GET POST DELETE', /fredagsfettAvailabilityList/.test(api) && /fredagsfettAvailabilityUpsert/.test(api) && /fredagsfettAvailabilityDelete/.test(api));
check('Availability API ranks best dates', /best_dates/.test(api) && /available_count/.test(api) && /unavailable_count/.test(api));
check('Calendar page renders month grid and summer shortcuts', /calendar-grid/.test(calendar) && /Juni/.test(calendar) && /Juli/.test(calendar) && /Augusti/.test(calendar));
check('Calendar page can save available maybe unavailable and notes', /AVAILABLE/.test(calendar) && /MAYBE/.test(calendar) && /UNAVAILABLE/.test(calendar) && /note-input/.test(calendar) && /\/api\/fredagsfett\/availability/.test(calendar));
check('Availability time migration adds start, end and time note fields', /ALTER TABLE ff_availability ADD COLUMN start_time TEXT/.test(availabilityTimesMigration) && /ALTER TABLE ff_availability ADD COLUMN end_time TEXT/.test(availabilityTimesMigration) && /ALTER TABLE ff_availability ADD COLUMN time_note TEXT/.test(availabilityTimesMigration));
check('Availability API persists and returns time windows', /start_time/.test(api) && /end_time/.test(api) && /time_note/.test(api) && /normalizeFredagsfettTime/.test(api) && /normalizeFredagsfettTimeNote/.test(api));
check('Calendar UI can enter a time range and time comment', /id=["']time-start-input["']/.test(calendar) && /id=["']time-end-input["']/.test(calendar) && /id=["']time-note-input["']/.test(calendar) && /Tidsintervall/.test(calendar));
check('Calendar renders time windows visibly on days and detail cards', /class=["']time-chip["']/.test(calendar) && /formatTimeWindow/.test(calendar) && /time_note/.test(calendar));
check('Calendar page polls for updates', /setInterval\(\s*(loadAvailability|reloadCalendarData)\s*,\s*15000\s*\)/.test(calendar));
check('Calendar page has direct SP1Wise navigation without old hub link', /href=["']\/fredagsfett\/sp1wise["']/.test(calendar) && !/>\s*Hub\s*</i.test(calendar));
check('Calendar exposes a gear link to the admin console', /href=["']\/fredagsfett\/admin["']/.test(calendar) && /⚙/.test(calendar));
// Intro copy: the legacy "subtitle" prose block is gone. Modern form placeholders
// (chat input, event-item input, event-comment input) are intentional UX.
check('Calendar removes the legacy intro subtitle block', !/class=["']subtitle["']/.test(calendar));
// Gotland chrome: brand sigil + wordmark in the .topbar with SP1E in the wordmark span.
check('Calendar uses the Gotland brand chrome (sigil + SP1E wordmark)', /class=["']topbar["']/.test(calendar) && /<span class=["']wordmark["']>SP1E<\/span>/.test(calendar));

check('SP1Wise API dispatch exists', /fredagsfettSp1wise/.test(api) && /id === ['"]sp1wise['"]/.test(api));
check('SP1Wise API supports groups, expenses, settlements, comments and CSV export', /fredagsfettSp1wiseGroups/.test(api) && /fredagsfettSp1wiseCreateExpense/.test(api) && /fredagsfettSp1wiseCreateSettlement/.test(api) && /fredagsfettSp1wiseCreateComment/.test(api) && /text\/csv/.test(api));
check('SP1Wise backend computes simplified debts', /simplified_debts/.test(api) && /fredagsfettSimplifyDebts/.test(api));
check('SP1Wise page can add expense, settle up, comment and export CSV', /expense-form/.test(sp1wise) && /settlement-form/.test(sp1wise) && /comment-form/.test(sp1wise) && /Exportera CSV/.test(sp1wise));
check('SP1Wise page shows balances and debt simplification', /balance-list/.test(sp1wise) && /debt-list/.test(sp1wise));
check('SP1Wise page has direct Kalender navigation without old hub link', /href=["']\/fredagsfett\/kalender["']/.test(sp1wise) && !/>\s*Hub\s*</i.test(sp1wise));
check('SP1Wise removes intro copy and uses the Gotland brand chrome (sigil + SP1E wordmark)', !/class=["']subtitle["']/.test(sp1wise) && /class=["']topbar["']/.test(sp1wise) && /<span class=["']wordmark["']>SP1E<\/span>/.test(sp1wise));
// SP1Wise display heading is set in italic EB Garamond (the Gotland display font).
check('SP1Wise display heading uses the Gotland italic display font', /\.page-head h1\s*\{[\s\S]*italic[\s\S]*var\(--font-display\)/.test(sp1wise));

check('Events GET list endpoint exists and is user-gated',
  /fredagsfettEventsList/.test(api)
  && /id === ['"]events['"]/.test(api)
  && /requireFredagsfettUser\(request, env\)/.test(api));
check('Events GET joins availability for attendees',
  /fredagsfettEventsList[\s\S]*?ff_availability[\s\S]*?status IN \('AVAILABLE','MAYBE'\)/.test(api));

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

check('Availability upsert applies weekday default times when keys are missing',
  /fredagsfettWeekdayDefaultTimes/.test(api)
  && /18:00/.test(api) && /17:00/.test(api) && /12:00/.test(api));
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
check('Calendar replaces "Bästa datum" panel with "Inlåsta fredagar"',
  /Inlåsta fredagar/.test(calendar)
  && /id=["']locked-events-list["']/.test(calendar)
  && !/Bästa datum/.test(calendar) // header text removed
);

if (failures) {
  console.error(`\n${failures} Fredagsfett feature contract checks failed.`);
  process.exit(1);
}

console.log('\nFredagsfett feature contract checks passed.');
