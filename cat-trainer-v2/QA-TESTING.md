# QA testing with browser agents

How a Claude/GPT browser agent signs into Cat Trainer and exercises real
workflows — **without ever touching our family's data**.

This is the Slice 0–3 runbook: an isolated QA family, and the stable hooks an
agent needs to drive the app. There is deliberately **no** reset button, no
scenario seeder, and no fake clock yet — the point of this stage is to run real
agent sessions and find out which of those we actually need.

---

## 1. How isolation works

Cat Trainer has no "test mode", and it doesn't need one. A family is identified
by the uid of the parent account that owns it (`families/{ownerUid}`), and every
read and write in `firestore.rules` is gated on being a **member** of that
family. So:

> A separate email account creates a separate family. It cannot read our family,
> cannot write to it, and cannot even discover that it exists.

That is enforced by the security rules on the server — not by a flag, a URL, or
anything the app chooses to show. A QA agent holding QA credentials has exactly
the access a stranger has to our data: **none**.

The QA family is a real family in the same Firebase project, running the exact
build that ships. That's the point: agents test what Sirus actually uses.

**What this costs:** QA runs spend the same free-tier Firestore quota as the real
app. A handful of runs a day is nothing; a loop hammering the app all night could
exhaust the daily quota and break Cat Trainer for Sirus. Keep runs deliberate.

---

## 2. One-time setup (Mom does this once)

1. Pick a QA email you control that is **not** your real login. A Gmail plus-alias
   works and needs no new mailbox — e.g. `yourname+catqa@gmail.com`.
2. Open the live app: <https://xiateas-source.github.io/School/cat-trainer-v2/>
3. Tap **I'm Mom**, enter the QA email and a fresh password, and submit.
   The first sign-in with an unknown email **creates the account**, and the app
   immediately seeds it a complete family of its own: a child profile, three
   cats, and the default quests.
4. Go to **Setup → Account** and copy the **Family ID** shown there. Save it with
   the QA credentials — agents assert against it (§6).
5. Confirm the isolation held: this dashboard should show 0 minutes, an empty
   ledger, and none of Sirus's real progress. If you see real data, you signed in
   with the real account — sign out and redo step 3.

That's the whole setup. Nothing to deploy, nothing to configure, no console step.

> **Never run agents against the real family**, even read-only. An agent that
> approves a quest or spends a Care Charge in the real family has corrupted
> Sirus's actual rewards, and the ledger is designed never to be edited.

---

## 3. The two roles an agent can hold

| Role | How it signs in | What it can do |
| --- | --- | --- |
| **QA Parent** | QA email + password, via **I'm Mom** | Everything: approve/reject, quick points, redeem, quests, Today overrides, settings, pairing codes |
| **QA Child** | Anonymous, via **I'm Sirus** + a pairing code | Sirus's side: request quest completions, spend Care Charges, buy café items, read-only progress |

A QA co-parent (**I'm Abba** + an invite code) is also possible and behaves like a
second parent. It isn't needed for most acceptance tests — use it only when
testing co-parent attribution itself.

### One role at a time per browser profile

The signed-in Firebase session and the remembered role both live in the browser's
storage for the origin, so **one profile holds one role**. Two ways to work:

- **Sequential (simplest):** test as Parent, hit **Sign out**, come back as Child.
  Firestore is the source of truth, so state carries across the switch. This covers
  almost every acceptance flow.
  **Note the asymmetry:** `signout` exists only in the parent shell. The child
  shell has no sign-out or role-switch control by design — Sirus must not be able
  to unpair his own tablet. So Parent → Child is a click, but Child → Parent
  requires clearing the origin's browser storage (or a fresh browser context).
  Script the child leg last, or drive it in its own context.
- **Two browser contexts:** needed only to watch one role update *live* while the
  other acts — e.g. proving the child's screen reflects an approval without a
  refresh.

---

## 4. Pairing the QA child (read this before automating it)

Pairing codes are **single-use and expire 15 minutes after they're created**
(see `src/shared/pairing.js`). This is a security property, not a bug — but it
shapes how an agent must be scripted:

1. In a **Parent** session: **Setup → Pair Sirus's tablet → Create pairing code**.
   Read the 6 digits from `pair-code-value`.
2. Within 15 minutes, in the **Child** context: **I'm Sirus**, type the code,
   **Connect**.
3. That code is now burned. A later run needs a **fresh** one.

Consequences for agent scripting:

- **Mint the code inside the same run that uses it.** Never store a code in a
  config file or an agent prompt — it will be dead by the time it's read.
- If the child context keeps its browser storage between runs, it stays paired and
  no code is needed at all. Only a cleared profile has to re-pair.
- The failure message is identical for a wrong, expired, and already-used code
  (deliberately — it must not confirm which codes exist). If pairing fails, mint a
  new code rather than debugging which reason applied.
- Each fresh pairing creates a new anonymous member in the QA family. Harmless,
  but they accumulate — worth watching as a signal for whether we need a reset
  tool.

---

## 5. Where credentials live

**Never in this repository.** Not in a file, not in a comment, not in a commit
message, not in a fixture. The repo is public.

Store the QA email, the QA password, and the QA Family ID in the agent platform's
secret store (Browsey's credential vault, a CI secret, or a local password
manager entry that you paste in at run time). Refer to them as:

- `QA_PARENT_EMAIL`
- `QA_PARENT_PASSWORD`
- `QA_FAMILY_ID`

Treat the QA password as a real password, because it is one — it protects an
account that can write to a real Firebase project. If it leaks, change it from
the QA session and carry on; nothing about our family is exposed by it.

---

## 6. Browser-agent procedure

Give the agent the URL, the credentials by reference, and this sequence.

**Every run starts with the safety check:**

1. Open the app. If a shell is already open, **Sign out** first to reach the gate.
2. `role-parent` → fill `signin-email` / `signin-password` → `signin-submit`.
3. Navigate to Setup (`[data-pgo="settings"]`) and read `settings-family-id`.
4. **Assert it equals `QA_FAMILY_ID`. If it does not, stop the run and change
   nothing.** This is a seatbelt, not the lock — the lock is that this account has
   no membership in the real family — but it catches a mistyped credential before
   the agent starts clicking.

**Then drive the workflow.** A first end-to-end loop worth running:

1. As Parent, note `parent-available`.
2. Mint a pairing code (§4) and switch to the Child role.
3. As Child, pick a `quest-card` with `data-quest-status="todo"`, press its
   complete button (`[data-complete="<quest id>"]`), and confirm the card flips to
   `data-quest-status="pending"`.
4. Sign out, return as Parent, and confirm `approvals-count` incremented and an
   `approval-row` carries that `data-quest-id`.
5. Approve it (`[data-approve]`) and confirm `parent-available` rose by the
   quest's points.
6. Back as Child, confirm `child-available` matches and `child-care-charges`
   gained one.

### Selectors

Elements an agent drives carry a `data-testid`. Prefer them over text, emoji, or
CSS classes — copy changes, testids are a contract (`tools/test-testids.mjs`
fails if one disappears).

**Gate and sign-in**

| Hook | What it is |
| --- | --- |
| `gate` | The "who is using this device?" screen |
| `role-parent`, `role-coparent`, `role-child` | The three role buttons |
| `gate-note` | Gate-level message line |
| `signin-email`, `signin-password`, `signin-submit`, `signin-note` | Parent sign-in |
| `coparent-email`, `coparent-password`, `coparent-code`, `coparent-submit`, `coparent-note` | Co-parent sign-in |
| `pair-code`, `pair-submit`, `pair-note` | Child pairing |

**Parent**

| Hook | What it is |
| --- | --- |
| `parent-shell` | Present and not `hidden` ⇒ signed in as a parent |
| `parent-available` | Available minutes |
| `approvals-card`, `approvals-count`, `approvals-list` | The Needs-approval queue |
| `approval-row` | One pending completion; carries `data-quest-id` |
| `ptoday-row` | A quest row on the Today board; carries `data-quest-id`. Its actions are `[data-today-skip]`, `[data-today-move]` (Later), `[data-today-next]`, `[data-today-clear]` (Undo) |
| `exception-row` | A one-day exception in the Today-is-different card; carries `data-quest-id`. The **only** place a skip can be undone |
| `sirus-today-row` | The parent's mirror of the child's screen, on the **Today** screen beside `sirus-today-summary` — not on the Quests screen. Rendered only for quests currently turned on, so a paused or archived quest is legitimately absent. Carries `data-quest-id` |
| `parent-quest-row` | A row in the reusable Quest manager; carries `data-quest-id`, plus move, edit, duplicate, Pause/Resume, and Archive/Restore actions. Permanent `[data-del-quest]` is rendered only for isolated `QA-*` cleanup quests |
| `quest-selection` | One row's bulk-selection checkbox |
| `quest-bulk-toolbar`, `quest-bulk-edit` | Selection count and launcher for conservative reusable-routine bulk changes |
| `quest-bulk-dialog`, `quest-bulk-action`, `quest-bulk-apply` | Bulk Pause/Resume, Archive/Restore, daypart, recurrence, or Essential/Bonus controls. There is no bulk reorder |
| `quest-return-dialog`, `quest-return-note`, `quest-return-submit` | Gentle quick-return preset and optional-note flow |
| `make-pair-code`, `pair-code-display`, `pair-code-value` | Child pairing code |
| `make-coparent-code`, `coparent-code-display`, `coparent-code-value` | Co-parent invite code |
| `parent-cafe-row` | One owned café item in the parent's Café card; carries `data-item-id` and a `[data-return-item]` Return button that refunds the recorded purchase price and frees the item to be bought again |
| `settings-email`, `settings-family-id`, `signout` | Account card |

**Child**

| Hook | What it is |
| --- | --- |
| `child-shell` | Present and not `hidden` ⇒ signed in as the child |
| `child-available`, `child-coins`, `child-care-charges` | The three wallets |
| `child-next-quests`, `child-quest-list` | Home's short list, and the full Quests screen |
| `quest-card` | One quest; carries `data-quest-id` and `data-quest-status` (`todo` \| `pending` \| `approved`) |
| `returned-feedback` | Gentle returned-Quest card, including the preset guidance and optional parent note |
| `care-need-cue` | The prompt to care for a low need; `data-need` names which. **It is deliberately hidden unless a need is below 40 _and_ the café is in Play mode** — being merely the lowest of the three is not enough. It is an icon-only button, so there is no text to read even when shown. An empty cue beside a Thriving/Okay cat is correct behaviour, not a missing prompt |
| `care-hunger-value`, `care-rest-value`, `care-happiness-value` | Need readouts, `n/100` |
| `care-hunger-band`, `care-rest-band`, `care-happiness-band` | Their labels (Thriving / Okay / …) |

These existing attributes are also stable and already carry their own ids:
`[data-choose-role]`, `[data-pgo]` (parent nav), `[data-cgo]` (child nav),
`[data-complete]`, `[data-approve]`, `[data-reject]`, `[data-buy]`.

---

## 6a. The automated acceptance suite (GitHub Actions)

The checks a machine can own are automated in `tools/acceptance.mjs` and run from
GitHub Actions — **no computer of your own required**. Playwright drives a real
Chromium against the deployed app using the hooks above.

### One-time setup: add three secrets

On GitHub → the repo → **Settings → Secrets and variables → Actions → New
repository secret**. Add these three, exactly named:

| Secret | Value |
| --- | --- |
| `QA_PARENT_EMAIL` | the QA account's email |
| `QA_PARENT_PASSWORD` | its password |
| `QA_FAMILY_ID` | the Family ID from Settings → Account in the QA family |

GitHub stores these encrypted and masks them in logs. **They must never appear
in the repo, a workflow file, or a commit** — the workflow reads them from the
secret store at run time, and `tools/test-testids.mjs` fails the build if this
runbook ever grows a password.

### Running it

GitHub → **Actions** tab → **QA acceptance (browser)** → **Run workflow** →
**Run workflow**. It takes a few minutes. Green check = everything passed;
click into the run to see per-test PASS / SKIP lines. (The optional *App URL*
input is only for testing a different deployment; leave it blank.)

The workflow is **manual-trigger only** — it never runs on a push or a pull
request, so a stranger's fork PR can't reach the secrets.

### Reading the results

- **PASS** — the behaviour held.
- **SKIP** — the suite refused to guess. Each skip states its reason, e.g. *"no
  genuinely-later daypart exists at the current time of day"* or *"every quest on
  the QA child board is already done today"*. A skip is information, not a
  failure: it usually names the deferred reset/seeding/fake-clock work that would
  make that case deterministic.
- **FAIL** — a real disagreement between the app and the expected behaviour.
  Redacted screenshots are attached to the run under **Artifacts**.

### Safety properties

- The **first** thing the suite does after signing in is compare the signed-in
  Family ID to `QA_FAMILY_ID`. On any mismatch it aborts **before a single
  write**, and it never prints either value.
- Playwright traces and videos are **off** by design: a trace records the
  password typed into the form and the network bodies carrying it, and CI
  artifacts on a public repo are world-readable. The suite takes its own
  screenshots with the email, password, and Family ID blanked out of the DOM.
- One run at a time (`concurrency`), because every test drives the same family.

### Rerunnability

There is no reset yet, so the suite never assumes a clean account: it creates its
own uniquely-named quests (`QA-<runid>-*`), asserts before/after **deltas**
rather than absolute totals, and deletes what it created. If a run dies
mid-flight it may leave a `QA-*` quest behind — safe to delete by hand from
Quests → Routines.

Reduced Slice 3 adds tests 13–15 for the single-row management lifecycle,
the exact conservative bulk-action allowlist, and return → retry Care/points
accounting. Each checks for `quest-bulk-toolbar` **before its first mutation**;
when a branch workflow targets the older deployed app, those tests report an
honest feature-not-deployed SKIP and create no QA records.

## 7. What agents should and shouldn't test

**Good for agents:** Parent/Child plan agreement, Skip/Undo, Later/Next,
recurrence, Needs-You and batch approval, completion and retry, Care Charge
accounting, routine duplicate/Pause/Archive/Restore, one-row reorder,
conservative bulk edits, quick-return data/copy, Feed/Rest/Play outcomes, café
purchases and coin math, ledger correctness, and the denial paths (a child must
never be able to raise their own coins or minutes).

**Keep on a real device, with a human:** PWA install and service-worker updates,
offline behaviour and reconnect, café décor dragging, art and animation,
tablet layout and touch targets, cross-device realtime latency, and anything that
turns on the time of day or the midnight rollover — agents run at whatever
wall-clock time they happen to run at, and nothing can currently fake it.

---

## 8. Known rough edges (the things this stage is meant to measure)

Not yet solved, on purpose. Note which ones actually hurt during real runs:

- **No reset.** QA state accumulates run over run. Ledger rows are permanent by
  design, so an old QA family drifts from any clean baseline.
  _Partly addressed:_ a parent can now **Return** an owned café item from the
  parent Café card (`parent-cafe-row` → `[data-return-item]`), which refunds the
  exact price paid and puts the item back in the shop. That unblocks the café
  purchase and insufficient-coins tests on a family that already owns the whole
  catalog — buy, assert, return, and the books balance. It is parent-only and
  server-enforced (the rules already allowed a parent to delete an owned item
  and write the child's coins), so it needed no rules change and gives the child
  no new power. Nothing else resets.
- **No seeded scenarios.** Setting up "three pending approvals" or "a hungry cat"
  means clicking through it every time.
- **No time control.** Anything phrased "overdue this morning" can only be tested
  when it is genuinely that time of day in `America/Chicago`.
- **Anonymous members accumulate** in the QA family with each re-pair — the
  acceptance suite pairs a fresh child on every run, so this grows fastest.
- The QA family is seeded with the same names as ours (Mom, Sirus) — only the
  Family ID distinguishes it on screen.

If a reset lands later, it must be constrained **server-side** to the
authenticated parent's own family. Hiding a button is not a boundary.
