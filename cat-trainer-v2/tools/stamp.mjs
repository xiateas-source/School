#!/usr/bin/env node
// Cache-busting stamp for the no-build ES-module app.
//
// The problem: browsers cache each module by its full URL. Because static
// imports (`import './firebase.js'`) carry no version, a phone can keep serving
// an OLD copy of a module after a deploy while other files are fresh — an
// inconsistent, sometimes-broken state that only a full tab close/reopen fixes.
//
// The fix: append a `?v=<hash>` query to every LOCAL module import, the entry
// <script>, and the CSS <link>. A new URL is a cache miss, so the browser
// fetches the new copy. CDN imports (https://…, already version-pinned) are
// left alone.
//
// The version is a content hash of the source files (with any existing stamp
// stripped first), so this script is:
//   • idempotent  — running it twice in a row changes nothing;
//   • deterministic — the same source always yields the same version;
//   • minimal      — the hash (and therefore the URLs) only changes when a
//                    file's real content changes, so unchanged modules stay
//                    cached across deploys.
//
// Run it from anywhere before committing a deploy:  node tools/stamp.mjs
// (see HANDOFF.md §11). No dependencies, no build output — it edits in place.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Files whose contents feed the version hash AND that get stamped. Order is
// fixed so the concatenated hash is stable regardless of filesystem ordering.
const FILES = [
  'index.html',
  'styles/base.css',
  'styles/polish.css',
  'sw.js',
  'firebase-config.js',
  'src/app.js',
  'src/ledger-actions.js',
  'src/ledger-actions-store.js',
  'src/polish.js',
  'src/auth.js',
  'src/store.js',
  'src/firebase.js',
  'src/care.js',
  'src/cafe-interactions.js',
  'src/data/cats.js',
  'src/data/quests.js',
  'src/data/cafe-items.js',
  'src/shared/rewards.js',
  'src/shared/ledger.js',
  'src/shared/corrections.js',
  'src/shared/feedback.js',
  'src/shared/dates.js',
  'src/shared/routines.js',
  'src/shared/quest-management.js',
  'src/shared/pairing.js'
];

// Normalize a file to its canonical, un-stamped form so hashing and re-stamping
// are stable: drop any ?v=… query we own, and blank the service worker's
// CACHE_VERSION so the hash doesn't depend on the value we're about to write.
const unstamp = (s) =>
  s
    .replace(/\?v=[^'"\s)]*/g, '')
    .replace(/(const CACHE_VERSION = ')[^']*(')/, '$1$2');

// --- JS: local relative imports ending in .js -------------------------------
// Matches:  from './x.js'  ·  from '../x.js'  ·  import('./x.js')
// Skips CDN / bare specifiers (they don't start with ./ or ../) and template
// literals (backtick strings with ${…}).
function restampJs(clean, version) {
  const staticImport = /(\bfrom\s*['"])(\.\.?\/[^'"?]+?\.js)(['"])/g;
  const dynImport = /(\bimport\s*\(\s*['"])(\.\.?\/[^'"?]+?\.js)(['"]\s*\))/g;
  return clean
    .replace(staticImport, (_m, pre, spec, post) => `${pre}${spec}?v=${version}${post}`)
    .replace(dynImport, (_m, pre, spec, post) => `${pre}${spec}?v=${version}${post}`);
}

// --- sw.js: the cache version constant --------------------------------------
function restampSw(clean, version) {
  return clean.replace(
    /(const CACHE_VERSION = ')[^']*(')/,
    (_m, pre, post) => `${pre}${version}${post}`
  );
}

// --- index.html: every local entry module + stylesheet ----------------------
// Matches any local <script src="src/*.js"> and <link href="styles/*.css">, so
// the presentation layer (polish.js / polish.css) is versioned alongside the app
// entry instead of having its ?v= stripped by unstamp and never re-applied.
function restampHtml(clean, version) {
  return clean
    .replace(/(<script\b[^>]*\bsrc=")((?:src|styles)\/[^"?]+?\.js)(")/g,
      (_m, pre, spec, post) => `${pre}${spec}?v=${version}${post}`)
    .replace(/(<link\b[^>]*\bhref=")(styles\/[^"?]+?\.css)(")/g,
      (_m, pre, spec, post) => `${pre}${spec}?v=${version}${post}`);
}

// 1. Read every file, strip old stamps to get the canonical "clean" content.
const cleaned = FILES.map((rel) => ({
  rel,
  path: join(ROOT, rel),
  clean: unstamp(readFileSync(join(ROOT, rel), 'utf8'))
}));

// 2. Version = short sha256 of the concatenated clean contents.
const hash = createHash('sha256');
for (const f of cleaned) hash.update(`${f.rel}\0${f.clean}\0`);
const version = hash.digest('hex').slice(0, 8);

// 3. Re-stamp and write back only the files that actually change.
let changed = 0;
for (const f of cleaned) {
  const stamped = f.rel.endsWith('.html')
    ? restampHtml(f.clean, version)
    : f.rel === 'sw.js'
      ? restampSw(f.clean, version)
      : restampJs(f.clean, version);
  const before = readFileSync(f.path, 'utf8');
  if (stamped !== before) {
    writeFileSync(f.path, stamped);
    changed++;
    console.log(`  stamped ${f.rel}`);
  }
}

console.log(`\nCache-bust version: ${version}  (${changed} file${changed === 1 ? '' : 's'} updated)`);
