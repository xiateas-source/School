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
  // Parent settings: pairing handoff + the family this session is in.
  'make-pair-code', 'pair-code-display', 'make-coparent-code', 'coparent-code-display',
  'settings-email', 'settings-family-id', 'signout',
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
  'quest-card'          // carries data-quest-id + data-quest-status
];

for (const id of STATIC_IDS) {
  const count = html.split(`data-testid="${id}"`).length - 1;
  assert.equal(count, 1, `index.html must carry exactly one data-testid="${id}" (found ${count})`);
}
for (const id of DYNAMIC_IDS) {
  assert.ok(
    app.includes(`data-testid="${id}"`),
    `src/app.js must render data-testid="${id}"`
  );
}

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

// The docs must never carry a real credential. QA accounts are real accounts;
// the runbook explains where secrets live, and it is not here.
assert.doesNotMatch(
  doc, /password\s*[:=]\s*["'`]?\S{6,}/i,
  'QA-TESTING.md must not contain a password'
);

console.log(`Browser-agent testids: all checks passed (${STATIC_IDS.length + DYNAMIC_IDS.length} hooks).`);
