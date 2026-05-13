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
const api = read(files.api);
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
check('Fredagsfett visible section labels use 𓀂 while routes stay stable', /<title>𓀂<\/title>/.test(hub) && /<h1>𓀂<\/h1>/.test(hub) && /<title>𓀂 · Kalender<\/title>/.test(calendar) && /<p class=["']kicker["']>𓀂<\/p>/.test(calendar) && /<title>𓀂 · SP1Wise<\/title>/.test(sp1wise) && /<p class=["']kicker["']>𓀂<\/p>/.test(sp1wise));
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
check('Calendar page polls for updates', /setInterval\(\s*loadAvailability\s*,\s*15000\s*\)/.test(calendar));
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
check('SP1Wise removes intro copy and uses exact SP1E four-column wordmark', !/class=["']subtitle["']/.test(sp1wise) && /class=["']sp1e-wordmark["']/.test(sp1wise) && /<span>S<\/span><span>P<\/span><span>1<\/span><span>E<\/span>/.test(sp1wise) && !/class=["']mark["'][^>]*>SP1E/.test(sp1wise));
check('SP1Wise heading uses lining numeric 1 styling', /h1\s*\{[\s\S]*font-variant-numeric:\s*lining-nums[\s\S]*font-feature-settings:\s*'lnum' 1/.test(sp1wise));

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

if (failures) {
  console.error(`\n${failures} Fredagsfett feature contract checks failed.`);
  process.exit(1);
}

console.log('\nFredagsfett feature contract checks passed.');
