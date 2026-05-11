import fs from 'node:fs';

const files = {
  api: 'functions/api/[[route]].ts',
  hub: 'fredagsfett/index.html',
  calendar: 'fredagsfett/kalender/index.html',
  sp1wise: 'fredagsfett/sp1wise/index.html',
  redirects: '_redirects',
};

const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const api = read(files.api);
const hub = read(files.hub);
const calendar = read(files.calendar);
const sp1wise = read(files.sp1wise);
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
check('Fredagsfett static routes exist for Kalender and SP1Wise', fs.existsSync(files.calendar) && fs.existsSync(files.sp1wise));
check('Redirects serve Kalender and SP1Wise as Pages routes', /\/fredagsfett\/kalender\s+\/fredagsfett\/kalender\/index\.html\s+200/.test(redirects) && /\/fredagsfett\/sp1wise\s+\/fredagsfett\/sp1wise\/index\.html\s+200/.test(redirects));

check('Availability API dispatch exists', /fredagsfettAvailability/.test(api) && /id === ['"]availability['"]/.test(api));
check('Availability API supports GET POST DELETE', /fredagsfettAvailabilityList/.test(api) && /fredagsfettAvailabilityUpsert/.test(api) && /fredagsfettAvailabilityDelete/.test(api));
check('Availability API ranks best dates', /best_dates/.test(api) && /available_count/.test(api) && /unavailable_count/.test(api));
check('Calendar page renders month grid and summer shortcuts', /calendar-grid/.test(calendar) && /Juni/.test(calendar) && /Juli/.test(calendar) && /Augusti/.test(calendar));
check('Calendar page can save available maybe unavailable and notes', /AVAILABLE/.test(calendar) && /MAYBE/.test(calendar) && /UNAVAILABLE/.test(calendar) && /note-input/.test(calendar) && /\/api\/fredagsfett\/availability/.test(calendar));
check('Calendar page polls for updates', /setInterval\(\s*loadAvailability\s*,\s*15000\s*\)/.test(calendar));
check('Calendar page has direct SP1Wise navigation without old hub link', /href=["']\/fredagsfett\/sp1wise["']/.test(calendar) && !/>\s*Hub\s*</i.test(calendar));
check('Calendar removes intro copy and note placeholder text', !/class=["']subtitle["']/.test(calendar) && !/placeholder=/.test(calendar));
check('Calendar uses exact SP1E four-column wordmark from landing page', /class=["']sp1e-wordmark["']/.test(calendar) && /<span>S<\/span><span>P<\/span><span>1<\/span><span>E<\/span>/.test(calendar) && !/class=["']mark["'][^>]*>SP1E/.test(calendar));

check('SP1Wise API dispatch exists', /fredagsfettSp1wise/.test(api) && /id === ['"]sp1wise['"]/.test(api));
check('SP1Wise API supports groups, expenses, settlements, comments and CSV export', /fredagsfettSp1wiseGroups/.test(api) && /fredagsfettSp1wiseCreateExpense/.test(api) && /fredagsfettSp1wiseCreateSettlement/.test(api) && /fredagsfettSp1wiseCreateComment/.test(api) && /text\/csv/.test(api));
check('SP1Wise backend computes simplified debts', /simplified_debts/.test(api) && /fredagsfettSimplifyDebts/.test(api));
check('SP1Wise page can add expense, settle up, comment and export CSV', /expense-form/.test(sp1wise) && /settlement-form/.test(sp1wise) && /comment-form/.test(sp1wise) && /Exportera CSV/.test(sp1wise));
check('SP1Wise page shows balances and debt simplification', /balance-list/.test(sp1wise) && /debt-list/.test(sp1wise));

if (failures) {
  console.error(`\n${failures} Fredagsfett feature contract checks failed.`);
  process.exit(1);
}

console.log('\nFredagsfett feature contract checks passed.');
