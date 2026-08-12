// Quest Slice 2b/2c — parent Today portal + today-only schedule overrides.
//
// This module deliberately owns only parent Quest operations and the persisted
// per-day override stream. Core quest economics stay in store.js; daily planning
// stays in shared/routines.js. The app passes its live state in, so Today and the
// child view consume the same quest/completion truth without a parallel model.

import { initFirebase, db, dbSdk } from './firebase.js?v=ea220299';
import * as store from './store.js?v=ea220299';
import { localDate } from './shared/dates.js?v=ea220299';
import {
  planDay, organizeDay, phaseNow, progressCounts, minutesAvailable,
  questTimeWindow, questIsDailyEssential, isScheduledOn,
  WINDOW_LABEL, WINDOW_GLYPH
} from './shared/routines.js?v=ea220299';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
}[c]));

const PHASE_ORDER = ['morning', 'school', 'evening', 'night'];

function completionStatus(state, questId) {
  const c = (state.todayCompletions || []).find(x => x.questId === questId);
  return c ? c.status : null;
}

function completionTitle(state, completion) {
  const q = (state.quests || []).find(x => x.id === completion.questId);
  return (q && q.title) || completion.questTitle || 'Quest';
}

function overrideDocId(questId, date) {
  return `${questId}_${date}`;
}

async function fs() {
  await initFirebase();
  return { database: db(), sdk: dbSdk() };
}

function overrideCollection(sdk, database, fid) {
  return sdk.collection(database, 'families', fid, 'questDayOverrides');
}

function overrideDoc(sdk, database, fid, questId, date) {
  return sdk.doc(database, 'families', fid, 'questDayOverrides', overrideDocId(questId, date));
}

async function subscribeOverrides(fid, date, cb, onError) {
  const { database, sdk } = await fs();
  const { query, where, onSnapshot } = sdk;
  const ref = overrideCollection(sdk, database, fid);
  return onSnapshot(query(ref, where('date', '==', date)), snap => {
    const map = {};
    snap.forEach(d => {
      const v = d.data();
      if (v && v.questId) map[v.questId] = { id: d.id, ...v };
    });
    cb(map);
  }, err => {
    if (onError) onError(err);
  });
}

async function setOverride(fid, uid, questId, date, action, extra = {}) {
  const { database, sdk } = await fs();
  const { setDoc, serverTimestamp } = sdk;
  const ref = overrideDoc(sdk, database, fid, questId, date);
  await setDoc(ref, {
    questId, date, action,
    ...(extra.window ? { window: extra.window } : {}),
    at: serverTimestamp(), by: uid
  });
}

async function clearOverride(fid, questId, date) {
  const { database, sdk } = await fs();
  const { deleteDoc } = sdk;
  await deleteDoc(overrideDoc(sdk, database, fid, questId, date));
}

async function replaceOverrides(fid, uid, quests, date, current, targetIds) {
  const { database, sdk } = await fs();
  const { writeBatch, serverTimestamp } = sdk;
  const batch = writeBatch(database);
  const allIds = new Set([
    ...Object.keys(current || {}),
    ...(quests || []).map(q => q.id)
  ]);
  for (const id of allIds) batch.delete(overrideDoc(sdk, database, fid, id, date));
  for (const id of targetIds) {
    batch.set(overrideDoc(sdk, database, fid, id, date), {
      questId: id, date, action: 'skip', at: serverTimestamp(), by: uid
    });
  }
  await batch.commit();
}

export function laterWindowFor(quest, currentPhase = phaseNow()) {
  const qWindow = questTimeWindow(quest);
  const qIdx = PHASE_ORDER.indexOf(qWindow);
  const nowIdx = PHASE_ORDER.indexOf(currentPhase);
  const from = Math.max(qIdx, nowIdx);
  if (from >= 0 && from < PHASE_ORDER.length - 1) return PHASE_ORDER[from + 1];
  // There is no later timed phase after Night. Flexible timing is the least
  // surprising fallback and still keeps the quest on today's plan.
  return 'anytime';
}

export function presetTargetIds(quests, preset, date) {
  const scheduled = (quests || []).filter(q => q.enabled !== false && isScheduledOn(q, date));
  if (preset === 'sick' || preset === 'out') return scheduled.map(q => q.id);
  if (preset === 'school_off') {
    return scheduled.filter(q => questTimeWindow(q) === 'school').map(q => q.id);
  }
  if (preset === 'easy_morning') {
    return scheduled.filter(q => questTimeWindow(q) === 'morning' && !questIsDailyEssential(q)).map(q => q.id);
  }
  return [];
}

function injectStyles() {
  if (document.getElementById('quest-slice2-styles')) return;
  const style = document.createElement('style');
  style.id = 'quest-slice2-styles';
  style.textContent = `
    .quest-subtabs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:0 0 14px}
    .quest-subtabs button{border:1px solid #ddd1c2;background:#fff;border-radius:999px;padding:10px 6px;font-weight:800;color:#66564a}
    .quest-subtabs button.active{background:#4f9b7c;color:#fff;border-color:#4f9b7c}
    .qpanel[hidden]{display:none!important}
    .today-stack{display:grid;gap:12px}
    .needs-you{border:2px solid #efb267}
    .needs-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
    .needs-badge{background:#f5a14a;color:#fff;border-radius:999px;padding:2px 8px;font-size:.78rem;font-weight:900}
    .batch-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 4px}
    .batch-row button{min-height:40px}
    .needs-item{display:grid;grid-template-columns:auto 1fr auto auto;gap:8px;align-items:center;padding:10px 0;border-top:1px solid #eee2d5}
    .needs-item:first-of-type{border-top:0}
    .needs-item input{width:20px;height:20px}
    .today-summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}
    .today-stat{background:#fffaf2;border:1px solid #eadfce;border-radius:12px;padding:10px}
    .today-stat strong{display:block;font-size:1.2rem}.today-stat span{font-size:.78rem;color:#75675c}
    .today-phase-line{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid #eee2d5}
    .today-plan-row{padding:10px 0;border-top:1px solid #eee2d5}
    .today-plan-row:first-child{border-top:0}
    .today-plan-main{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
    .today-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
    .today-actions button{border:1px solid #d9ccbd;background:#fff;border-radius:999px;padding:7px 10px;font-weight:750;font-size:.78rem}
    .today-actions button.danger-lite{color:#9a5b30}
    .today-actions button.active{background:#eef7f2;border-color:#77ac95;color:#34745d}
    .preset-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:8px}
    .preset-grid button{min-height:42px;border:1px solid #d9ccbd;background:#fff;border-radius:12px;font-weight:800}
    .quest-log-row{padding:10px 0;border-top:1px solid #eee2d5;display:flex;justify-content:space-between;gap:10px}
    .quest-log-row:first-child{border-top:0}
    .portal-muted{font-size:.82rem;color:#77695e}
    @media(max-width:430px){.needs-item{grid-template-columns:auto 1fr}.needs-item .pill-btn{grid-row:2}.today-summary-grid{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(style);
}

function ensurePortalShell(state) {
  const screen = document.querySelector('[data-pscreen="quests"]');
  if (!screen || screen.querySelector('.quest-subtabs')) return;
  injectStyles();

  const title = screen.querySelector('.page-title');
  const movable = [...screen.children].filter(node => node !== title);
  const tabs = document.createElement('div');
  tabs.className = 'quest-subtabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Quest management');
  tabs.innerHTML = `
    <button type="button" data-qtab="today" role="tab">Today</button>
    <button type="button" data-qtab="routines" role="tab">Routines</button>
    <button type="button" data-qtab="log" role="tab">Log</button>`;

  const today = document.createElement('div');
  today.className = 'qpanel'; today.dataset.qpanel = 'today'; today.id = 'p-today';
  const routines = document.createElement('div');
  routines.className = 'qpanel'; routines.dataset.qpanel = 'routines';
  const log = document.createElement('div');
  log.className = 'qpanel'; log.dataset.qpanel = 'log'; log.id = 'p-quest-log';
  movable.forEach(node => routines.appendChild(node));
  screen.append(tabs, today, routines, log);
  navTab(state, state.questTab || 'today');
}

function navTab(state, name) {
  if (!['today', 'routines', 'log'].includes(name)) name = 'today';
  state.questTab = name;
  document.querySelectorAll('[data-qtab]').forEach(btn => {
    const on = btn.dataset.qtab === name;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('[data-qpanel]').forEach(panel => {
    panel.hidden = panel.dataset.qpanel !== name;
  });
}

function rewardText(state, c) {
  const q = (state.quests || []).find(x => x.id === c.questId);
  const r = c.rewards || {};
  const pts = q ? Number(q.points || 0) : Number(r.points || 0);
  return `+${pts} min`;
}

function renderNeedsYou(state) {
  const items = state.pendingApprovals || [];
  if (!items.length) return `<section class="card needs-you"><div class="needs-head"><h3>Needs You</h3></div><p class="muted">Nothing needs your attention right now.</p></section>`;
  const valid = new Set(items.map(x => x.id));
  for (const id of [...state.approveSel]) if (!valid.has(id)) state.approveSel.delete(id);
  const allSelected = items.length > 0 && items.every(x => state.approveSel.has(x.id));
  const rows = items.map(c => {
    const title = completionTitle(state, c);
    return `<div class="needs-item">
      <input type="checkbox" data-approve-sel="${esc(c.id)}" ${state.approveSel.has(c.id) ? 'checked' : ''} aria-label="Select ${esc(title)}">
      <div><strong>${esc(title)}</strong><br><small>${esc(rewardText(state, c))} · waiting for review</small></div>
      <button class="pill-btn reject" data-reject="${esc(c.id)}" aria-label="Return ${esc(title)}">✕</button>
      <button class="pill-btn approve" data-approve="${esc(c.id)}" aria-label="Approve ${esc(title)}">✓ Approve</button>
    </div>`;
  }).join('');
  return `<section class="card needs-you">
    <div class="needs-head"><h3>Needs You</h3><span class="needs-badge">${items.length}</span></div>
    <p class="muted">Only things that need a parent action belong here.</p>
    <div class="batch-row">
      <button type="button" class="text-button" data-approve-selall>${allSelected ? 'Clear selection' : 'Select all'}</button>
      <button type="button" class="primary-button" data-approve-selected ${state.approveSel.size ? '' : 'disabled'}>Approve selected (${state.approveSel.size})</button>
    </div>${rows}</section>`;
}

function renderRoutineSummary(state, planned, day, doneIds) {
  const now = day.now;
  const nowCounts = now ? progressCounts(now.quests, doneIds) : { total: 0, complete: 0, left: 0 };
  const nowMinutes = now ? minutesAvailable(now.quests, doneIds) : 0;
  const allMinutes = minutesAvailable(planned, doneIds);
  const upcoming = [day.next, ...(day.later || [])].filter(Boolean);
  const still = (day.stillNeedsDoing || []).reduce((n, g) => n + g.quests.filter(q => !doneIds.has(q.id)).length, 0);
  const nowLabel = now ? `${WINDOW_GLYPH[now.window]} ${WINDOW_LABEL[now.window]}` : 'No timed routine right now';
  return `<section class="card">
    <div class="card-head"><h3>Today at a glance</h3></div>
    <p><strong>${esc(nowLabel)}</strong>${now ? ` · ${nowCounts.left} left` : ''}</p>
    <div class="today-summary-grid">
      <div class="today-stat"><strong>${nowMinutes}</strong><span>minutes in current routine</span></div>
      <div class="today-stat"><strong>${allMinutes}</strong><span>minutes still available today</span></div>
      <div class="today-stat"><strong>${still}</strong><span>earlier tasks still need doing</span></div>
      <div class="today-stat"><strong>${(state.pendingApprovals || []).length}</strong><span>waiting for you</span></div>
    </div>
    ${upcoming.length ? `<div style="margin-top:10px"><strong>Coming later</strong>${upcoming.map(g => `<div class="today-phase-line"><span>${WINDOW_GLYPH[g.window]} ${esc(WINDOW_LABEL[g.window])}</span><small>${g.quests.length} quest${g.quests.length === 1 ? '' : 's'}</small></div>`).join('')}</div>` : ''}
  </section>`;
}

function questOverrideLabel(ov) {
  if (!ov) return '';
  if (ov.action === 'skip') return 'Skipped today';
  if (ov.action === 'move') return `Moved to ${WINDOW_LABEL[ov.window] || ov.window || 'later'}`;
  if (ov.action === 'next') return 'Made next';
  return 'Changed today';
}

function renderTodayPlan(state, planned) {
  const plannedIds = new Set(planned.map(q => q.id));
  const scheduled = (state.quests || []).filter(q => q.enabled !== false && isScheduledOn(q, localDate()));
  const rows = scheduled.map(q => {
    const ov = state.dayOverrides[q.id];
    const status = completionStatus(state, q.id);
    const hidden = !plannedIds.has(q.id);
    const effective = planned.find(x => x.id === q.id) || q;
    const window = questTimeWindow(effective);
    const badge = status === 'approved' ? '✓ Done' : status === 'pending' ? '⏳ Waiting' : hidden ? 'Skipped' : WINDOW_LABEL[window];
    const changed = questOverrideLabel(ov);
    const disabled = status ? 'disabled' : '';
    return `<div class="today-plan-row">
      <div class="today-plan-main"><div><strong>${esc(q.title)}</strong><br><small>${esc(badge)}${changed ? ` · ${esc(changed)}` : ''}${questIsDailyEssential(q) ? ' · Daily Essential' : ''}</small></div></div>
      <div class="today-actions">
        <button type="button" class="danger-lite" data-today-skip="${esc(q.id)}" ${disabled}>Skip today</button>
        <button type="button" data-today-move="${esc(q.id)}" ${disabled}>Move later</button>
        <button type="button" data-today-next="${esc(q.id)}" ${disabled}>Make next</button>
        ${ov ? `<button type="button" class="active" data-today-clear="${esc(q.id)}">Clear today change</button>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<section class="card"><div class="card-head"><h3>Today's plan</h3></div>
    <p class="muted">These buttons change today only. Your normal routine stays intact.</p>
    ${rows || '<div class="empty">No quests are scheduled today.</div>'}</section>`;
}

function renderPresets() {
  return `<section class="card"><details><summary><strong>Today Is Different</strong> <span class="portal-muted">one-day exceptions</span></summary>
    <p class="muted">Tomorrow automatically returns to the normal routine.</p>
    <div class="preset-grid">
      <button type="button" data-today-preset="sick">🤒 Sick day</button>
      <button type="button" data-today-preset="school_off">🏠 School off</button>
      <button type="button" data-today-preset="out">🚗 Out all day</button>
      <button type="button" data-today-preset="easy_morning">☀ Easy morning</button>
      <button type="button" data-today-preset="custom">✎ Custom</button>
      <button type="button" data-today-preset="normal">↶ Normal today</button>
    </div></details></section>`;
}

function renderToday(state) {
  const mount = document.getElementById('p-today');
  if (!mount) return;
  const enabled = (state.quests || []).filter(q => q.enabled !== false);
  const planned = planDay(enabled, { ymd: localDate(), overrides: state.dayOverrides || {} });
  const doneIds = new Set(enabled.filter(q => completionStatus(state, q.id)).map(q => q.id));
  const day = organizeDay(planned, { phase: phaseNow(), completedIds: doneIds });
  mount.innerHTML = `<div class="today-stack">${renderNeedsYou(state)}${renderRoutineSummary(state, planned, day, doneIds)}${renderPresets()}${renderTodayPlan(state, planned)}</div>`;
}

function renderLog(state) {
  const mount = document.getElementById('p-quest-log');
  if (!mount) return;
  const completions = state.todayCompletions || [];
  const completionRows = completions.map(c => {
    const title = completionTitle(state, c);
    const label = c.status === 'pending' ? 'Waiting' : 'Completed';
    return `<div class="quest-log-row"><div><strong>${esc(title)}</strong><br><small>${esc(label)}</small></div><span>${c.status === 'pending' ? '⏳' : '✓'}</span></div>`;
  });
  const changeRows = Object.values(state.dayOverrides || {}).map(ov => {
    const q = (state.quests || []).find(x => x.id === ov.questId);
    return `<div class="quest-log-row"><div><strong>${esc((q && q.title) || 'Quest')}</strong><br><small>${esc(questOverrideLabel(ov))}</small></div><span>↔</span></div>`;
  });
  mount.innerHTML = `<section class="card"><div class="card-head"><h3>Quest Log · Today</h3></div>
    <p class="muted">Responsibility history only. Point history stays in the Point Ledger.</p>
    ${[...completionRows, ...changeRows].join('') || '<div class="empty">No Quest activity yet today.</div>'}
    <p class="portal-muted" style="margin-top:10px">Date navigation and filters arrive in Quest Slice 3.</p></section>`;
}

export function createQuestSlice2Controller({ getState, toast, onOverridesChanged }) {
  let sessionKey = '';
  let date = null;
  let unsub = null;
  let dateTimer = null;
  let busyBatch = false;

  async function attachOverrideStream(fid) {
    const nextDate = localDate();
    if (unsub) { unsub(); unsub = null; }
    date = nextDate;
    try {
      unsub = await subscribeOverrides(fid, date, map => onOverridesChanged(map), err => {
        console.warn('Quest day overrides unavailable', err);
        onOverridesChanged({});
      });
    } catch (err) {
      console.warn('Quest day override subscribe failed', err);
      onOverridesChanged({});
    }
  }

  async function setSession(fid, uid, role) {
    const key = `${fid || ''}|${uid || ''}|${role || ''}`;
    if (!fid) return;
    if (sessionKey !== key) {
      sessionKey = key;
      await attachOverrideStream(fid);
      clearInterval(dateTimer);
      dateTimer = setInterval(() => {
        if (localDate() !== date) attachOverrideStream(fid);
      }, 60 * 1000);
    }
  }

  function render() {
    const state = getState();
    if (!state || state.role !== 'parent') return;
    ensurePortalShell(state);
    navTab(state, state.questTab || 'today');
    renderToday(state);
    renderLog(state);
  }

  async function approveSelected() {
    const state = getState();
    if (busyBatch || !state.approveSel.size) return;
    busyBatch = true;
    const ids = [...state.approveSel];
    let ok = 0, failed = 0;
    for (const id of ids) {
      const c = (state.pendingApprovals || []).find(x => x.id === id);
      if (!c) { state.approveSel.delete(id); continue; }
      try {
        await store.approveCompletion(state.familyId, state.uid, c);
        state.approveSel.delete(id); ok++;
      } catch (_) { failed++; }
    }
    busyBatch = false;
    toast(failed ? `Approved ${ok}; ${failed} need another try.` : `Approved ${ok} quest${ok === 1 ? '' : 's'} ⭐`);
    render();
  }

  document.addEventListener('click', async e => {
    const state = getState();
    if (!state) return;
    const tab = e.target.closest('[data-qtab]');
    if (tab) { navTab(state, tab.dataset.qtab); render(); return; }

    if (e.target.closest('[data-approve-selall]')) {
      const items = state.pendingApprovals || [];
      const all = items.length && items.every(x => state.approveSel.has(x.id));
      state.approveSel.clear();
      if (!all) items.forEach(x => state.approveSel.add(x.id));
      render(); return;
    }
    if (e.target.closest('[data-approve-selected]')) { await approveSelected(); return; }

    const skip = e.target.closest('[data-today-skip]');
    if (skip) {
      try { await setOverride(state.familyId, state.uid, skip.dataset.todaySkip, localDate(), 'skip'); toast('Skipped for today only.'); }
      catch (_) { toast('Could not change today — check Firestore rules.'); }
      return;
    }
    const move = e.target.closest('[data-today-move]');
    if (move) {
      const q = (state.quests || []).find(x => x.id === move.dataset.todayMove);
      if (!q) return;
      const window = laterWindowFor(q);
      try { await setOverride(state.familyId, state.uid, q.id, localDate(), 'move', { window }); toast(`Moved to ${WINDOW_LABEL[window]} for today.`); }
      catch (_) { toast('Could not change today — check Firestore rules.'); }
      return;
    }
    const next = e.target.closest('[data-today-next]');
    if (next) {
      try { await setOverride(state.familyId, state.uid, next.dataset.todayNext, localDate(), 'next', { window: phaseNow() }); toast('Made next for today.'); }
      catch (_) { toast('Could not change today — check Firestore rules.'); }
      return;
    }
    const clear = e.target.closest('[data-today-clear]');
    if (clear) {
      try { await clearOverride(state.familyId, clear.dataset.todayClear, localDate()); toast('Back to the normal plan for this quest.'); }
      catch (_) { toast('Could not clear today’s change.'); }
      return;
    }

    const preset = e.target.closest('[data-today-preset]');
    if (preset) {
      const kind = preset.dataset.todayPreset;
      if (kind === 'custom') { toast('Use the Today buttons below each quest to make a custom day.'); return; }
      const targets = kind === 'normal' ? [] : presetTargetIds(state.quests, kind, localDate());
      const labels = { sick:'Sick day', school_off:'School off', out:'Out all day', easy_morning:'Easy morning', normal:'Normal today' };
      if (kind !== 'normal' && !confirm(`${labels[kind]} affects today only. Apply it?`)) return;
      try {
        await replaceOverrides(state.familyId, state.uid, state.quests, localDate(), state.dayOverrides, targets);
        toast(kind === 'normal' ? 'Today is back to the normal routine.' : `${labels[kind]} applied for today.`);
      } catch (_) { toast('Could not apply that one-day plan — check Firestore rules.'); }
    }
  });

  document.addEventListener('change', e => {
    const box = e.target.closest('[data-approve-sel]');
    if (!box) return;
    const state = getState();
    if (box.checked) state.approveSel.add(box.dataset.approveSel);
    else state.approveSel.delete(box.dataset.approveSel);
    render();
  });

  return { setSession, render };
}
