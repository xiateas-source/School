import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dailyQuestCareAward } from '../src/care.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Independent state-machine proof of the required lifecycle:
// first completion -> return -> retry -> approval correction/reopen.
let charges = 2;
let markerExists = false;
let totalAwards = 0;

const attempt = () => {
  const decision = dailyQuestCareAward(markerExists, charges);
  if (decision.createMarker) markerExists = true;
  charges = decision.after;
  totalAwards += decision.award;
  return decision;
};

const first = attempt();
assert.equal(first.careChargeGranted, true);
assert.equal(charges, 3);

// Return deletes only the mutable completion; the marker remains.
assert.equal(markerExists, true);

charges = 1; // Care may be spent before the retry; eligibility still must not reset.
const retry = attempt();
assert.equal(retry.careChargeGranted, false);
assert.equal(charges, 1);

// Approval correction/reopen also deletes only the mutable completion.
assert.equal(markerExists, true);
const reopened = attempt();
assert.equal(reopened.careChargeGranted, false);
assert.equal(totalAwards, 1, 'the entire Quest/date lifecycle awards at most one Care Charge');

// At the cap, the first attempt records award 0. Spending later cannot turn the
// same daily instance into a deferred charge.
let capped = dailyQuestCareAward(false, 6);
assert.deepEqual({ marker: capped.createMarker, award: capped.award }, { marker: true, award: 0 });
capped = dailyQuestCareAward(true, 4);
assert.equal(capped.award, 0);

const store = readFileSync(join(ROOT, 'src/store.js'), 'utf8');
const ledgerStore = readFileSync(join(ROOT, 'src/ledger-actions-store.js'), 'utf8');
const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const rejectStart = store.indexOf('export async function rejectCompletion');
const rejectEnd = store.indexOf('// --- Family feedback delivery', rejectStart);
const rejectStore = store.slice(rejectStart, rejectEnd);
const awardRuleStart = rules.indexOf('match /questCareAwards/{awardId}');
const awardRuleEnd = rules.indexOf('match /questCompletions/{completionId}', awardRuleStart);
const awardRules = rules.slice(awardRuleStart, awardRuleEnd);

assert.match(store, /questCareAwards/, 'store has a durable Care-award collection');
assert.match(store, /dailyQuestCareAward\(awardSnap\.exists\(\)/,
  'completion checks the immutable marker before deciding Care');
assert.match(store, /tx\.delete\(p\.completion\(completionId\)\)/,
  'return still removes the mutable completion so the quest can be retried');
assert.match(rejectStore, /if \(!awardSnap\.exists\(\)\) \{[\s\S]*?tx\.set\(p\.careAward\(completionId\)/,
  'return backfills a marker for pre-marker pending completions before deletion');
assert.ok(
  rejectStore.indexOf('tx.set(p.careAward(completionId)') < rejectStore.indexOf('tx.delete(p.completion(completionId))'),
  'the migration marker is written before the retryable completion is deleted'
);
assert.doesNotMatch(store, /tx\.delete\(p\.careAward/,
  'return/correction paths never delete the Care marker');
assert.match(ledgerStore, /careAward: id => doc\([\s\S]*?'questCareAwards'/,
  'the current My Progress correction path addresses the immutable marker');
assert.match(ledgerStore, /!state\.careAwardSnap\.exists\(\)[\s\S]*?tx\.set\(p\.careAward\(state\.completionId\)/,
  'a legacy approved completion receives a marker before correction reopens it');
assert.doesNotMatch(ledgerStore, /tx\.delete\(p\.careAward/,
  'My Progress correction never resets Care eligibility');

assert.match(rules, /match \/questCareAwards\/\{awardId\}/,
  'rules cover the immutable award collection');
assert.match(awardRules, /allow update, delete: if false;/,
  'the daily award marker is immutable even to normal parent clients');
assert.match(rules, /validCareEarn\(\)[\s\S]*?existsAfter\(awardPath\)[\s\S]*?getAfter\(awardPath\)\.data\.award == 1/,
  'a Care increment requires the first paired award marker');
assert.match(rules, /exists\(awardPath\) && d\.careChargeGranted == false/,
  'a retry with a prior marker must explicitly grant no Care');
assert.match(rules, /get\(questPath\)\.data\.get\('archived', false\) != true/,
  'an archived Quest cannot be completed by a child client');

console.log('Quest Care first/return/retry/correction idempotency: all checks passed.');
