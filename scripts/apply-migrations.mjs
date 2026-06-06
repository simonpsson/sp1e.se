#!/usr/bin/env node
// scripts/apply-migrations.mjs
//
// Idempotent D1 migration runner. Lists every fredagsfett{,-casino}-migration-*.sql
// in the repo, hashes each, queries ff_schema_migrations to see what is still
// unapplied, applies the new ones in lexical order, and records each one
// with its hash.
//
// Usage:
//   node scripts/apply-migrations.mjs --remote   (against prod D1)
//   node scripts/apply-migrations.mjs --local    (against local wrangler D1)
//   node scripts/apply-migrations.mjs --dry-run  (just list what would run)
//
// Bootstrap: if ff_schema_migrations does not exist yet, the script applies
// migration 010 first to create it, then proceeds.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_BINDING = 'sp1e-db';
const TRACKING_MIGRATION = 'fredagsfett-migration-010-schema-migrations.sql';

const args = new Set(process.argv.slice(2));
const isRemote = args.has('--remote');
const isLocal  = args.has('--local');
const isDryRun = args.has('--dry-run');
if (!isRemote && !isLocal) {
  console.error('usage: apply-migrations.mjs [--remote|--local] [--dry-run]');
  process.exit(2);
}
const target = isRemote ? '--remote' : '--local';

async function sha256(filepath) {
  const buf = await fs.readFile(filepath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function listMigrations() {
  const all = await fs.readdir(REPO_ROOT);
  // Same prefixes used in _redirects and PROJECT.md.
  return all
    .filter(f => /^(fredagsfett-migration|fredagsfett-casino-migration)-\d+.*\.sql$/.test(f))
    .sort(); // lexical order = numeric for our naming convention
}

function wranglerExec(args) {
  const r = spawnSync('npx', ['wrangler', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').trim() || `wrangler exited ${r.status}`);
  return r.stdout;
}

function queryAppliedFilenames() {
  // wrangler d1 execute prints a table; --json gives us structured rows.
  // If the table doesn't exist yet we'll get a SQL error — caller handles that.
  const out = wranglerExec([
    'd1', 'execute', DB_BINDING, target,
    '--command', 'SELECT filename FROM ff_schema_migrations',
    '--json',
  ]);
  // wrangler may print warnings before the JSON; grab the last { ... } block.
  const lastBrace = out.lastIndexOf('[');
  if (lastBrace === -1) return new Set();
  try {
    const parsed = JSON.parse(out.slice(lastBrace));
    const rows = parsed?.[0]?.results || parsed?.results || [];
    return new Set(rows.map(r => r.filename));
  } catch {
    return new Set();
  }
}

function applyFile(filename, hash) {
  if (isDryRun) {
    console.log(`  → DRY-RUN would apply ${filename}  (sha256:${hash.slice(0, 12)}…)`);
    return;
  }
  console.log(`  → applying ${filename}…`);
  wranglerExec([
    'd1', 'execute', DB_BINDING, target,
    '--file', path.join(REPO_ROOT, filename),
  ]);
  wranglerExec([
    'd1', 'execute', DB_BINDING, target,
    '--command',
    `INSERT OR REPLACE INTO ff_schema_migrations (filename, sha256, applied_at)
     VALUES ('${filename.replace(/'/g, "''")}', '${hash}', datetime('now'))`,
  ]);
}

async function main() {
  const files = await listMigrations();
  if (!files.length) { console.log('no migration files found.'); return; }
  console.log(`Found ${files.length} migration file(s) in repo.`);

  // Bootstrap: if the tracking table doesn't exist, apply the 010 migration
  // by hand first so subsequent queries succeed.
  let applied;
  try {
    applied = queryAppliedFilenames();
  } catch (err) {
    if (!String(err.message).includes('no such table')) throw err;
    console.log('ff_schema_migrations does not exist yet — bootstrapping with migration 010');
    if (!files.includes(TRACKING_MIGRATION)) {
      console.error(`expected ${TRACKING_MIGRATION} in repo — aborting`);
      process.exit(1);
    }
    const hash = await sha256(path.join(REPO_ROOT, TRACKING_MIGRATION));
    applyFile(TRACKING_MIGRATION, hash);
    applied = queryAppliedFilenames();
  }
  console.log(`${applied.size} migration(s) already applied to ${isRemote ? 'PROD' : 'LOCAL'} D1.`);

  let runCount = 0;
  for (const f of files) {
    if (applied.has(f)) continue;
    const hash = await sha256(path.join(REPO_ROOT, f));
    applyFile(f, hash);
    runCount += 1;
  }
  if (runCount === 0) {
    console.log('✓ nothing to apply — DB is up to date.');
  } else {
    console.log(`✓ applied ${runCount} new migration(s).`);
  }
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
