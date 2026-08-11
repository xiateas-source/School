import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

const index = read('index.html');
const ui = read('src/ledger-actions.js');
const actions = read('src/ledger-actions-store.js');
const core = read('src/shared/corrections.js');
const rules = read('firestore.rules');
const stamp = read('tools/stamp.mjs');

// App wiring: Slice 3 is additive and does not replace the existing app shell.
assert.match(index, /src\/app\.js\?v=/, 'main app still loads');
assert.match(index, /src\/ledger-actions\.js\?v=/, 'Slice 3 parent action layer loads');
assert.match(index, /src\/polish\.js\?v=/, 'polish layer still loads');

// Normal mistakes are corrections, not silent delete.
assert.match(ui, /Correct entry/, 'parent UI exposes Correct entry');
assert.match(ui, /Correct last/, 'dashboard Undo becomes Correct last');
assert.match(ui, /data-s3-correct/, 'dashboard/day actions route through correction');
assert.match(ui, /legacyDelete[\s\S]*data-del-txn/, 'pre-enhancement legacy trash clicks are intercepted too');
assert.match(ui, /Care Charges, completed care, Hero-care days, needs, and evolution stay unchanged/, 'quest correction confirms forward-only Café effects');
assert.match(actions, /reversesTransactionId: original\.id/, 'correction links to original');
assert.match(actions, /correctionTransactionId\(txnId\)/, 'one deterministic correction id per original');
assert.match(core, /CORRECTION_ID_PREFIX = 'corr_'/, 'deterministic correction namespace exists');

// Parent-only permanent cleanup remains a separate, intentionally rare path.
assert.match(ui, /<summary>Cleanup<\/summary>/, 'permanent delete is tucked behind Cleanup');
assert.match(ui, /Delete permanently/, 'cleanup action is explicit');
assert.match(actions, /permanentDeletePlanEligibility\(plan\)/, 'delete requires every known effect to remain fully reversible');
assert.match(actions, /tx\.delete\(p\.feedback\(recognitionEventId\(original\.id\)\)\)/, 'cleanup/correction removes linked recognition feedback');
assert.match(rules, /match \/pointTransactions\/\{txnId\}[\s\S]*allow update: if false;/, 'point rows remain immutable');
assert.match(rules, /match \/pointTransactions\/\{txnId\}[\s\S]*allow delete: if isParent\(fid\);/, 'rare cleanup delete remains parent-only');

// Corrections never roll back forward-only Café outcomes.
assert.match(actions, /do not touch evolved, heroCareProgress, needs, or Care Charges/i);
assert.doesNotMatch(actions, /heroCareProgress\s*:/, 'correction writes never replace Hero-care progress');
assert.doesNotMatch(actions, /careCharges\s*:/, 'correction writes never change Care Charges');

// Slice 3 reflection/backdating pieces.
assert.match(ui, /Add entry to this day/, 'past-day ledger can add a missed event');
assert.match(ui, /activityDate: day/, 'backdated writes use selected activity date');
assert.match(ui, /data-quick="hero_reset"/, 'Hero Reset quick action is intercepted for linking');
assert.match(actions, /findHeroResetTarget\(rows, day\)/, 'Hero Reset links to a same-day Room-to-Grow event');
assert.match(ui, /Recovery linked to the earlier Room to Grow moment/, 'linked recovery is explained in the ledger');
assert.match(ui, /Corrects: \$\{\(original && original\.reasonLabel\)/, 'parent correction gets a readable original-entry link');

// The enhancer is scoped to history mounts, not the entire Café DOM.
assert.match(ui, /\['#dash-ledger', '#p-ledger-view', '#c-progress-view'\]/);
assert.doesNotMatch(ui, /observer\.observe\(document\.documentElement/, 'Café mutations do not wake the ledger enhancer');

// Cache stamping must include every new local module.
assert.match(stamp, /'src\/ledger-actions\.js'/);
assert.match(stamp, /'src\/ledger-actions-store\.js'/);
assert.match(stamp, /'src\/shared\/corrections\.js'/);

console.log('Slice 3 integration boundary: all checks passed.');
