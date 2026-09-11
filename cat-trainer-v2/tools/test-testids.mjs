import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The `data-testid` set is a CONTRACT with the browser agents that drive the
// deployed app (see QA-TESTING.md). A rename or a deleted hook silently breaks
// every acceptance run, and the breakage only shows up as a confused agent, so
// the contract is asserted here instead.
//
// Adding a hook is free. REMOVING or RENAMING one means updating QA-TESTING.md
// and the agent prompts in the same change — that is exactly the review this
// test is meant to force.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const app = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
const doc = readFileSync(join(ROOT, 'QA-TESTING.md'), 'utf8');

// Hooks that live in the static markup.
const STATIC_IDS = [
  // Role gate + the three sign-in paths: an agent's first moves.
  'gate', 'role-parent', 'role-coparent', 'role-child', 'gate-note',
  'signin-email', 'signin-password', 'signin-submit', 'signin-note',
  'coparent-email', 'coparent-password', 'coparent-code', 'coparent-submit', 'coparent-note',
  'pair-code', 'pair-submit', 'pair-note',
  // Parent shell: which shell, the balance, the approval queue.
  'parent-shell', 'parent-available',
  'approvals-card', 'approvals-count', 'approvals-list',
  'quest-bulk-toolbar', 'quest-bulk-edit',
  'quest-bulk-dialog', 'quest-bulk-action', 'quest-bulk-apply',
  'quest-return-dialog', 'quest-return-note', 'quest-return-submit',
  // One-tap import of Sirus's real course list into the School daypart.
  'school-import-card', 'school-import',
  // Quest manager: select mode, its pinned bar, and the per-row action sheet.
  'quest-select-mode', 'quest-actions-dialog',
  // Parent settings: pairing handoff + the family this session is in.
  'make-pair-code', 'pair-code-display', 'make-coparent-code', 'coparent-code-display',
  'settings-email', 'settings-family-id', 'signout',
  // The only route to the parent Cafe screen. Without it that screen is
  // orphaned: it renders on every update but nothing navigates to it, which is
  // exactly how the Return control shipped unreachable.
  'parent-cafe-link',
  // Child shell: which shell, the wallets, the quest lists, the care readouts.
  'child-shell', 'child-available', 'child-coins', 'child-care-charges',
  'child-next-quests', 'child-quest-list',
  'care-need-cue',
  'care-hunger-value', 'care-hunger-band',
  'care-rest-value', 'care-rest-band',
  'care-happiness-value', 'care-happiness-band'
];

// Hooks rendered from JS templates.
const DYNAMIC_IDS = [
  'pair-code-value',    // the 6 digits, split out of the expiry copy around them
  'coparent-code-value',
  'approval-row',       // carries data-quest-id
  'quest-card',         // carries data-quest-id + data-quest-status
  // Row hooks the acceptance suite drives. Each carries data-quest-id so a test
  // can act on one specific quest instead of matching on displayed text.
  'ptoday-row',         // a quest row on the parent's Today board
  'exception-row',      // a today-only exception in the Today-is-different card
  'sirus-today-row',    // the parent's mirror of the child's screen
  'parent-quest-row',   // a row in the quest management list
  'quest-selection',    // a management-row bulk-selection checkbox
  'returned-feedback',  // gentle child card after a parent return
  'parent-cafe-row'     // an owned cafe item in the parent Cafe card; carries
                        // data-item-id and the QA-unblocking Return control
];

for (const id of STATIC_IDS) {
  const count = html.split(`data-testid="${id}"`).length - 1;
  assert.equal(count, 1, `index.html must carry exactly one data-testid="${id}" (found ${count})`);
}
for (const id of DYNAMIC_IDS) {
  assert.ok(
    app.includes(`data-testid="${id}"`) || app.includes(`setAttribute('data-testid', '${id}')`),
    `src/app.js must render data-testid="${id}"`
  );
}

// An orphaned screen is a silent failure: it renders, it just can't be reached.
// Assert the link and the screen it targets actually agree.
assert.ok(
  html.includes('data-pgo="cafe"') && html.includes('data-pscreen="cafe"'),
  'the parent Cafe screen must have both a data-pgo="cafe" trigger and its data-pscreen="cafe" target'
);

assert.match(
  app, /data-testid="parent-cafe-row" data-item-id=/,
  'a parent cafe row must identify its item'
);
assert.ok(
  app.includes('data-return-item='),
  'a parent cafe row must expose the Return control the cafe purchase test needs'
);

// A testid alone isn't enough for the rows an agent has to tell apart: it must be
// able to say WHICH quest a row is about, and for a quest card, where it stands.
assert.match(
  app, /data-testid="approval-row" data-quest-id=/,
  'an approval row must identify its quest'
);
assert.match(
  app, /data-testid="quest-card" data-quest-id="\$\{esc\(q\.id\)\}" data-quest-status=/,
  'a quest card must identify its quest and its status'
);
assert.match(
  app, /data-quest-status="\$\{status \|\| 'todo'\}"/,
  "quest status must always be one of todo/pending/approved — never empty"
);

// Every hook must be documented, or agents can't discover it.
for (const id of [...STATIC_IDS, ...DYNAMIC_IDS]) {
  assert.ok(doc.includes(`\`${id}\``), `QA-TESTING.md must document the ${id} hook`);
}

// Every hook the acceptance suite reaches for must be one that actually exists.
// The suite runs against the deployed app from CI, so a typo there surfaces as a
// confusing timeout minutes into a run; catching it here costs nothing.
{
  const suite = readFileSync(join(ROOT, 'tools/acceptance.mjs'), 'utf8');
  const known = new Set([...STATIC_IDS, ...DYNAMIC_IDS]);
  const used = new Set();
  for (const m of suite.matchAll(/getByTestId\(\s*['"`]([^'"`$]+)['"`]\s*\)/g)) used.add(m[1]);
  for (const m of suite.matchAll(/\[data-testid="([^"$]+)"\]/g)) used.add(m[1]);
  for (const id of used) {
    assert.ok(known.has(id), `tools/acceptance.mjs uses data-testid="${id}", which the app does not define`);
  }
  assert.ok(used.size >= 10, 'the acceptance suite should be driving the testid contract, not text selectors');
}

// The docs must never carry a real credential. QA accounts are real accounts;
// the runbook explains where secrets live, and it is not here.
assert.doesNotMatch(
  doc, /password\s*[:=]\s*["'`]?\S{6,}/i,
  'QA-TESTING.md must not contain a password'
);

console.log(`Browser-agent testids: all checks passed (${STATIC_IDS.length + DYNAMIC_IDS.length} hooks).`);
