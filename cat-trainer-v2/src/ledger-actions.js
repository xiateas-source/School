// My Progress Slice 3 UI/actions layer.
//
// It deliberately sits beside app.js instead of adding more correction/admin
// responsibilities to the Café controller. Realtime app subscriptions still own
// rendering; this module adds parent ledger actions and lets those subscriptions
// reflect the resulting Firestore changes.

import { deviceFamilyId, deviceUid, deviceRole } from './auth.js?v=40d3a587';
import * as store from './store.js?v=40d3a587';
import { QUICK_ACTIONS } from './shared/rewards.js?v=40d3a587';
import { localDate } from './shared/dates.js?v=40d3a587';
import { reversibleRewardEffects } from './shared/corrections.js?v=40d3a587';
import {
  correctTransaction, permanentDeleteTransaction, getLatestCorrectableTransaction,
  getTransaction, awardHeroReset
} from './ledger-actions-store.js?v=40d3a587';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function parentContext() {
  if (deviceRole() !== 'parent') return null;
  const familyId = deviceFamilyId();
  const uid = deviceUid();
  return familyId && uid ? { familyId, uid } : null;
}

function notify(message) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(notify._timer);
  notify._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function stop(e) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

function selectedLedgerDate() {
  const cal = $('#p-ledger-view .day-calendar');
  return cal && cal.value ? cal.value : localDate();
}

function friendlyActionError(err, action) {
  const code = err && err.message;
  if (code === 'already-corrected') return 'That entry is already corrected.';
  if (code === 'cannot-correct-correction' || code === 'correction-history') return 'Correction history stays intact.';
  if (code === 'legacy-cat-effects-unknown') return 'That older entry cannot be permanently deleted safely. Use Correct entry instead.';
  if (code === 'effects-no-longer-fully-reversible') return 'Some of that entry has already been used or changed. Use Correct entry so the history stays accurate.';
  if (code === 'entry-missing') return 'That entry is no longer there.';
  return action === 'delete' ? 'Could not delete that entry.' : 'Could not correct that entry.';
}

function correctionImpact(txn) {
  const lines = [];
  const amount = Number(txn && txn.amount || 0);
  if (amount > 0) lines.push(`Available minutes: remove up to ${amount}.`);
  else if (amount < 0) lines.push(`Available minutes: restore ${Math.abs(amount)}.`);

  const effects = reversibleRewardEffects(txn || {});
  for (const [key, label] of [['coins', 'Coins'], ['brain', 'Brain'], ['energy', 'Energy'], ['bond', 'Bond']]) {
    const value = Number(effects[key] || 0);
    if (value) lines.push(`${label}: reverse ${Math.abs(value)}.`);
  }
  if (effects.ambiguousCat) lines.push('Older cat progress cannot be proven, so that cat progress will be preserved.');
  if (txn && txn.kind === 'quest') {
    lines.push('The quest becomes available again. Care Charges, completed care, Hero-care days, needs, and evolution stay unchanged.');
  }
  return lines.length ? `\n\n${lines.join('\n')}` : '';
}

async function doCorrect(txnId) {
  const ctx = parentContext();
  if (!ctx || !txnId) return;
  let txn;
  try { txn = await getTransaction(ctx.familyId, txnId); }
  catch (_) { return notify('Could not load that entry.'); }
  if (!txn) return notify('That entry is no longer there.');

  const label = txn.reasonLabel || 'this entry';
  const ok = confirm(
    `Correct “${label}”?\n\nThe original stays visible and one linked correction records the safe reversal.${correctionImpact(txn)}`
  );
  if (!ok) return;
  try {
    const result = await correctTransaction(ctx.familyId, ctx.uid, txnId);
    notify(result && result.preservedLegacyCat
      ? 'Corrected. Older cat progress was preserved because it could not be proven safely.'
      : 'Entry corrected.');
  } catch (err) {
    notify(friendlyActionError(err, 'correct'));
  }
}

async function doPermanentDelete(txnId) {
  const ctx = parentContext();
  if (!ctx || !txnId) return;
  let txn = null;
  try { txn = await getTransaction(ctx.familyId, txnId); } catch (_) {}
  const label = (txn && txn.reasonLabel) || 'this entry';
  const ok = confirm(
    `Permanently delete “${label}”?\n\nOnly use this for test, duplicate, or junk data. The row and its linked recognition will be removed. If every effect cannot be safely reversed, deletion will be blocked. This cannot be undone.`
  );
  if (!ok) return;
  try {
    await permanentDeleteTransaction(ctx.familyId, ctx.uid, txnId);
    notify('Test/junk entry permanently deleted.');
  } catch (err) {
    notify(friendlyActionError(err, 'delete'));
  }
}

function installStyles() {
  if ($('#slice3-ledger-style')) return;
  const style = document.createElement('style');
  style.id = 'slice3-ledger-style';
  style.textContent = `
    .s3-ledger-actions{display:flex;gap:.55rem;align-items:center;flex-wrap:wrap;margin:.7rem 0 0;padding-top:.65rem;border-top:1px solid rgba(82,66,50,.12)}
    .s3-ledger-actions button{min-height:40px}
    .s3-correct-btn{border:1px solid rgba(92,75,55,.22);background:#fffaf2;border-radius:999px;padding:.55rem .8rem;font-weight:700}
    .s3-cleanup{margin-left:auto;color:var(--muted,#776f67);font-size:.82rem}
    .s3-cleanup summary{cursor:pointer;user-select:none;padding:.4rem .25rem}
    .s3-delete-btn{display:block;margin-top:.35rem;border:0;background:transparent;text-decoration:underline;color:#786e66;padding:.35rem}
    .s3-add-day{width:100%;margin:.7rem 0 .15rem;min-height:44px;border:1px dashed rgba(92,75,55,.3);background:#fffaf2;border-radius:14px;font-weight:700}
    .s3-backdate-note{margin:.25rem 0 .8rem;color:var(--muted,#776f67)}
    .s3-custom-fields[hidden]{display:none!important}
    .s3-link-note{margin:.45rem 0 0;font-size:.84rem;color:var(--muted,#776f67)}
  `;
  document.head.appendChild(style);
}

function makeBackdateDialog() {
  if ($('#s3-add-entry-dialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 's3-add-entry-dialog';
  dialog.className = 'modal';
  dialog.innerHTML = `<form class="modal-card stack-form" id="s3-add-entry-form">
    <h2>Add entry to this day</h2>
    <p class="s3-backdate-note">Activity date: <strong id="s3-entry-date"></strong>. The balance changes when you save it now.</p>
    <label>What happened?
      <select id="s3-entry-kind"></select>
    </label>
    <div class="s3-custom-fields" id="s3-custom-fields" hidden>
      <label>Amount<input id="s3-entry-amount" type="number" inputmode="numeric" value="1"></label>
      <label>Reason<input id="s3-entry-reason" maxlength="80" placeholder="What happened?"></label>
    </div>
    <label>Note<input id="s3-entry-note" maxlength="80" placeholder="Optional detail"></label>
    <div class="btn-row">
      <button class="text-button" type="button" data-s3-cancel-entry>Cancel</button>
      <button class="primary-button" type="submit">Add entry</button>
    </div>
  </form>`;
  document.body.appendChild(dialog);

  const select = $('#s3-entry-kind', dialog);
  select.innerHTML = QUICK_ACTIONS.map(a =>
    `<option value="${a.code}">${a.amount > 0 ? '+' : ''}${a.amount} · ${a.label}</option>`
  ).join('') + '<option value="custom">Custom amount / reason</option>';

  select.addEventListener('change', () => {
    $('#s3-custom-fields', dialog).hidden = select.value !== 'custom';
  });
  $('[data-s3-cancel-entry]', dialog).addEventListener('click', () => dialog.close());
  $('#s3-add-entry-form', dialog).addEventListener('submit', saveBackdatedEntry);
}

function openBackdateDialog() {
  const day = selectedLedgerDate();
  if (day === localDate()) return;
  makeBackdateDialog();
  const dialog = $('#s3-add-entry-dialog');
  dialog.dataset.activityDate = day;
  $('#s3-entry-date', dialog).textContent = day;
  $('#s3-entry-kind', dialog).value = 'good_choice';
  $('#s3-custom-fields', dialog).hidden = true;
  $('#s3-entry-amount', dialog).value = '1';
  $('#s3-entry-reason', dialog).value = '';
  $('#s3-entry-note', dialog).value = '';
  dialog.showModal();
}

async function saveBackdatedEntry(e) {
  e.preventDefault();
  const ctx = parentContext();
  const dialog = $('#s3-add-entry-dialog');
  if (!ctx || !dialog) return;
  const day = dialog.dataset.activityDate;
  const code = $('#s3-entry-kind', dialog).value;
  const note = $('#s3-entry-note', dialog).value.trim();

  try {
    if (code === 'custom') {
      const amount = Number($('#s3-entry-amount', dialog).value) || 0;
      const reasonLabel = $('#s3-entry-reason', dialog).value.trim() || 'Custom adjustment';
      if (!amount) return notify('Enter a non-zero amount.');
      await store.adjustPoints(ctx.familyId, ctx.uid, { amount, reasonLabel, note, activityDate: day });
    } else if (code === 'hero_reset') {
      await awardHeroReset(ctx.familyId, ctx.uid, { note, activityDate: day });
    } else {
      await store.adjustPoints(ctx.familyId, ctx.uid, { reasonCode: code, note, activityDate: day });
    }
    dialog.close();
    notify(`Added to ${day}.`);
  } catch (_) {
    notify('Could not add that entry.');
  }
}

function enhanceDashboardDeletes() {
  for (const btn of $$('.del-txn[data-del-txn]')) {
    const id = btn.dataset.delTxn;
    const item = btn.closest('.ledger-item');
    const isCorrection = !!(item && $('.ledger-delta.correction', item));
    if (isCorrection) { btn.remove(); continue; }
    btn.classList.remove('del-txn');
    btn.removeAttribute('data-del-txn');
    btn.dataset.s3Correct = id;
    btn.textContent = '↶';
    btn.setAttribute('aria-label', 'Correct this entry');
    btn.title = 'Correct entry';
  }
  const undo = $('#undo-btn');
  if (undo && !undo.dataset.s3Ready) {
    undo.dataset.s3Ready = '1';
    undo.textContent = '↶ Correct last';
    undo.title = 'Creates a linked correction; history stays visible';
  }
}

function enhanceParentLedger() {
  const mount = $('#p-ledger-view');
  if (!mount) return;
  const day = selectedLedgerDate();
  const nav = $('.day-nav', mount);
  if (nav && day !== localDate() && !$('.s3-add-day', mount)) {
    const add = document.createElement('button');
    add.className = 's3-add-day';
    add.dataset.s3AddDay = '1';
    add.textContent = '+ Add entry to this day';
    nav.insertAdjacentElement('afterend', add);
  }

  for (const row of $$('.prog-row.open[data-txn-toggle]', mount)) {
    if ($('.s3-ledger-actions', row)) continue;
    const id = row.dataset.txnToggle;
    const corrected = row.classList.contains('is-corrected');
    const correction = !!$('.prog-chip.correction', row);
    if (correction) continue;

    const actions = document.createElement('div');
    actions.className = 's3-ledger-actions';
    if (!corrected) {
      actions.innerHTML = `<button type="button" class="s3-correct-btn" data-s3-correct="${id}">↶ Correct entry</button>
        <details class="s3-cleanup"><summary>Cleanup</summary><button type="button" class="s3-delete-btn" data-s3-delete="${id}">Delete permanently…</button></details>`;
    } else {
      actions.innerHTML = '<span class="s3-link-note">This entry has already been corrected; the original stays in history.</span>';
    }
    row.appendChild(actions);
    const cleanup = $('.s3-cleanup', actions);
    if (cleanup) {
      cleanup.addEventListener('click', event => {
        // The parent ledger row itself is clickable. Keep Cleanup clicks
        // inside the native <details> so the row handler cannot re-render
        // it closed before Mom can reach Delete permanently.
        event.stopPropagation();
      });
    }
  }
}

async function enhanceLinkedRow(row) {
  if (!row || row.dataset.s3LinkChecked) return;
  row.dataset.s3LinkChecked = '1';
  const isReset = !!$('.row-badge.reset', row);
  const isCorrection = !!$('.prog-chip.correction', row);
  if (!isReset && !isCorrection) return;
  const ctx = parentContext() || (deviceFamilyId() ? { familyId: deviceFamilyId() } : null);
  if (!ctx) return;

  try {
    const txn = await getTransaction(ctx.familyId, row.dataset.txnToggle);
    if (!txn) return;
    if (isReset && txn.relatedTransactionId && !$('.s3-link-note', row)) {
      const note = document.createElement('p');
      note.className = 's3-link-note';
      note.textContent = '↳ Recovery linked to the earlier Room to Grow moment.';
      row.appendChild(note);
    }
    if (isCorrection && txn.reversesTransactionId && !$('.s3-correction-link', row)) {
      const original = await getTransaction(ctx.familyId, txn.reversesTransactionId);
      const note = document.createElement('p');
      note.className = 's3-link-note s3-correction-link';
      note.textContent = `↶ Corrects: ${(original && original.reasonLabel) || 'earlier entry'}.`;
      row.appendChild(note);
    }
  } catch (_) {}
}

function enhanceLinkedRows() {
  for (const row of $$('.prog-row.open[data-txn-toggle]')) enhanceLinkedRow(row);
}

let enhanceQueued = false;
function enhance() {
  if (enhanceQueued) return;
  enhanceQueued = true;
  requestAnimationFrame(() => {
    enhanceQueued = false;
    installStyles();
    enhanceDashboardDeletes();
    enhanceParentLedger();
    enhanceLinkedRows();
  });
}

// Capture phase intentionally runs before app.js's legacy hard-delete/Undo/Reset
// handlers. Once Slice 3 owns an action, the old handler never sees that click.
document.addEventListener('click', async e => {
  const correct = e.target.closest('[data-s3-correct]');
  if (correct) { stop(e); await doCorrect(correct.dataset.s3Correct); return; }

  // Also intercept the PRE-enhancement legacy trash selector. That closes the
  // tiny timing window between an app.js re-render and MutationObserver relabeling
  // the button, so ordinary UI can never reach store.deleteTransaction().
  const legacyDelete = e.target.closest('[data-del-txn]');
  if (legacyDelete && parentContext()) {
    stop(e);
    await doCorrect(legacyDelete.dataset.delTxn);
    return;
  }

  const del = e.target.closest('[data-s3-delete]');
  if (del) { stop(e); await doPermanentDelete(del.dataset.s3Delete); return; }

  if (e.target.closest('[data-s3-add-day]')) { stop(e); openBackdateDialog(); return; }

  const undo = e.target.closest('#undo-btn');
  if (undo && parentContext()) {
    stop(e);
    const ctx = parentContext();
    try {
      const latest = await getLatestCorrectableTransaction(ctx.familyId);
      if (!latest) return notify('Nothing to correct.');
      await doCorrect(latest.id);
    } catch (_) { notify('Could not find the last entry.'); }
    return;
  }

  // Hero's Reset needs relatedTransactionId stamped at creation, so Slice 3 owns
  // this one quick action. All other dashboard quick actions stay in app.js.
  const reset = e.target.closest('[data-quick="hero_reset"]');
  if (reset && parentContext()) {
    stop(e);
    const ctx = parentContext();
    const noteInput = $('#point-note');
    const note = noteInput ? noteInput.value.trim() : '';
    try {
      await awardHeroReset(ctx.familyId, ctx.uid, { note, activityDate: localDate() });
      if (noteInput) noteInput.value = '';
      notify('+1 · Hero’s Reset');
    } catch (_) { notify('Could not save — check connection.'); }
    return;
  }
}, true);

// Only ledger/progress mounts are observed. Café movement/FX mutations should
// never wake the Slice 3 enhancer on Sirus's tablet.
const observer = new MutationObserver(enhance);
for (const target of ['#dash-ledger', '#p-ledger-view', '#c-progress-view']) {
  const node = $(target);
  if (node) observer.observe(node, { childList: true, subtree: true });
}
enhance();
