import fs from 'node:fs';

const files = {
  api: 'functions/api/[[route]].ts',
  middleware: 'functions/_middleware.ts',
  migration: 'fredagsfett-migration-001.sql',
  schema: 'schema.sql',
  envExample: '.dev.vars.example',
  gateway: 'fredagsfett/index.html',
  admin: 'fredagsfett/admin/index.html',
};

const read = path => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
const api = read(files.api);
const middleware = read(files.middleware);
const migration = read(files.migration);
const schema = read(files.schema);
const envExample = read(files.envExample);
const gateway = read(files.gateway);
const admin = read(files.admin);

const checks = [];
function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
}

check('Fredagsfett env vars are declared in API Env', /FF_PASSWORD\??:\s*string/.test(api) && /FF_SESSION_SECRET\??:\s*string/.test(api) && /FF_DEVICE_HASH_SALT\??:\s*string/.test(api) && /FF_ADMIN_NAMES\??:\s*string/.test(api));
check('Fredagsfett env vars are documented in .dev.vars.example', /FF_PASSWORD=/.test(envExample) && /FF_SESSION_SECRET=/.test(envExample) && /FF_DEVICE_HASH_SALT=/.test(envExample) && /FF_ADMIN_NAMES=/.test(envExample));
check('Fredagsfett default entry password is updated to farskfisk', /DEFAULT_FREDAGSFETT_PASSWORD\s*=\s*['"]färskfisk['"]/.test(api) && /FF_PASSWORD=färskfisk/.test(envExample));
check('Fredagsfett migration exists with users/devices/auth tables', /CREATE TABLE IF NOT EXISTS ff_users/.test(migration) && /CREATE TABLE IF NOT EXISTS ff_devices/.test(migration) && /CREATE TABLE IF NOT EXISTS ff_auth_attempts/.test(migration));
check('Fredagsfett migration includes calendar and sp1wise tables', /CREATE TABLE IF NOT EXISTS ff_availability/.test(migration) && /CREATE TABLE IF NOT EXISTS ff_expenses/.test(migration) && /CREATE TABLE IF NOT EXISTS ff_expense_shares/.test(migration) && /CREATE TABLE IF NOT EXISTS ff_settlements/.test(migration));
check('Cumulative schema includes Fredagsfett tables', /CREATE TABLE IF NOT EXISTS ff_users/.test(schema) && /CREATE TABLE IF NOT EXISTS ff_devices/.test(schema) && /CREATE TABLE IF NOT EXISTS ff_availability/.test(schema) && /CREATE TABLE IF NOT EXISTS ff_groups/.test(schema));
check('Fredagsfett API dispatch exists', /resource === ['"]fredagsfett['"]/.test(api) && /fredagsfettAuth/.test(api) && /fredagsfettRegister/.test(api) && /fredagsfettSession/.test(api) && /fredagsfettLogout/.test(api));
check('Fredagsfett admin API dispatch exists', /fredagsfettAdminUsers/.test(api) && /fredagsfettAdminUpdateUser/.test(api) && /fredagsfettAdminDeleteUser/.test(api) && /fredagsfettAdminRevokeDevice/.test(api));
check('Fredagsfett auth uses signed HTTP-only Lax cookie', /ff_session/.test(api) && /HttpOnly;\s*Secure;\s*SameSite=Lax/.test(api) && /signFredagsfettSession/.test(api) && /verifyFredagsfettSessionToken/.test(api));
check('Fredagsfett auth uses constant-time password comparison', /constantTimeStringEqual/.test(api) && /FF_PASSWORD/.test(api));
check('Fredagsfett auth rate limiting is D1-backed', /ff_auth_attempts/.test(api) && /FREDAGSFETT_AUTH_MAX_ATTEMPTS/.test(api));
check('Fredagsfett device restore hashes IP and user-agent', /ip_hash/.test(api) && /user_agent_hash/.test(api) && /hashFredagsfettFingerprint/.test(api));
check('Fredagsfett admin API requires admin server-side', /async function requireFredagsfettAdmin/.test(api) && /if \(!session\.user\.is_admin\)/.test(api));
check('Fredagsfett middleware protects section and API routes', /onRequest/.test(middleware) && /\/fredagsfett/.test(middleware) && /\/api\/fredagsfett/.test(middleware) && /verifyFredagsfettMiddlewareSession/.test(middleware));
check('Middleware allows auth and session probes without session cookie', /\/api\/fredagsfett\/auth/.test(middleware) && /\/api\/fredagsfett\/session/.test(middleware));
check('Fredagsfett gateway page has login/register/hub flow', /id=["']login-form["']/.test(gateway) && /id=["']register-form["']/.test(gateway) && /id=["']hub-panel["']/.test(gateway) && /\/api\/fredagsfett\/auth/.test(gateway) && /\/api\/fredagsfett\/register/.test(gateway));
check('Fredagsfett login screen keeps the minimal landing-page lock aesthetic', /body\.login-mode/.test(gateway) && /room\.login-lock/.test(gateway) && /password-input/.test(gateway) && /aria-label=["']Lösenord['"]/.test(gateway));
check('Fredagsfett gateway has no visible mojibake strings', !/[ÃÂ]/.test(gateway));
check('Fredagsfett gateway exposes admin link only for admins', /id=["']admin-link["']/.test(gateway) && /user\.is_admin/.test(gateway));
check('Fredagsfett admin page lists users and devices', /\/api\/fredagsfett\/admin\/users/.test(admin) && /data-action=["']save["']/.test(admin) && /data-action=["']delete["']/.test(admin) && /data-action=["']revoke["']/.test(admin));
check('Fredagsfett admin page uses non-mock API mutations', /method:\s*['"]PATCH['"]/.test(admin) && /method:\s*['"]DELETE['"]/.test(admin));

const failed = checks.filter(c => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name}`);

if (failed.length) {
  console.error(`\n${failed.length} Fredagsfett auth contract check(s) failed.`);
  process.exit(1);
}

console.log('\nFredagsfett auth contract checks passed.');
