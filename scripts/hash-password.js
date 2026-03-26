#!/usr/bin/env node
/**
 * Generate a PBKDF2-SHA256 hash for use as AUTH_PASSWORD_HASH.
 *
 * Usage:
 *   node scripts/hash-password.js "your-password"
 *
 * Then set the output as AUTH_PASSWORD_HASH:
 *   - Local dev:  paste into .dev.vars
 *   - Production: Cloudflare dashboard → Pages → Settings → Environment variables
 *                 (add as a Secret, not a plain variable)
 */

const crypto = require('crypto');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.js "your-password"');
  process.exit(1);
}

const ITERATIONS = 100_000;
const salt       = crypto.randomBytes(16);
const hash       = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');

const result = `pbkdf2:${ITERATIONS}:${salt.toString('hex')}:${hash.toString('hex')}`;
console.log(result);
