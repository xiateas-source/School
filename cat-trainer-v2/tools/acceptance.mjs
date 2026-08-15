// Cat Trainer browser acceptance suite — Slice 2 checks a machine can own.
//
// Runs against the DEPLOYED app with a disposable QA family (QA-TESTING.md).
// Primary runner is the manually-triggered GitHub Actions workflow.
//
// Three rules this file lives by:
//
//   1. SAFETY FIRST. Before any mutation, the signed-in family must match
//      QA_FAMILY_ID exactly. Everything aborts if it doesn't.
//   2. NEVER LEAK. The email, password, and Family ID must not reach stdout, an
//      assertion message, or a screenshot. Failure screenshots are redacted in
//      the DOM before capture. Never interpolate a secret into a test name or
//      an error string.
//   3. RERUNNABLE, OR HONESTLY SKIPPED. There is no reset or seeding yet, so a
//      test either creates its own uniquely-named data, asserts a before/after
//      delta, or calls test.skip() with the specific reason it can't be made
//      deterministic. Never assert an absolute ledger total, and never leave a
//      test that only passes on a fresh account.

import { test, expect } from '@playwright/test';

const EMAIL = process.env.QA_PARENT_EMAIL;
const PASSWORD = process.env.QA_PARENT_PASSWORD;
const FAMILY_ID = process.env.QA_FAMILY_ID;

// A tag unique to this run, so created quests never collide with a previous
// run's leftovers and are trivially identifiable if cleanup ever fails.
const RUN = `QA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let parent;                  // signed-in parent page
let child = null;            // paired child page, or null
let childUnavailable = null; // why the child session is missing
const contexts = [];
const createdQuestIds = new Set();

// ---------------------------------------------------------------- helpers ---

const num = (text) => {
  const m = String(text ?? '').match(/-?\d+/);
  return m ? Number(m[0]) : NaN;
};

// "80/100" -> 80
const needValue = async (page, need) =>
  num(await page.getByTestId(`care-${need}-value`).textContent());

// Navigate via the BOTTOM NAV specifically. Several in-page shortcuts reuse the
// same attribute ("See all" -> quests/ledger, "Choose cat" -> cats), so an
// unscoped [data-pgo]/[data-cgo] matches two elements and Playwright correctly
// refuses to guess which one a human meant.
const parentGo = async (page, screen) => {
  await page.locator(`[data-parent-nav] [data-pgo="${screen}"]`).click();
  await expect(page.locator(`[data-pscreen="${screen}"]`)).toHaveClass(/active/);
};

const childGo = async (page, screen) => {
  await page.locator(`[data-child-nav] [data-cgo="${screen}"]`).click();
  await expect(page.locator(`[data-cscreen="${screen}"]`)).toHaveClass(/active/);
};

const questIds = async (locator) => {
  const ids = await locator.evaluateAll(els => els.map(e => e.getAttribute('data-quest-id')));
  return new Set(ids.filter(Boolean));
};

// Firestore is realtime, but a write still has to round-trip before the other
// role's DOM reflects it. Poll the condition rather than sleeping a fixed time.
const waitFor = async (fn, message, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try { if (await fn()) return; } catch (err) { last = err; }
    if (Date.now() > deadline) {
      throw new Error(`${message}${last ? ` (last error: ${last.message})` : ''}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
};

// Create a quest through the parent UI and return its id. Uniquely named so it
// cannot be confused with the family's real quests.
async function createQuest(page, { title, window = 'anytime', recurrence = 'everyday', onceDate }) {
  await parentGo(page, 'quests');
  await page.locator('[data-qtab="routines"]').click();
  await page.locator('#add-quest-btn').click();
  await page.locator('#q-title').fill(title);
  await page.locator('#q-window').selectOption(window);
  await page.locator('#q-recurrence').selectOption(recurrence);
  if (recurrence === 'one_time' && onceDate) await page.locator('#q-once-date').fill(onceDate);
  await page.locator('#quest-save').click();

  const row = page.locator(`[data-testid="parent-quest-row"]:has(strong:text-is("${title}"))`);
  await expect(row).toHaveCount(1);
  const id = await row.getAttribute('data-quest-id');
  createdQuestIds.add(id);
  return id;
}

async function deleteQuest(page, id) {
  await parentGo(page, 'quests');
  await page.locator('[data-qtab="routines"]').click();
  const row = page.locator(`[data-testid="parent-quest-row"][data-quest-id="${id}"]`);
  if (!(await row.count())) { createdQuestIds.delete(id); return; }
  page.once('dialog', d => d.accept()); // deletion is confirm()-gated
  await row.locator('[data-del-quest]').click();
  await expect(row).toHaveCount(0);
  createdQuestIds.delete(id);
}

// The local calendar date in the family's timezone — must match the app's own
// notion of "today" or one_time recurrence tests would be off by a day.
const familyDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
};

// Blank every field that holds a secret, then screenshot. Used on failure only.
// Artifacts from a public repo are world-readable, so this is not optional.
async function redactedShot(page, name) {
  try {
    await page.evaluate(() => {
      document.querySelectorAll('input').forEach(i => {
        if (i.type === 'password' || i.type === 'email') i.value = '';
      });
      const fam = document.querySelector('[data-testid="settings-family-id"]');
      if (fam) fam.textContent = '[redacted]';
    });
    await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
  } catch { /* a screenshot is a nicety; never fail a test over one */ }
}

// ------------------------------------------------------------------ setup ---

test.beforeAll(async ({ browser }) => {
  // Fail loudly on missing config, without echoing anything about its value.
  const missing = ['QA_PARENT_EMAIL', 'QA_PARENT_PASSWORD', 'QA_FAMILY_ID']
    .filter(k => !process.env[k]);
  if (missing.length) throw new Error(`Missing required secret(s): ${missing.join(', ')}`);

  const ctx = await browser.newContext();
  contexts.push(ctx);
  parent = await ctx.newPage();
  await parent.goto('./');

  await parent.getByTestId('role-parent').click();
  // The app binds its gate handlers after an async Firebase boot, so the first
  // click can land on nothing. Confirm the form is actually up before typing.
  await expect(parent.locator('[data-screen="parent-signin"]')).toBeVisible({ timeout: 30_000 });
  await parent.getByTestId('signin-email').fill(EMAIL);
  await parent.getByTestId('signin-password').fill(PASSWORD);
  await parent.getByTestId('signin-submit').click();
  await expect(parent.getByTestId('parent-shell')).toBeVisible({ timeout: 45_000 });

  // ---- THE SAFETY GATE. Nothing below this line may mutate anything. ----
  await parentGo(parent, 'settings');
  const signedInFamily = (await parent.getByTestId('settings-family-id').textContent() || '').trim();
  if (signedInFamily !== FAMILY_ID) {
    await redactedShot(parent, 'family-gate-abort');
    // Deliberately does not print either id — the point is to not leak them.
    throw new Error(
      'FAMILY GATE FAILED: the signed-in family does not match QA_FAMILY_ID. ' +
      'Aborting before any mutation. Check the QA secrets.'
    );
  }

  // Child session: paired inside this run, because codes are single-use and
  // expire in 15 minutes. Non-fatal — child-dependent tests skip with a reason
  // so the parent-only checks still report.
  try {
    await parent.locator('#make-code-btn').click();
    const code = (await parent.getByTestId('pair-code-value').textContent() || '').trim();
    if (!/^\d{6}$/.test(code)) throw new Error('no 6-digit code was displayed');

    const childCtx = await browser.newContext();
    contexts.push(childCtx);
    const page = await childCtx.newPage();
    await page.goto('./');
    await page.getByTestId('role-child').click();
    await expect(page.locator('[data-screen="child-pair"]')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('pair-code').fill(code);
    await page.getByTestId('pair-submit').click();
    await expect(page.getByTestId('child-shell')).toBeVisible({ timeout: 45_000 });
    child = page;
  } catch (err) {
    childUnavailable =
      `child pairing failed (${err.message}). Most likely cause: the hardened ` +
      'pairing rules from PR #56 have not been published in the Firebase console, ' +
      'which makes the atomic redeem-and-consume batch fail.';
  }
});

test.afterAll(async () => {
  // Best-effort cleanup so the QA family doesn't accumulate test quests.
  for (const id of [...createdQuestIds]) {
    try { await deleteQuest(parent, id); } catch { /* reported below */ }
  }
  if (createdQuestIds.size) {
    console.log(`NOTE: could not delete ${createdQuestIds.size} test quest(s) named ${RUN}-*.`);
  }
  for (const ctx of contexts) { try { await ctx.close(); } catch { /* already gone */ } }
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === 'failed' || testInfo.status === 'timedOut') {
    await redactedShot(parent, `fail-${testInfo.title.replace(/\W+/g, '-').slice(0, 40)}`);
  }
});

// ------------------------------------------------------------------ tests ---

test('00 · QA family safety gate', async () => {
  await parentGo(parent, 'settings');
  const fam = (await parent.getByTestId('settings-family-id').textContent() || '').trim();
  expect(fam === FAMILY_ID, 'signed-in family must equal QA_FAMILY_ID').toBe(true);
});

test('01 · Parent Quests opens to Today', async () => {
  await parentGo(parent, 'dash');
  await parentGo(parent, 'quests');
  await expect(parent.locator('[data-qpanel="today"]')).toBeVisible();
  await expect(parent.locator('[data-qpanel="routines"]')).toBeHidden();
  await expect(parent.locator('[data-qpanel="log"]')).toBeHidden();
  await expect(parent.locator('[data-qtab="today"]')).toHaveAttribute('aria-selected', 'true');
});

test('02 · Needs You / approval flow grants the quest\'s minutes', async () => {
  test.skip(!child, childUnavailable || 'no child session');

  await childGo(child, 'quests');
  const todo = child.locator('[data-testid="quest-card"][data-quest-status="todo"]').first();
  test.skip(!(await todo.count()), 'every quest on the QA child board is already done today — nothing left to submit (needs the deferred reset/seeding work)');

  const questId = await todo.getAttribute('data-quest-id');
  const points = num((await todo.locator('.q-reward').textContent() || '').match(/\+(\d+)m/)?.[1]);

  await parentGo(parent, 'dash');
  const before = num(await parent.getByTestId('parent-available').textContent());
  const pendingBefore = await parent.locator('[data-testid="approval-row"]').count();

  await todo.locator('[data-complete]').click();
  await expect(child.locator(`[data-testid="quest-card"][data-quest-id="${questId}"]`))
    .toHaveAttribute('data-quest-status', 'pending');

  // The parent's queue must pick it up over realtime sync, with the right quest.
  const row = parent.locator(`[data-testid="approval-row"][data-quest-id="${questId}"]`);
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(parent.getByTestId('approvals-card')).toBeVisible();

  await row.locator('[data-approve]').click();
  await expect(row).toHaveCount(0, { timeout: 30_000 });

  await waitFor(
    async () => num(await parent.getByTestId('parent-available').textContent()) > before,
    'available minutes did not increase after approval'
  );
  const after = num(await parent.getByTestId('parent-available').textContent());
  if (Number.isFinite(points)) {
    expect(after - before, 'approval must grant exactly the quest\'s points').toBe(points);
  }
  expect(await parent.locator('[data-testid="approval-row"]').count()).toBe(pendingBefore);
});

test('03 · Parent Today shows nothing that is not on the child\'s board', async () => {
  test.skip(!child, childUnavailable || 'no child session');

  await parentGo(parent, 'quests');
  await childGo(child, 'quests');
  const onBoard = await questIds(parent.locator('[data-testid="ptoday-row"]'));
  const onChild = await questIds(child.locator('[data-testid="quest-card"]'));

  // Subset, not equality: parent Today summarises future dayparts as counted
  // chips ("COMING UP") rather than listing those quests as rows.
  const extra = [...onBoard].filter(id => !onChild.has(id));
  expect(extra, 'quests on parent Today but not on the child\'s screen').toEqual([]);
});

test('04 · Child Home preview agrees with the child\'s own quest list', async () => {
  test.skip(!child, childUnavailable || 'no child session');

  await childGo(child, 'quests');
  const all = await questIds(child.locator('[data-testid="quest-card"]'));
  await childGo(child, 'home');
  const preview = child.locator('[data-testid="child-next-quests"] [data-testid="quest-card"]');

  for (const card of await preview.all()) {
    const id = await card.getAttribute('data-quest-id');
    expect(all.has(id), `home preview shows ${id}, which is not on the quests screen`).toBe(true);
    await expect(card).toHaveAttribute('data-quest-status', 'todo');
  }
  expect(await preview.count()).toBeLessThanOrEqual(3);
});

test('05 · "On Sirus\'s screen now" matches the child\'s screen exactly', async () => {
  test.skip(!child, childUnavailable || 'no child session');

  await childGo(child, 'quests');
  const onChild = await questIds(child.locator('[data-testid="quest-card"]'));
  await parentGo(parent, 'quests');
  await parent.locator('[data-qtab="routines"]').click();
  const mirror = await questIds(parent.locator('[data-testid="sirus-today-row"]'));

  expect([...mirror].sort(), 'the mirror must list exactly the child\'s planned quests')
    .toEqual([...onChild].sort());
});

test('06 · Skip removes a quest from today everywhere, Undo restores it', async () => {
  const title = `${RUN}-skip`;
  const id = await createQuest(parent, { title, window: 'anytime', recurrence: 'everyday' });

  await parent.locator('[data-qtab="today"]').click();
  const boardRow = parent.locator(`[data-testid="ptoday-row"][data-quest-id="${id}"]`);
  await expect(boardRow).toHaveCount(1);

  await boardRow.locator('[data-today-skip]').click();

  // Off the board, and listed as a one-day exception instead.
  await expect(boardRow).toHaveCount(0, { timeout: 30_000 });
  const exception = parent.locator(`[data-testid="exception-row"][data-quest-id="${id}"]`);
  await expect(exception).toHaveCount(1);
  await expect(exception).toContainText('Skipped today');

  // The parent's mirror of the child's screen must agree.
  await parent.locator('[data-qtab="routines"]').click();
  await expect(parent.locator(`[data-testid="sirus-today-row"][data-quest-id="${id}"]`)).toHaveCount(0);

  if (child) {
    await childGo(child, 'quests');
    await waitFor(
      async () => (await child.locator(`[data-testid="quest-card"][data-quest-id="${id}"]`).count()) === 0,
      'a skipped quest was still on the child\'s screen'
    );
  }

  // Undo puts it back — the only place a skip can be undone.
  await parent.locator('[data-qtab="today"]').click();
  await exception.locator('[data-today-clear]').click();
  await expect(boardRow).toHaveCount(1, { timeout: 30_000 });
  await expect(exception).toHaveCount(0);

  await deleteQuest(parent, id);
});

test('07 · Later moves a quest to a later daypart today', async () => {
  const title = `${RUN}-later`;
  const id = await createQuest(parent, { title, window: 'morning', recurrence: 'everyday' });

  await parent.locator('[data-qtab="today"]').click();
  const row = parent.locator(`[data-testid="ptoday-row"][data-quest-id="${id}"]`);
  await expect(row).toHaveCount(1);

  const later = row.locator('[data-today-move]');
  if (!(await later.count())) {
    await deleteQuest(parent, id);
    test.skip(true, 'no genuinely-later daypart exists at the current time of day, so the Later action is correctly hidden — proving the positive case needs the deferred fake-clock work');
  }

  await later.click();
  await expect(row).toContainText('moved to later', { timeout: 30_000 });
  await expect(row.locator('[data-today-clear]')).toHaveCount(1);
  const exception = parent.locator(`[data-testid="exception-row"][data-quest-id="${id}"]`);
  await expect(exception).toContainText('Moved to');

  await row.locator('[data-today-clear]').click();
  await expect(exception).toHaveCount(0, { timeout: 30_000 });
  await expect(row.locator('[data-today-skip]')).toHaveCount(1);

  await deleteQuest(parent, id);
});

test('08 · Next marks a quest as the next mission, Undo clears it', async () => {
  const title = `${RUN}-next`;
  const id = await createQuest(parent, { title, window: 'anytime', recurrence: 'everyday' });

  await parent.locator('[data-qtab="today"]').click();
  const row = parent.locator(`[data-testid="ptoday-row"][data-quest-id="${id}"]`);
  await expect(row).toHaveCount(1);

  await row.locator('[data-today-next]').click();
  await expect(row).toContainText('next', { timeout: 30_000 });
  const exception = parent.locator(`[data-testid="exception-row"][data-quest-id="${id}"]`);
  await expect(exception).toContainText('Made next');

  await row.locator('[data-today-clear]').click();
  await expect(exception).toHaveCount(0, { timeout: 30_000 });

  await deleteQuest(parent, id);
});

test('09 · Today Is Different offers its presets, and Custom changes nothing', async () => {
  await parentGo(parent, 'quests');
  await parent.locator('[data-qtab="today"]').click();

  const exceptionsBefore = await parent.locator('[data-testid="exception-row"]').count();
  await parent.locator('[data-today-presets]').click();

  const dialog = parent.locator('#today-different-dialog');
  await expect(dialog).toBeVisible();
  for (const preset of ['sick', 'school_off', 'out', 'easy_morning', 'custom']) {
    await expect(dialog.locator(`[data-preset="${preset}"]`)).toHaveCount(1);
  }

  // Custom is the one preset that is defined to write nothing — it hands control
  // to the per-quest actions. The bulk presets (sick / out / school_off /
  // easy_morning) skip many quests at once and there is no way to undo them in
  // bulk, so they stay manual until the reset work lands.
  await dialog.locator('[data-preset="custom"]').click();
  await expect(dialog).toBeHidden();
  expect(
    await parent.locator('[data-testid="exception-row"]').count(),
    'Custom must not create any exception'
  ).toBe(exceptionsBefore);
});

test('10 · Recurrence: a one-time quest shows today but not when dated tomorrow', async () => {
  const todayId = await createQuest(parent, {
    title: `${RUN}-today`, window: 'anytime', recurrence: 'one_time', onceDate: familyDate(0)
  });
  const tomorrowId = await createQuest(parent, {
    title: `${RUN}-tomorrow`, window: 'anytime', recurrence: 'one_time', onceDate: familyDate(1)
  });

  await parent.locator('[data-qtab="today"]').click();
  await expect(parent.locator(`[data-testid="ptoday-row"][data-quest-id="${todayId}"]`)).toHaveCount(1);
  await expect(parent.locator(`[data-testid="ptoday-row"][data-quest-id="${tomorrowId}"]`)).toHaveCount(0);

  await parent.locator('[data-qtab="routines"]').click();
  await expect(parent.locator(`[data-testid="sirus-today-row"][data-quest-id="${todayId}"]`)).toHaveCount(1);
  await expect(parent.locator(`[data-testid="sirus-today-row"][data-quest-id="${tomorrowId}"]`)).toHaveCount(0);

  if (child) {
    await childGo(child, 'quests');
    await waitFor(
      async () => (await child.locator(`[data-testid="quest-card"][data-quest-id="${todayId}"]`).count()) === 1,
      'a one-time quest dated today never reached the child\'s screen'
    );
    expect(
      await child.locator(`[data-testid="quest-card"][data-quest-id="${tomorrowId}"]`).count(),
      'a quest dated tomorrow must not be on the child\'s screen today'
    ).toBe(0);
  }

  await deleteQuest(parent, todayId);
  await deleteQuest(parent, tomorrowId);
});

test('11 · Completing a quest earns exactly one Care Charge', async () => {
  test.skip(!child, childUnavailable || 'no child session');

  await childGo(child, 'cafe');
  const before = num(await child.getByTestId('child-care-charges').textContent());
  test.skip(before >= 6, 'the QA child is already at the 6-charge cap, so a further earn is correctly refused (needs the deferred reset work to clear)');

  await childGo(child, 'quests');
  const todo = child.locator('[data-testid="quest-card"][data-quest-status="todo"]').first();
  test.skip(!(await todo.count()), 'every quest on the QA child board is already done today (needs the deferred reset/seeding work)');

  await todo.locator('[data-complete]').click();
  await childGo(child, 'cafe');
  await waitFor(
    async () => num(await child.getByTestId('child-care-charges').textContent()) === before + 1,
    'completing a quest did not grant exactly one Care Charge'
  );
});

test('12 · Feed/Rest/Play spends one charge and refills that need', async () => {
  test.skip(!child, childUnavailable || 'no child session');

  await childGo(child, 'cafe');
  const cue = child.getByTestId('care-need-cue');
  test.skip(
    !(await cue.isVisible()),
    'no need is low enough for the cat to ask for care, so there is nothing to refill — proving this needs the deferred hungry-cat scenario seed'
  );

  const charges = num(await child.getByTestId('child-care-charges').textContent());
  test.skip(charges < 1, 'the QA child has no Care Charge to spend (needs the deferred scenario seed)');

  const need = await cue.getAttribute('data-need');
  const before = await needValue(child, need);

  await cue.click();
  await waitFor(
    async () => num(await child.getByTestId('child-care-charges').textContent()) === charges - 1,
    'care did not spend exactly one charge'
  );
  const after = await needValue(child, need);
  expect(after, `${need} must rise by the +20 refill (capped at 100)`).toBe(Math.min(100, before + 20));
});
