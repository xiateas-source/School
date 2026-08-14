# QA testing with browser agents

How a Claude/GPT browser agent signs into Cat Trainer and exercises real
workflows — **without ever touching our family's data**.

This is the Slice 0–1 runbook: an isolated QA family, and the stable hooks an
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
| `make-pair-code`, `pair-code-display`, `pair-code-value` | Child pairing code |
| `make-coparent-code`, `coparent-code-display`, `coparent-code-value` | Co-parent invite code |
| `settings-email`, `settings-family-id`, `signout` | Account card |

**Child**

| Hook | What it is |
| --- | --- |
| `child-shell` | Present and not `hidden` ⇒ signed in as the child |
| `child-available`, `child-coins`, `child-care-charges` | The three wallets |
| `child-next-quests`, `child-quest-list` | Home's short list, and the full Quests screen |
| `quest-card` | One quest; carries `data-quest-id` and `data-quest-status` (`todo` \| `pending` \| `approved`) |
| `care-need-cue` | The prompt to care for a low need; `data-need` names which |
| `care-hunger-value`, `care-rest-value`, `care-happiness-value` | Need readouts, `n/100` |
| `care-hunger-band`, `care-rest-band`, `care-happiness-band` | Their labels (Thriving / Okay / …) |

These existing attributes are also stable and already carry their own ids:
`[data-choose-role]`, `[data-pgo]` (parent nav), `[data-cgo]` (child nav),
`[data-complete]`, `[data-approve]`, `[data-reject]`, `[data-buy]`.

---

## 7. What agents should and shouldn't test

**Good for agents:** Parent/Child plan agreement, Skip/Undo, Later/Next,
recurrence, Needs-You and batch approval, completion and retry, Care Charge
accounting, Feed/Rest/Play outcomes, café purchases and coin math, ledger
correctness, and the denial paths (a child must never be able to raise their own
coins or minutes).

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
- **No seeded scenarios.** Setting up "three pending approvals" or "a hungry cat"
  means clicking through it every time.
- **No time control.** Anything phrased "overdue this morning" can only be tested
  when it is genuinely that time of day in `America/Chicago`.
- **Anonymous members accumulate** in the QA family with each re-pair.
- The QA family is seeded with the same names as ours (Mom, Sirus) — only the
  Family ID distinguishes it on screen.

If a reset lands later, it must be constrained **server-side** to the
authenticated parent's own family. Hiding a button is not a boundary.
