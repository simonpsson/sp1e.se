#!/usr/bin/env node
/**
 * Fix UTF-8 mojibake (double-encoded latin characters) in source files.
 * Safe to run multiple times — replacements are idempotent.
 *
 * Usage:  node scripts/fix-encoding.js [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const DRY_RUN = process.argv.includes('--dry-run');

const REPLACEMENTS = {
  'Ã¥': 'å', 'Ã¤': 'ä', 'Ã¶': 'ö', 'Ã©': 'é',
  'Ã„': 'Ä', 'Ã–': 'Ö', 'Ã…': 'Å', 'Ã¼': 'ü',
  'Ã¨': 'è', 'Ã¡': 'á', 'Ã³': 'ó', 'Ã±': 'ñ',
  'Ã§': 'ç',
};

const EXTS      = new Set(['.sql', '.ts', '.html', '.md', '.css', '.js']);
const SKIP      = new Set(['node_modules', '.git', 'output', 'dist']);
const SKIP_FILE = new Set(['fix-encoding.js']);

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) results.push(...walk(full));
    else if (EXTS.has(extname(entry)) && !SKIP_FILE.has(entry)) results.push(full);
  }
  return results;
}

let totalFiles = 0;
let totalReplacements = 0;

for (const file of walk('.')) {
  let content = readFileSync(file, 'utf-8');
  // Strip UTF-8 BOM if present
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

  let changed = false;
  for (const [bad, good] of Object.entries(REPLACEMENTS)) {
    if (content.includes(bad)) {
      content = content.split(bad).join(good);
      changed = true;
      totalReplacements++;
    }
  }
  if (changed) {
    totalFiles++;
    if (DRY_RUN) {
      console.log(`[dry-run] Would fix: ${file}`);
    } else {
      writeFileSync(file, content, 'utf-8');
      console.log(`Fixed: ${file}`);
    }
  }
}

if (totalFiles === 0) {
  console.log('No mojibake found — repo is clean.');
} else {
  console.log(`\nTotal: ${totalReplacements} patterns fixed in ${totalFiles} files${DRY_RUN ? ' (dry run)' : ''}`);
}
