// Cat Trainer — app orchestrator. Wires auth + role gate to the synced store and
// renders Mom's dashboard and Sirus's game screens from live data.

import { isConfigured } from './firebase.js?v=ea220299';
import {
  parentSignIn, friendlyAuthError, signInChildDevice,
  onAuth, signOutUser, rememberDeviceRole, deviceRole, deviceFamilyId, deviceParentName, deviceUid
} from './auth.js?v=ea220299';
import * as store from './store.js?v=ea220299';
import { CAT_DEFS } from './data/cats.js?v=ea220299';
import { SECTIONS, SECTION_META } from './data/quests.js?v=ea220299';
import { CAFE_ITEMS, CAFE_ROOM_ART } from './data/cafe-items.js?v=ea220299';
import {
  cafeActionFor, catDestinationForObject, catDestinationForTap,
  catWanderDestination, firstCafeDecorElement, catWalkDuration
} from './cafe-interactions.js?v=ea220299';
import {
  CARE_CONFIG, CARE_NEEDS, careCharges, displayNeedValue, isNeedFull,
  lowestCareNeed, needsAt
} from './care.js?v=ea220299';
import {
  QUICK_ACTIONS, HERO_THRESHOLD, HERO_CARE_REQUIRED_DAYS, QUEST_BOND, heroCareDays
} from './shared/rewards.js?v=ea220299';
import {
  CATEGORY, normalizeTransaction, summarizeDay, summarizeWeek, correctedOriginalIds
} from './shared/ledger.js?v=ea220299';
import {
  localDate, addDays, startOfWeek, weekDates, isAfterDate, sameWeek,
  longDateLabel, shortWeekday, dayOfMonth
} from './shared/dates.js?v=ea220299';
import { partitionFeedback, bundleRecognitions } from './shared/feedback.js?v=ea220299';
import {
  organizeDay, nextMissions, minutesAvailable, progressCounts, phaseNow, planDay,
  questTimeWindow, questIsDailyEssential, questRecurrence,
  WINDOW_LABEL, WINDOW_GLYPH
} from './shared/routines.js?v=ea220299';
import { createQuestSlice2Controller } from './quest-slice2.js?v=slice2bc1';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));

const state = {
  role: null, familyId: null, uid: null,
  child: null, cats: {}, quests: [], ownedItems: [], todayCompletions: [], recentTxns: [],
  pendingApprovals: [], prevEvolved: {}, prevCompletions: {}, unsub: null,
  members: {},
  // Day-based ledger view (shared by My Progress and the parent Point Ledger).
  selectedDate: localDate(),
  weekAnchor: startOfWeek(localDate()),
  dayFilter: 'all',
  historyMode: 'day',
  selectedDayTxns: [],
  weekActivity: new Set(),
  weekTxns: [],
  expandedTxn: null,
  completedOpen: false,
  focusQuestId: null,
  stillOpen: new Set(),
  anytimeExpanded: false,
  dayOverrides: {},
  questTab: 'today',
  approveSel: new Set(),
  feedbackEvents: [],
  clientId: null
};

let daySubUnsub = null, weekSubUnsub = null, weekTxnUnsub = null, daySubToken = 0, weekSubToken = 0, weekTxnToken = 0;
let feedbackUnsub = null, feedbackShowing = false;

const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function getClientId() {
  try {
    let id = localStorage.getItem('ct-client-id');
    if (!id) {
      id = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('ct-client-id', id);
    }
    return id;
  } catch (_) {
    return 'c_' + Math.random().toString(36).slice(2);
  }
}

function toast(msg) {
  const t = el('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

const questSlice2 = createQuestSlice2Controller({
  getState: () => state,
  toast,
  onOverridesChanged: (map) => {
    state.dayOverrides = map || {};
    if (state.child) renderAll();
  }
});

// ---- Screen routing ---------------------------------------------------------
function showGateScreen(name) {
  document.querySelectorAll('[data-screen]').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
  $('[data-role-shell="parent"]').hidden = true;
  $('[data-role-shell="child"]').hidden = true;
}
function showShell(role) {
  document.querySelectorAll('[data-screen]').forEach(s => s.classList.remove('active'));
  $('[data-role-shell="parent"]').hidden = role !== 'parent';
  $('[data-role-shell="child"]').hidden = role !== 'child';
}
function navParent(name) {
  document.querySelectorAll('[data-pscreen]').forEach(s => s.classList.toggle('active', s.dataset.pscreen === name));
  document.querySelectorAll('[data-pgo]').forEach(b => b.classList.toggle('active', b.dataset.pgo === name));
  window.scrollTo(0, 0);
}
function navChild(name) {
  document.querySelectorAll('[data-cscreen]').forEach(s => s.classList.toggle('active', s.dataset.cscreen === name));
  document.querySelectorAll('[data-cgo]').forEach(b => b.classList.toggle('active', b.dataset.cgo === name));
  if (name !== 'cafe' && catState !== 'idle') settleCatToRest();
  if (name !== 'cafe' && cafeMode !== 'play') { cafeMode = 'play'; cafeUndo = null; updateCafeModeUI(); }
  if (name === 'cafe') catWelcomeBack();
  window.scrollTo(0, 0);
}

// ---- Entering an app --------------------------------------------------------
async function enterParent(familyId, user, name) {
  stopCareClock();
  const label = name || deviceParentName() || (familyId === user.uid ? 'Mom' : 'Parent');
  const eyebrow = el('p-dash-eyebrow');
  if (eyebrow) eyebrow.textContent = `${label.toUpperCase()}’S DASHBOARD`;
  el('settings-email').textContent = user.email || '';
  if (state.role === 'parent' && state.familyId === familyId && state.uid === user.uid) return;
  state.role = 'parent'; state.familyId = familyId; state.uid = user.uid;
  showShell('parent'); navParent('dash');
  renderQuickActions();
  await subscribeAll();
}
async function enterChild(familyId, uid) {
  state.role = 'child'; state.familyId = familyId; state.uid = uid;
  state.clientId = getClientId();
  showShell('child'); navChild('home');
  await subscribeAll();
  if (feedbackUnsub) feedbackUnsub();
  feedbackUnsub = await store.subscribeFeedback(familyId, store.CHILD_ID, evs => {
    state.feedbackEvents = evs;
    processFeedback();
  });
  startCareClock();
  scheduleCatBeat();
}

async function subscribeAll() {
  if (state.unsub) state.unsub();
  state.unsub = await store.subscribe(state.familyId, {
    onChild: (c) => { state.child = c; renderAll(); },
    onCats: (c) => { detectEvolution(c); state.cats = c; renderAll(); },
    onQuests: (q) => { state.quests = q; renderAll(); },
    onOwnedItems: (o) => { state.ownedItems = o; renderAll(); },
    onTodayCompletions: (t) => { detectApproval(t); state.todayCompletions = t; renderAll(); },
    onPendingApprovals: (p) => { state.pendingApprovals = p; renderAll(); },
    onRecentTxns: (t) => { state.recentTxns = t; renderAll(); },
    onMembers: (m) => { state.members = m; renderAll(); }
  });
  await questSlice2.setSession(state.familyId, state.uid, state.role);
  setSelectedDate(localDate(), { reanchor: true });
}

async function subscribeSelectedDay() {
  if (daySubUnsub) { daySubUnsub(); daySubUnsub = null; }
  const token = ++daySubToken;
  const date = state.selectedDate;
  daySubUnsub = await store.subscribeDay(state.familyId, date, rows => {
    if (token !== daySubToken) return;
    state.selectedDayTxns = rows;
    renderDayViews();
  });
}
async function subscribeWeekActivity() {
  if (weekSubUnsub) { weekSubUnsub(); weekSubUnsub = null; }
  const token = ++weekSubToken;
  const dates = weekDates(state.weekAnchor);
  weekSubUnsub = await store.subscribeRangeActivity(state.familyId, dates, marked => {
    if (token !== weekSubToken) return;
    state.weekActivity = marked;
    renderDayViews();
  });
}
async function subscribeWeekTransactions() {
  if (weekTxnUnsub) { weekTxnUnsub(); weekTxnUnsub = null; }
  const token = ++weekTxnToken;
  const dates = weekDates(state.weekAnchor);
  weekTxnUnsub = await store.subscribeRangeTransactions(state.familyId, dates, rows => {
    if (token !== weekTxnToken) return;
    state.weekTxns = rows;
    if (state.historyMode === 'week') renderDayViews();
  });
}
function setSelectedDate(date, { reanchor = false } = {}) {
  const today = localDate();
  if (isAfterDate(date, today)) date = today;
  const weekChanged = reanchor || !sameWeek(date, state.weekAnchor);
  state.selectedDate = date;
  state.expandedTxn = null;
  if (weekChanged) state.weekAnchor = startOfWeek(date);
  subscribeSelectedDay();
  if (weekChanged) { subscribeWeekActivity(); subscribeWeekTransactions(); }
  renderDayViews();
}
function setWeekAnchor(anchor) {
  state.weekAnchor = startOfWeek(anchor);
  subscribeWeekActivity();
  subscribeWeekTransactions();
  renderDayViews();
}
function setHistoryMode(mode) {
  if (mode !== 'day' && mode !== 'week') return;
  if (mode === 'week') {
    state.weekAnchor = startOfWeek(state.selectedDate);
    subscribeWeekActivity();
    subscribeWeekTransactions();
  }
  state.historyMode = mode;
  state.expandedTxn = null;
  renderDayViews();
}
function setDayFilter(filter) { state.dayFilter = filter; renderDayViews(); }
function renderDayViews() {
  if (state.role === 'parent') renderLedger();
  else if (state.role === 'child') renderChildProgress();
}
function completionStatus(questId) {
  const c = state.todayCompletions.find(x => x.questId === questId);
  return c ? c.status : null;
}

function detectApproval(newCompletions) {
  if (state.role !== 'child') { state.prevCompletions = {}; return; }
  const prev = state.prevCompletions;
  const next = {};
  for (const c of newCompletions) {
    next[c.questId] = c.status;
    if (prev[c.questId] === 'pending' && c.status === 'approved') {
      const q = state.quests.find(x => x.id === c.questId);
      const mins = q ? q.points : 0;
      confettiBurst();
      if (navigator.vibrate) { try { navigator.vibrate([10, 40, 10]); } catch (_) {} }
      const approver = (c.approvedBy && state.members[c.approvedBy] && state.members[c.approvedBy].displayName) || 'A parent';
      toast(`${approver} said yes! +${mins}m ⭐`);
    }
  }
  state.prevCompletions = next;
}
function detectEvolution(newCats) {
  if (state.role !== 'child') return;
  for (const id of Object.keys(newCats)) {
    const was = state.prevEvolved[id];
    if (was === false && newCats[id].evolved) showEvolution(id);
    state.prevEvolved[id] = newCats[id].evolved;
  }
}
function showEvolution(catId) {
  const d = CAT_DEFS[catId];
  el('evo-title').textContent = `${d.heroName} unlocked!`;
  el('evo-art').src = d.heroArt;
  el('evo-copy').textContent = `${d.name} balanced Brain, Energy, and 14 active care days and became ${d.heroTitle}.`;
  el('evolution-dialog').showModal();
  const card = el('evolution-dialog').querySelector('.modal-card');
  spawnFx('assets/fx-starburst.png', card, { count: 1, cx: 50, cy: 42, spread: 0, size: 220, life: 900, mode: 'pop' });
  spawnFx('assets/fx-confetti.png', card, { count: 8, cx: 50, cy: 8, spread: 40, size: 40, life: 1500, mode: 'fall' });
}

function processFeedback() {
  if (state.role !== 'child' || feedbackShowing || document.hidden) return;
  const { recognitions, returns } = partitionFeedback(state.feedbackEvents, state.clientId, Date.now());
  if (recognitions.length) return showRecognitionCard(recognitions);
  if (returns.length) return showReturnedCard(returns);
}
function scheduleReprocess() { setTimeout(processFeedback, 300); }
async function showRecognitionCard(recognitions) {
  feedbackShowing = true;
  let claimed;
  try { claimed = await store.claimFeedback(state.familyId, recognitions.map(e => e.id), state.clientId); }
  catch (_) { feedbackShowing = false; return; }
  if (!claimed.length) { feedbackShowing = false; scheduleReprocess(); return; }
  const model = bundleRecognitions(claimed);
  const cardEl = buildRecognitionCard(model);
  document.body.appendChild(cardEl);
  requestAnimationFrame(() => {
    cardEl.classList.add('show');
    recognitionFx(model, cardEl);
    store.markFeedbackSeen(state.familyId, model.ids).catch(() => {});
  });
  cardEl.__auto = setTimeout(() => dismissFeedbackCard(cardEl), 6500);
}
async function showReturnedCard(returns) {
  feedbackShowing = true;
  let claimed;
  try { claimed = await store.claimFeedback(state.familyId, returns.map(e => e.id), state.clientId); }
  catch (_) { feedbackShowing = false; return; }
  if (!claimed.length) { feedbackShowing = false; scheduleReprocess(); return; }
  const cardEl = buildReturnedCard(claimed);
  document.body.appendChild(cardEl);
  requestAnimationFrame(() => {
    cardEl.classList.add('show');
    store.markFeedbackSeen(state.familyId, claimed.map(e => e.id)).catch(() => {});
  });
  cardEl.__auto = setTimeout(() => dismissFeedbackCard(cardEl), 7000);
}
function buildRecognitionCard(model) {
  const card = document.createElement('div');
  card.className = 'feedback-card recognition';
  card.setAttribute('role', 'status');
  const heading = model.bundled ? `You were noticed ${model.count} times!` : 'You were noticed!';
  const lines = model.lines.map(l => {
    const reason = l.reasonLabel ? `: <strong>${esc(l.reasonLabel)}</strong>` : '';
    const note = l.parentNote ? ` <span class="fb-note">“${esc(l.parentNote)}”</span>` : '';
    return `<li>${esc(l.actorName)} noticed${reason}${note}</li>`;
  }).join('');
  const minutes = `+${model.totalAmount} ${model.totalAmount === 1 ? 'minute' : 'minutes'}`;
  card.innerHTML = `
    <button class="fb-close" data-fb-dismiss aria-label="Close">✕</button>
    <div class="fb-star"><img src="assets/game-time-star.png" alt=""><span class="fb-amount">+${model.totalAmount}</span></div>
    <h3 class="fb-title">${esc(heading)}</h3>
    <ul class="fb-lines">${lines}</ul>
    <p class="fb-min">${esc(minutes)}</p>
    <button class="primary-button fb-progress" data-fb-progress>See today's progress</button>`;
  return card;
}
function buildReturnedCard(events) {
  const card = document.createElement('div');
  card.className = 'feedback-card returned';
  card.setAttribute('role', 'status');
  const many = events.length > 1;
  const heading = many ? 'A few quests came back' : 'A quest came back';
  const lines = events.map(e => `<li>${esc(e.reasonLabel || 'Quest')}</li>`).join('');
  card.innerHTML = `
    <button class="fb-close" data-fb-dismiss aria-label="Close">✕</button>
    <h3 class="fb-title">${esc(heading)}</h3>
    <ul class="fb-lines">${lines}</ul>
    <p class="fb-min soft">You can try ${many ? 'them' : 'it'} again whenever you're ready.</p>
    <button class="primary-button fb-progress" data-fb-dismiss>Okay</button>`;
  return card;
}
function dismissFeedbackCard(cardEl) {
  if (!cardEl || cardEl.__dismissed) return;
  cardEl.__dismissed = true;
  clearTimeout(cardEl.__auto);
  cardEl.classList.remove('show');
  setTimeout(() => cardEl.remove(), 260);
  feedbackShowing = false;
  scheduleReprocess();
}
function recognitionFx(model, cardEl) {
  if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
  if (prefersReducedMotion()) return;
  spawnFx('assets/fx-starburst.png', cardEl, { count: 1, cx: 50, cy: 20, spread: 0, size: 120, life: 800, mode: 'pop' });
  spawnFx('assets/fx-sparkle.png', cardEl, { count: 3, cx: 50, cy: 20, spread: 34, size: 28, life: 900 });
  flyPointsToAvailable(model.totalAmount);
  celebrateActiveCat();
}
function flyPointsToAvailable(amount) {
  const target = el('c-available');
  if (!target) return;
  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const startX = window.innerWidth / 2, startY = window.innerHeight * 0.28;
  const fly = document.createElement('div');
  fly.className = 'fb-fly';
  fly.textContent = `+${amount}`;
  fly.style.left = startX + 'px'; fly.style.top = startY + 'px';
  document.body.appendChild(fly);
  requestAnimationFrame(() => {
    fly.style.transform = `translate(${rect.left + rect.width / 2 - startX}px, ${rect.top + rect.height / 2 - startY}px) scale(.5)`;
    fly.style.opacity = '0';
  });
  setTimeout(() => fly.remove(), 850);
}
function celebrateActiveCat() {
  const onCafe = document.querySelector('[data-cscreen="cafe"]')?.classList.contains('active');
  if (onCafe) {
    if (catState === 'idle' && cafeMode === 'play' && !cafeDrag) {
      const { cat, def } = catCtx();
      if (cat && def && !cat.evolved && def.poses && def.poses.celebrate) {
        catTransient('react', 3500);
        playSprite('celebrate', { fps: 3, holdMs: 3500 });
      }
    }
    return;
  }
  const onHome = document.querySelector('[data-cscreen="home"]')?.classList.contains('active');
  const art = el('c-cat-art');
  if (onHome && art && state.child) {
    const def = CAT_DEFS[state.child.activeCatId];
    const cat = state.cats[state.child.activeCatId];
    if (def && def.poses && def.poses.celebrate && !(cat && cat.evolved)) {
      art.src = def.poses.celebrate;
      setTimeout(() => { if (state.role === 'child') renderChildHome(); }, 3200);
    }
  }
}

// ---- Rendering --------------------------------------------------------------
function renderAll() {
  if (!state.child) return;
  if (state.role === 'parent') {
    renderApprovals(); renderParentDash(); renderLedger(); renderSirusToday();
    renderParentQuests(); renderParentCats(); renderParentCafe(); questSlice2.render();
  } else {
    renderChildHome(); renderChildQuests(); renderChildCats(); renderChildCafe(); renderChildProgress();
  }
}

function ledgerRow(raw, deletable = false) {
  const t = normalizeTransaction(raw, { members: state.members });
  const d = rowDelta(t);
  const del = deletable ? `<button class="icon-btn del-txn" data-del-txn="${esc(t.id)}" aria-label="Delete this entry">🗑️</button>` : '';
  const note = t.note ? `<small class="ledger-note">${esc(t.note)}</small>` : '';
  return `<div class="ledger-item"><span class="ledger-delta ${d.cls}">${d.text}</span>
    <div class="ledger-text"><p>${esc(t.reasonLabel || '')}</p>${note}</div><time>${esc(t.timeLabel || '')}</time>${del}</div>`;
}
function renderQuickActions() {
  el('quick-actions').innerHTML = QUICK_ACTIONS.map(a =>
    `<button class="adjust ${a.tone}" data-quick="${a.code}">${a.amount > 0 ? '+' : ''}${a.amount}<small>${esc(a.label)}</small></button>`
  ).join('');
}
function renderParentDash() {
  el('p-available').textContent = state.child.available || 0;
  const { earned, used } = store.todayTotals(state.recentTxns);
  el('p-earned').textContent = earned;
  el('p-spent').textContent = used;
  const rows = state.recentTxns.slice(0, 6);
  el('dash-ledger').innerHTML = rows.length ? rows.map(t => ledgerRow(t, true)).join('') : '<div class="empty">No activity yet today.</div>';
}

const CAT_META = {
  earned: { label: 'Earned', chip: 'earned' },
  used: { label: 'Used', chip: 'used' },
  room_to_grow: { label: 'Room to Grow', chip: 'rtg' },
  correction: { label: 'Correction', chip: 'correction' },
  other: { label: 'Other activity', chip: 'other' }
};
const FILTER_LABELS = { all: 'All', earned: 'Earned', used: 'Used', room_to_grow: 'Room to Grow', correction: 'Corrections' };
function rowDelta(t) {
  if (t.category === CATEGORY.USED) return { text: `-${Math.abs(Number(t.amount) || 0)} min`, cls: 'used' };
  const amt = t.category === CATEGORY.CORRECTION ? (Number(t.amount) || 0) : t.requestedAmount;
  const sign = amt > 0 ? '+' : amt < 0 ? '-' : '';
  const cls = t.category === CATEGORY.EARNED ? 'earned'
    : t.category === CATEGORY.ROOM_TO_GROW ? 'rtg'
    : t.category === CATEGORY.CORRECTION ? 'correction' : 'other';
  return { text: `${sign}${Math.abs(amt)}`, cls };
}
function normalizedDay() {
  const sel = state.selectedDate;
  return state.selectedDayTxns
    .map(t => normalizeTransaction(t, { members: state.members }))
    .filter(t => t.activityDate === sel)
    .sort((a, b) => (b.createdAt?.seconds ?? Infinity) - (a.createdAt?.seconds ?? Infinity));
}
function emptyMessage() {
  if (state.dayFilter !== 'all') return 'Nothing in this part of the day.';
  return state.selectedDate === localDate() ? 'No point activity yet today.' : 'No point activity on this day.';
}
function normalizedWeek() {
  const dates = new Set(weekDates(state.weekAnchor));
  return state.weekTxns
    .map(t => normalizeTransaction(t, { members: state.members }))
    .filter(t => dates.has(t.activityDate))
    .sort((a, b) => (b.activityDate || '').localeCompare(a.activityDate || '') || (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
}
function historyModeToggleHtml() {
  return `<div class="history-mode-toggle" role="group" aria-label="Progress time range">
    <button type="button" data-history-mode="day" class="${state.historyMode === 'day' ? 'active' : ''}" aria-pressed="${state.historyMode === 'day'}">Day</button>
    <button type="button" data-history-mode="week" class="${state.historyMode === 'week' ? 'active' : ''}" aria-pressed="${state.historyMode === 'week'}">Week</button>
  </div>`;
}
function weekNavHtml() {
  const today = localDate();
  const current = startOfWeek(today);
  const atCurrent = state.weekAnchor === current;
  return `<div class="week-nav"><div class="day-nav-row">
      <button class="day-arrow" data-week-prev aria-label="Previous week">‹</button>
      <div class="day-current">Week of ${esc(longDateLabel(state.weekAnchor))}</div>
      <button class="day-arrow" data-week-next ${state.weekAnchor >= current ? 'disabled' : ''} aria-label="Next week">›</button>
    </div>${atCurrent ? '' : '<button class="text-button week-current" data-week-current>This week</button>'}</div>`;
}
function weekSummaryHtml(s, { parent }) {
  const patterns = s.behaviors.length
    ? `<div class="week-pattern-list">${s.behaviors.map(b => `<span class="week-pattern">${esc(b.label)} · ${b.count}</span>`).join('')}</div>`
    : '<p class="muted week-empty">No Room to Grow moments recorded this week.</p>';
  const resetText = s.heroResets
    ? `${s.heroResets} Hero’s ${s.heroResets === 1 ? 'Reset' : 'Resets'} · ${s.linkedRecoveries} linked ${s.linkedRecoveries === 1 ? 'recovery' : 'recoveries'}`
    : 'No Hero’s Resets recorded this week.';
  return `<section class="week-reflection" aria-label="Weekly reflection">
    <div class="week-reflection-head"><div><p class="eyebrow purple">${parent ? 'WEEKLY REFLECTION' : 'YOUR WEEK'}</p><h3>How this week looked</h3></div></div>
    <div class="day-summary week-totals">
      <div class="sum earned"><strong>${s.earnedCount} ${s.earnedCount === 1 ? 'win' : 'wins'}</strong><span>+${s.earnedPoints} earned</span></div>
      <div class="sum used"><strong>${s.usedMinutes} min</strong><span>screen used</span></div>
      <div class="sum rtg"><strong>${s.roomToGrowCount} ${s.roomToGrowCount === 1 ? 'moment' : 'moments'}</strong><span>${s.roomToGrowPoints} Room to Grow</span></div>
    </div><div class="week-recovery"><strong>Reset & recover</strong><span>${resetText}</span></div>
    <div class="week-patterns"><strong>Room to Grow patterns</strong>${patterns}</div></section>`;
}
function dayNavHtml() {
  const today = localDate();
  const sel = state.selectedDate;
  const atToday = sel === today;
  const strip = weekDates(state.weekAnchor).map(d => {
    const future = isAfterDate(d, today), active = d === sel;
    const dot = state.weekActivity.has(d) ? '<span class="day-dot" aria-hidden="true"></span>' : '';
    return `<button class="day-cell${active ? ' active' : ''}" data-day-pick="${d}" ${future ? 'disabled' : ''} aria-pressed="${active}">
      <span class="day-wd">${esc(shortWeekday(d))}</span><span class="day-num">${dayOfMonth(d)}</span>${dot}</button>`;
  }).join('');
  const weekNextDisabled = sameWeek(today, state.weekAnchor) || isAfterDate(state.weekAnchor, today);
  return `<div class="day-nav"><div class="day-nav-row">
      <button class="day-arrow" data-day-prev aria-label="Previous day">‹</button><div class="day-current">${esc(longDateLabel(sel))}</div>
      <button class="day-arrow" data-day-next ${atToday ? 'disabled' : ''} aria-label="Next day">›</button></div>
    <div class="day-nav-row secondary">${atToday ? '' : '<button class="text-button" data-day-today>Today</button>'}
      <button class="text-button" data-week-prev aria-label="Previous week">‹ Week</button>
      <button class="text-button" data-week-next ${weekNextDisabled ? 'disabled' : ''} aria-label="Next week">Week ›</button>
      <label class="calendar-btn" title="Jump to a date"><span aria-hidden="true">📅</span><input type="date" class="day-calendar" max="${today}" value="${sel}" aria-label="Jump to a date"></label>
    </div><div class="day-strip">${strip}</div></div>`;
}
function daySummaryHtml(s, { parent }) {
  const tiles = [
    `<div class="sum earned"><strong>${s.earnedCount} ${s.earnedCount === 1 ? 'win' : 'wins'}</strong><span>+${s.earnedPoints}</span></div>`,
    `<div class="sum used"><strong>${s.usedMinutes} min</strong><span>used</span></div>`,
    `<div class="sum rtg"><strong>${s.roomToGrowCount} ${s.roomToGrowCount === 1 ? 'moment' : 'moments'}</strong><span>${s.roomToGrowPoints}</span></div>`
  ];
  if (parent && s.corrections > 0) tiles.push(`<div class="sum correction"><strong>${s.corrections}</strong><span>corrections</span></div>`);
  return `<div class="day-summary">${tiles.join('')}</div>`;
}
function dayFilterHtml({ parent }) {
  const chips = ['all', 'earned', 'used', 'room_to_grow'].concat(parent ? ['correction'] : []);
  return `<div class="day-filters">${chips.map(c => `<button class="chip${state.dayFilter === c ? ' active' : ''}" data-day-filter="${c}">${esc(FILTER_LABELS[c])}</button>`).join('')}</div>`;
}
function rewardEffectsLabel(rr, ra) {
  const parts = [];
  for (const k of ['brain', 'energy', 'bond', 'coins']) {
    const req = rr ? Number(rr[k] || 0) : 0, app = ra ? Number(ra[k] || 0) : 0;
    if (!req && !app) continue;
    parts.push(req === app ? `${k} +${app}` : `${k} +${app} of +${req}`);
  }
  return parts.join(', ');
}
function actorLabel(t) {
  if (t.kind === 'quest') return 'Approved by';
  if (t.category === CATEGORY.USED) return 'Recorded by';
  if (t.category === CATEGORY.ROOM_TO_GROW) return 'Noted by';
  if (t.category === CATEGORY.CORRECTION) return 'Corrected by';
  return 'Noticed by';
}
function rowDetail(t, { parent }) {
  const rows = [];
  if (t.timeLabel) rows.push(['Time', t.timeLabel]);
  rows.push([actorLabel(t), t.actorName]);
  if (t.note) rows.push(['Note', t.note]);
  if (t.kind === 'quest' && t.localDate && t.localDate !== t.activityDate) rows.push(['Approved', 'the next day']);
  if (parent) {
    rows.push(['Source', `${t.kind || '—'}${t.reasonCode ? ' · ' + t.reasonCode : ''}`]);
    if (Number(t.requestedAmount) !== Number(t.amount)) rows.push(['Intended vs applied', `${t.requestedAmount} → ${t.amount}`]);
    rows.push(['Activity date', t.activityDate || '—']);
    if (t.localDate && t.localDate !== t.activityDate) rows.push(['Posted', t.localDate]);
    const eff = rewardEffectsLabel(t.rewardRequested, t.rewardApplied);
    if (eff) rows.push(['Cat effects', eff]);
    if (t.questCompletionId) rows.push(['Quest completion', t.questCompletionId]);
    if (t.questAttemptId) rows.push(['Attempt', t.questAttemptId]);
    if (t.reversesTransactionId) rows.push(['Reverses entry', t.reversesTransactionId]);
  }
  return `<dl class="prog-detail">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}
function progressRow(t, { parent, corrected }) {
  const meta = CAT_META[t.category] || CAT_META.other;
  const d = rowDelta(t), expanded = state.expandedTxn === t.id, badges = [];
  if (t.reasonCode === 'hero_reset') badges.push('<span class="row-badge reset">Reset</span>');
  if (corrected) badges.push('<span class="row-badge corrected">Corrected</span>');
  const note = t.note ? `<small class="row-note">${esc(t.note)}</small>` : '';
  return `<div class="prog-row ${d.cls}${corrected ? ' is-corrected' : ''}${expanded ? ' open' : ''}" data-txn-toggle="${esc(t.id)}" role="button" tabindex="0" aria-expanded="${expanded}">
    <div class="prog-main"><span class="prog-delta ${d.cls}">${d.text}</span><div class="prog-text"><p>${esc(t.reasonLabel || meta.label)}${badges.length ? ' ' + badges.join(' ') : ''}</p>${note}</div><span class="prog-chip ${meta.chip}">${esc(meta.label)}</span></div>
    ${expanded ? rowDetail(t, { parent }) : ''}</div>`;
}
function renderChildProgress() {
  const mount = el('c-progress-view'); if (!mount) return;
  if (state.historyMode === 'week') {
    const summary = summarizeWeek(normalizedWeek()), available = (state.child && state.child.available) || 0;
    mount.innerHTML = `<div class="available-banner"><span>Available now</span><strong>${available} min</strong></div>${historyModeToggleHtml()}${weekNavHtml()}${weekSummaryHtml(summary, { parent: false })}`;
    return;
  }
  const day = normalizedDay(), summary = summarizeDay(day), corrected = correctedOriginalIds(day), available = (state.child && state.child.available) || 0;
  let rows = day.filter(t => t.category !== CATEGORY.CORRECTION && !corrected.has(t.id));
  if (state.dayFilter !== 'all' && state.dayFilter !== 'correction') rows = rows.filter(t => t.category === state.dayFilter);
  const list = rows.length ? rows.map(t => progressRow(t, { parent: false, corrected: corrected.has(t.id) })).join('') : `<div class="empty">${esc(emptyMessage())}</div>`;
  mount.innerHTML = `<div class="available-banner"><span>Available now</span><strong>${available} min</strong></div>${historyModeToggleHtml()}${dayNavHtml()}${daySummaryHtml(summary, { parent: false })}${dayFilterHtml({ parent: false })}<div class="day-list">${list}</div>`;
}
function renderLedger() {
  const mount = el('p-ledger-view'); if (!mount) return;
  if (state.historyMode === 'week') {
    const summary = summarizeWeek(normalizedWeek()), available = (state.child && state.child.available) || 0;
    mount.innerHTML = `${historyModeToggleHtml()}${weekNavHtml()}${weekSummaryHtml(summary, { parent: true })}<div class="available-banner subtle"><span>Available now</span><strong>${available} min</strong></div>`;
    return;
  }
  const day = normalizedDay(), summary = summarizeDay(day), corrected = correctedOriginalIds(day), available = (state.child && state.child.available) || 0;
  let rows = day;
  if (state.dayFilter !== 'all') rows = rows.filter(t => t.category === state.dayFilter);
  const list = rows.length ? rows.map(t => progressRow(t, { parent: true, corrected: corrected.has(t.id) })).join('') : `<div class="empty">${esc(emptyMessage())}</div>`;
  mount.innerHTML = `${historyModeToggleHtml()}${dayNavHtml()}${daySummaryHtml(summary, { parent: true })}<div class="available-banner subtle"><span>Available now</span><strong>${available} min</strong></div>${dayFilterHtml({ parent: true })}<div class="day-list">${list}</div>`;
}

function renderSirusToday() {
  const box = el('sirus-today'); if (!box) return;
  const active = state.quests.filter(q => q.enabled !== false).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const done = active.filter(q => completionStatus(q.id) === 'approved').length;
  const waiting = active.filter(q => completionStatus(q.id) === 'pending').length;
  const todo = active.length - done - waiting;
  const summary = el('sirus-today-summary');
  if (summary) summary.textContent = active.length ? `${todo} to do · ${waiting} waiting for you · ${done} done` : 'No quests are turned on for Sirus right now.';
  box.innerHTML = active.map(q => {
    const st = completionStatus(q.id), meta = SECTION_META[q.section] || {}, tag = meta.glyph ? `${meta.glyph} ` : '';
    const note = st === 'pending' ? ' · ⏳ waiting for you' : '';
    const action = st === 'approved' ? '<span class="status-chip done">✓ Done</span>' : `<button class="pill-btn approve" data-sirus-done="${esc(q.id)}">${st === 'pending' ? '✓ Approve' : 'Mark done'}</button>`;
    return `<div class="sirus-today-row"><div class="q-body"><strong>${esc(q.title)}</strong><br><small>${tag}${esc(q.section)}${note}</small></div>${action}</div>`;
  }).join('') || '<div class="empty">Turn on a quest below and it\'ll show here.</div>';
}
function parentQuestRow(q) {
  const on = q.enabled !== false;
  return `<div class="parent-quest-row ${on?'':'quest-off'}"><div class="q-body"><strong>${esc(q.title)}</strong>
    <br><small>+${q.points}m ${q.brain?'· ★'+q.brain:''} ${q.energy?'· ⚡'+q.energy:''} · ♥${QUEST_BOND} ${q.coins?'· 🪙'+q.coins:''}</small></div>
    <button class="lock-toggle ${on?'on':'off'}" data-toggle-quest="${esc(q.id)}" role="switch" aria-checked="${on}" aria-label="${on?'On — tap to lock off':'Off — tap to turn on'}">${on?'On':'🔒 Off'}</button>
    <button class="icon-btn" data-edit-quest="${esc(q.id)}">✎</button><button class="icon-btn" data-del-quest="${esc(q.id)}">×</button></div>`;
}
function renderParentQuests() {
  const quests = state.quests.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const known = SECTIONS.filter(s => quests.some(q => q.section === s));
  const custom = [...new Set(quests.map(q => q.section))].filter(s => !SECTIONS.includes(s));
  const html = [...known, ...custom].map(section => {
    const qs = quests.filter(q => q.section === section), meta = SECTION_META[section] || { glyph: '•' };
    const icon = meta.icon ? `<img src="${meta.icon}" alt="">` : `<span class="section-glyph">${meta.glyph}</span>`;
    const onCount = qs.filter(q => q.enabled !== false).length;
    return `<details class="quest-section" open><summary><span class="qs-head">${icon}${esc(section)}</span><span class="qs-count">${onCount}/${qs.length} on</span></summary><div class="qs-body">${qs.map(parentQuestRow).join('')}</div></details>`;
  }).join('');
  el('parent-quests').innerHTML = html || '<div class="empty">No quests yet.</div>';
}
function renderApprovals() {
  const box = el('pending-approvals'); if (!box) return;
  const items = state.pendingApprovals || [], badge = el('approvals-count'), card = el('approvals-card');
  if (badge) { badge.textContent = items.length; badge.hidden = items.length === 0; }
  if (card) card.hidden = items.length === 0;
  box.innerHTML = items.map(c => {
    const q = state.quests.find(x => x.id === c.questId), title = (q && q.title) || c.questTitle || 'Quest', r = c.rewards || {};
    const pts = q ? q.points : (r.points || 0), coins = q ? q.coins : (r.coins || 0);
    const reward = `+${pts}m${q&&q.brain?' · ★'+q.brain:(r.brain?' · ★'+r.brain:'')}${q&&q.energy?' · ⚡'+q.energy:(r.energy?' · ⚡'+r.energy:'')} · ♥${QUEST_BOND}${coins?' · 🪙'+coins:''}`;
    return `<div class="approval-row"><div class="q-body"><strong>${esc(title)}</strong><br><small>${reward}</small></div><button class="pill-btn reject" data-reject="${esc(c.id)}" aria-label="Reject ${esc(title)}">✕</button><button class="pill-btn approve" data-approve="${esc(c.id)}" aria-label="Approve ${esc(title)}">✓ Approve</button></div>`;
  }).join('') || '<div class="empty">Nothing waiting — all caught up!</div>';
}
function catCardHtml(id, canTrain) {
  const def = CAT_DEFS[id], cat = state.cats[id] || { brain:0, energy:0, bond:0, evolved:false }, active = state.child.activeCatId === id;
  const careDays = heroCareDays(cat), careLabel = cat.evolved ? '☀ Hero' : `☀${careDays}/${HERO_CARE_REQUIRED_DAYS}`;
  return `<article class="cat-card ${active?'active':''}">${cat.evolved?'<span class="hero-badge">HERO</span>':''}<img src="${cat.evolved?def.heroArt:def.art}" alt="${esc(def.name)}"><h3>${esc(cat.evolved?def.heroName:def.name)}</h3><p class="sub">★${cat.brain||0}/12 · ⚡${cat.energy||0}/12 · ${careLabel} · ♥${cat.bond||0}/20</p>${canTrain?`<button class="wide-button" data-train="${id}" ${active?'disabled':''}>${active?'Training':'Train this cat'}</button>`:''}</article>`;
}
function renderParentCats() { el('parent-cats').innerHTML = Object.keys(CAT_DEFS).map(id => catCardHtml(id, false)).join(''); }
function renderParentCafe() { el('parent-cafe').innerHTML = `<p class="muted">Sirus decorates the café with Cat Coins. Owned: ${state.ownedItems.length} item(s).</p>`; }

function meter(barId, valId, value, max) { el(barId).style.width = `${Math.min(100, (value / max) * 100)}%`; el(valId).textContent = `${value}/${max}`; }
function naturalList(items) { if (items.length < 2) return items[0] || ''; if (items.length === 2) return `${items[0]} and ${items[1]}`; return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`; }
function heroNeedsText(cat) {
  const brain = Math.max(0, HERO_THRESHOLD.brain - (cat.brain || 0)), energy = Math.max(0, HERO_THRESHOLD.energy - (cat.energy || 0)), care = Math.max(0, HERO_CARE_REQUIRED_DAYS - heroCareDays(cat));
  const needs = []; if (brain) needs.push(`${brain} more Brain`); if (energy) needs.push(`${energy} more Energy`); if (care) needs.push(`${care} more active care ${care === 1 ? 'day' : 'days'}`);
  return needs.length ? `Hero Form needs ${naturalList(needs)}.` : 'Hero Form is ready!';
}
function renderChildHome() {
  const id = state.child.activeCatId, def = CAT_DEFS[id], cat = state.cats[id] || { brain:0, energy:0, bond:0, evolved:false };
  el('c-available').textContent = state.child.available || 0;
  const { earned } = store.todayTotals(state.recentTxns); el('c-earned').textContent = earned;
  const pend = state.pendingApprovals || [], pMin = pend.reduce((s,c)=>s+((c.rewards&&c.rewards.points)||0),0), pCoins = pend.reduce((s,c)=>s+((c.rewards&&c.rewards.coins)||0),0), tray = el('c-pending-tray');
  if (tray) { tray.hidden = pend.length === 0; el('c-pending').innerHTML = `⭐ <strong>${pMin}m</strong>${pCoins?` · 🪙 <strong>${pCoins}</strong>`:''} waiting for Mom`; }
  el('c-cat-art').src = cat.evolved ? def.heroArt : def.art; el('c-cat-name').textContent = cat.evolved ? def.heroName : def.name;
  meter('c-brain-bar','c-brain-val',cat.brain||0,12); meter('c-energy-bar','c-energy-val',cat.energy||0,12); meter('c-bond-bar','c-bond-val',cat.bond||0,20); meter('c-care-days-bar','c-care-days-val',heroCareDays(cat),HERO_CARE_REQUIRED_DAYS);
  el('c-care-days-row').hidden = !!cat.evolved; el('c-hero-hint').textContent = cat.evolved ? `${def.heroName} — Hero Form!` : heroNeedsText(cat);
  const next = state.quests.filter(q => q.enabled !== false && !completionStatus(q.id)).slice(0, 3);
  el('c-next-quests').innerHTML = next.length ? next.map(childQuestCard).join('') : '<div class="empty">All done — great job!</div>';
}
function childQuestCard(q) {
  const status = completionStatus(q.id), cls = status === 'approved' ? 'done' : status === 'pending' ? 'pending' : '';
  const careReward = careCharges(state.child && state.child.careCharges) >= CARE_CONFIG.chargeCap ? '· ✦ care full' : '· ✦1 care';
  const reward = `+${q.points}m ${q.brain?'· ★'+q.brain:''} ${q.energy?'· ⚡'+q.energy:''} · ♥${QUEST_BOND} ${q.coins?'· 🪙'+q.coins:''} ${careReward}`;
  const btn = status === 'approved' ? `<button class="quest-complete" disabled>✓</button>` : status === 'pending' ? `<span class="quest-pending" aria-label="Waiting for Mom">⏳</span>` : `<button class="quest-complete" data-complete="${esc(q.id)}">+</button>`;
  return `<div class="quest-card ${cls}"><div class="q-body"><div class="q-title">${esc(q.title)}</div><div class="q-reward">${reward}</div>${status==='pending'?'<div class="q-status">Done! Waiting for Mom ⭐</div>':''}</div>${btn}</div>`;
}
function childMissionCard(q, { focus = false } = {}) {
  const card = childQuestCard(q); if (!focus || completionStatus(q.id)) return card;
  return `<div class="mission-wrap">${card}<button class="focus-btn" data-focus="${esc(q.id)}" aria-label="Focus on ${esc(q.title)}">🔎 Focus</button></div>`;
}
function renderChildQuests() {
  const active = state.quests.filter(q => q.enabled !== false);
  const doneIds = new Set(active.filter(q => completionStatus(q.id)).map(q => q.id));
  if (state.focusQuestId) {
    const fq = active.find(q => q.id === state.focusQuestId);
    if (fq && !doneIds.has(fq.id)) { el('c-quests').innerHTML = `<div class="focus-mode"><button class="text-button focus-back" data-focus-exit>← Back to missions</button><div class="focus-card">${childQuestCard(fq)}</div></div>`; return; }
    state.focusQuestId = null;
  }
  const planned = planDay(active, { ymd: localDate(), overrides: state.dayOverrides });
  const day = organizeDay(planned, { phase: phaseNow(), completedIds: doneIds });
  const sections = [];
  if (day.now) {
    const missions = nextMissions(day.now.quests, doneIds, 4), left = progressCounts(day.now.quests, doneIds).left, mins = minutesAvailable(day.now.quests, doneIds);
    const head = `<div class="phase-head now"><span class="phase-eyebrow now-eyebrow">Right now</span><h3>${WINDOW_GLYPH[day.now.window]} ${esc(WINDOW_LABEL[day.now.window])}</h3><small>${left} left · ${mins} minute${mins === 1 ? '' : 's'} available to earn</small></div>`;
    const body = missions.length ? `<p class="pick-cue">Pick your next mission</p>${missions.map(q => childMissionCard(q,{focus:true})).join('')}` : `<div class="empty">All done here — great job! 🎉</div>`;
    sections.push(`<section class="phase now">${head}${body}</section>`);
  }
  for (const g of day.stillNeedsDoing) {
    const unfinished = g.quests.filter(q => !doneIds.has(q.id)), open = state.stillOpen.has(g.window);
    sections.push(`<details class="phase still"${open?' open':''}><summary data-toggle-still="${g.window}"><span class="still-head">${WINDOW_GLYPH[g.window]} ${esc(WINDOW_LABEL[g.window])} — still needs doing</span><span class="still-count">${unfinished.length} left</span></summary><div class="still-body">${unfinished.map(q=>childMissionCard(q)).join('')}</div></details>`);
  }
  if (day.next) sections.push(`<section class="phase next compact"><div class="phase-head"><span class="phase-eyebrow">Next</span><h3>${WINDOW_GLYPH[day.next.window]} ${esc(WINDOW_LABEL[day.next.window])}</h3></div></section>`);
  if (day.later.length) sections.push(`<section class="phase later compact"><div class="phase-head"><span class="phase-eyebrow">Later</span></div><ul class="later-list">${day.later.map(g=>`<li>${WINDOW_GLYPH[g.window]} ${esc(WINDOW_LABEL[g.window])}</li>`).join('')}</ul></section>`);
  const anytimeOpen = day.anytime.filter(q => !doneIds.has(q.id));
  if (anytimeOpen.length) {
    const CAP=3,capped=!state.anytimeExpanded&&anytimeOpen.length>CAP,shown=capped?anytimeOpen.slice(0,CAP):anytimeOpen;
    const toggle=anytimeOpen.length>CAP?`<button class="anytime-toggle" data-toggle-anytime>${state.anytimeExpanded?'Show less':`See all (${anytimeOpen.length})`}</button>`:'';
    sections.push(`<section class="phase anytime"><div class="phase-head"><h3>⭐ Anytime</h3><small>do these any time today</small></div>${shown.map(q=>childMissionCard(q)).join('')}${toggle}</section>`);
  }
  const finished = active.filter(q => completionStatus(q.id));
  const finishedHtml = finished.length ? `<details class="completed-quests"${state.completedOpen?' open':''}><summary data-toggle-completed>✓ Completed today <span class="done-count">${finished.length}</span></summary><div class="completed-body">${finished.map(childQuestCard).join('')}</div></details>` : '';
  el('c-quests').innerHTML = (sections.join('') || (finished.length?'':'<div class="empty">No quests yet.</div>')) + finishedHtml;
}
function renderChildCats() { const canSwitch = state.child.childCanSwitchCat !== false; el('c-cats').innerHTML = Object.keys(CAT_DEFS).map(id => catCardHtml(id, canSwitch)).join(''); }

const CAFE_ITEM_IDS = Object.keys(CAFE_ITEMS);
const CAFE_SLOTS = [[5,5],[39,4],[72,6],[4,28],[72,28],[40,22],[5,50],[73,49],[40,48],[6,71],[73,70]];
function cafeSlot(itemId){const i=Math.max(0,CAFE_ITEM_IDS.indexOf(itemId)),[bx,by]=CAFE_SLOTS[i%CAFE_SLOTS.length],wrap=Math.floor(i/CAFE_SLOTS.length);return[Math.min(74,bx+wrap*7),Math.min(80,by+wrap*4)];}
function ownedCafeRecord(itemId){return state.ownedItems.find(o=>o.id===itemId);}
let cafeDrag=null; const clampNum=(v,a,b)=>Math.max(a,Math.min(b,v)); let cafeMode='play',cafeUndo=null;
function setCafeMode(mode){if(mode==='decorate'&&catState!=='idle')settleCatToRest();cafeMode=mode;catBeatsSinceWander=0;cafeUndo=null;updateCafeModeUI();renderChildCafe();}
function cafeDefaultHint(){return cafeMode==='decorate'?'Drag things to arrange · use the tray to add or store · Undo fixes a mistake':'Tap anywhere to call the cat · bowls, beds, and toys are playable';}
function setCafeHint(message){const hint=el('c-cafe-hint');if(hint)hint.textContent=message||cafeDefaultHint();}
function updateCafeModeUI(){const decorating=cafeMode==='decorate',room=el('c-cafe-room');if(room)room.classList.toggle('decorate',decorating);const screen=document.querySelector('[data-cscreen="cafe"]');if(screen)screen.classList.toggle('decorating',decorating);const decorateBtn=el('c-decorate-btn');if(decorateBtn)decorateBtn.hidden=decorating;const actions=el('c-decorate-actions');if(actions)actions.hidden=!decorating;const tray=el('c-tray');if(tray)tray.hidden=!decorating;updateCafeUndoBtn();setCafeHint();}
function setCafeUndo(u){cafeUndo=u;updateCafeUndoBtn();} function updateCafeUndoBtn(){const b=el('c-undo-btn');if(b)b.disabled=!cafeUndo;}
async function applyCafeUndo(){const u=cafeUndo;if(!u)return;setCafeUndo(null);try{if(u.type==='move')await store.moveCafeItem(state.familyId,u.id,u.x,u.y);else if(u.type==='place')await store.setCafeItemPlaced(state.familyId,u.id,true);else if(u.type==='store')await store.setCafeItemPlaced(state.familyId,u.id,false);toast('Undone.');}catch(_){toast('Could not undo — try again.');}}
function catMood(){const id=state.child.activeCatId,cat=state.cats[id]||{},low=lowestCareNeed(activeCareNeeds(),40);if(low&&low.need==='rest')return{pose:'sleep',cls:'mood-sleepy'};if(low)return{pose:'sit',cls:'mood-calm'};if(cat.evolved)return{pose:null,cls:'mood-happy'};const happyToday=(state.todayCompletions&&state.todayCompletions.length>0)||(cat.bond||0)>=12;return happyToday?{pose:'sit',cls:'mood-happy'}:{pose:'sit',cls:'mood-calm'};}

const careInitPending=new Set();let careSpendPending=false,careLockedView=null;const careFeedbackTimers=new Map();let careClockTimer=null,needGuideTimer=null;
const CARE_META=Object.freeze({hunger:Object.freeze({label:'Hunger',icon:'assets/food-bowl-purple.png',objects:'a food bowl'}),rest:Object.freeze({label:'Rest',icon:'assets/night-routine-icon.png',objects:'a bed, pillow, or house'}),happiness:Object.freeze({label:'Happiness',icon:'assets/yarn-blue.png',objects:'yarn, a toy basket, or the cat tree'})});
function stopCareClock(){clearInterval(careClockTimer);careClockTimer=null;} function startCareClock(){stopCareClock();careClockTimer=setInterval(()=>{const onCafe=document.querySelector('[data-cscreen="cafe"]')?.classList.contains('active');if(state.role==='child'&&onCafe&&!careSpendPending)renderCafeCareStatus();},60000);}
function careBand(value){if(value>=70)return{label:'Thriving',cls:'thriving'};if(value>=40)return{label:'Okay',cls:'okay'};if(value>=15)return{label:'Needs care',cls:'needs-care'};return{label:'Ready for care',cls:'urgent-safe'};}
function activeCareNeeds(){if(!state.child)return needsAt(null);const cat=state.cats[state.child.activeCatId]||{};return needsAt(cat.catNeeds);}
function renderNeedCue(needs){const cue=el('c-need-cue'),icon=el('c-need-cue-icon');if(!cue||!icon||!state.child)return;const lowest=lowestCareNeed(needs,40);cue.hidden=!lowest||cafeMode!=='play';if(!lowest||cafeMode!=='play'){delete cue.dataset.need;return;}const meta=CARE_META[lowest.need],def=CAT_DEFS[state.child.activeCatId];cue.dataset.need=lowest.need;cue.setAttribute('aria-label',`Help ${def.name} with ${meta.label}`);cue.title=`${meta.label} could use care`;icon.src=meta.icon;icon.alt='';}
function renderCafeCareStatus({needsOverride=null,chargesOverride=null}={}){if(!state.child)return;const locked=careSpendPending&&careLockedView?careLockedView:null,needs=needsOverride||(locked?locked.needs:activeCareNeeds()),charges=chargesOverride==null?(locked?locked.charges:careCharges(state.child.careCharges)):careCharges(chargesOverride);el('c-care-charges').textContent=charges;el('c-care-charges').setAttribute('aria-label',`${charges} of ${CARE_CONFIG.chargeCap} Care Charges`);for(const need of CARE_NEEDS){const value=needs[need],rounded=displayNeedValue(value),band=careBand(value),bar=el(`c-${need}-bar`),meterEl=el(`c-${need}-meter`),row=el(`c-${need}-need`);if(!bar||!meterEl||!row)continue;el(`c-${need}-val`).textContent=`${rounded}/100`;el(`c-${need}-band`).textContent=band.label;bar.style.width=`${value}%`;meterEl.setAttribute('aria-valuenow',String(rounded));row.classList.remove('thriving','okay','needs-care','urgent-safe','is-saving');row.classList.add(band.cls);row.classList.toggle('is-saving',careSpendPending);}renderNeedCue(needs);}
function ensureActiveCatCare(catId,cat){const complete=cat.catNeeds&&cat.catNeeds.lastUpdatedAt&&CARE_NEEDS.every(need=>cat.catNeeds[need]!=null&&Number.isFinite(Number(cat.catNeeds[need])));if(!catId||complete||careInitPending.has(catId))return;careInitPending.add(catId);store.ensureCatCare(state.familyId,catId).catch(()=>setTimeout(()=>careInitPending.delete(catId),5000));}

let catTapCount=0,catState='idle',catStateTimer=null,catBeatTimer=null,catBeatsSinceWander=0,catAnimTimer=null,catAnimStopTimer=null,catTargetId=null,catTargetEl=null,catTargetHidden=false;const preloadedCatFrames=new Set();
function stopSpriteAnimation(){clearInterval(catAnimTimer);clearTimeout(catAnimStopTimer);catAnimTimer=null;catAnimStopTimer=null;} function syncCatStateUI(){const wrap=el('c-cafe-cat-wrap');if(wrap)wrap.dataset.catState=catState;}
function releaseCatTarget(){if(catTargetEl)catTargetEl.classList.remove('is-cat-target','is-in-use');document.querySelectorAll('#c-placed .is-cat-target, #c-placed .is-in-use').forEach(node=>node.classList.remove('is-cat-target','is-in-use'));catTargetId=null;catTargetEl=null;catTargetHidden=false;}
function markCatTarget(itemEl,hidden=false){catTargetEl=itemEl||(catTargetId&&document.querySelector(`[data-decor="${catTargetId}"]`));catTargetHidden=hidden;if(!catTargetEl)return;catTargetEl.classList.add('is-cat-target');catTargetEl.classList.toggle('is-in-use',hidden);}
function preloadCatFrames(def){if(!def||!def.frames)return;Object.values(def.frames).flat().forEach(src=>{if(preloadedCatFrames.has(src))return;preloadedCatFrames.add(src);const img=new Image();img.src=src;});}
function cafePoseArt(def,poseKey){if(!def.poses)return def.art;return def.poses[poseKey]||def.poses.sit||def.art;}
function renderChildCafe(){el('c-coins').textContent=state.child.coins||0;const id=state.child.activeCatId,cat=state.cats[id]||{},def=CAT_DEFS[id];renderCafeCareStatus();ensureActiveCatCare(id,cat);el('c-cafe-room').style.backgroundImage=`url("${CAFE_ROOM_ART}")`;preloadCatFrames(def);const mood=catMood(),wrap=el('c-cafe-cat-wrap');if(wrap){wrap.className=`cafe-cat-wrap ${mood.cls}`;wrap.dataset.catState=catState;}if(catState==='idle')el('c-cafe-cat').src=catRestPoseSrc(cat,def);if(!cafeDrag){el('c-placed').innerHTML=state.ownedItems.filter(o=>o.placed!==false).map(o=>{const item=CAFE_ITEMS[o.id];if(!item)return'';const[x,y]=(o.x!=null&&o.y!=null)?[o.x,o.y]:cafeSlot(o.id),selected=o.id===catTargetId,targetClasses=selected?` is-cat-target${catTargetHidden?' is-in-use':''}`:'',actionLabel=item.role==='decor'?`Look at ${item.name}`:`Ask the cat to use ${item.name}`;return`<img class="cafe-decor${targetClasses}" src="${item.art}" alt="${esc(item.name)}" data-decor="${o.id}" style="left:${x}%;top:${y}%" draggable="false" role="button" tabindex="0" aria-label="${esc(actionLabel)}">`;}).join('');if(catTargetId)catTargetEl=el('c-placed').querySelector(`[data-decor="${catTargetId}"]`);}renderCafeTray();el('c-shop').innerHTML=CAFE_ITEM_IDS.map(itemId=>{const item=CAFE_ITEMS[itemId],owned=ownedCafeRecord(itemId),afford=(state.child.coins||0)>=item.price;let btn;if(!owned)btn=`<button data-buy="${item.id}" ${afford?'':'disabled'}>${afford?'Buy':'Need coins'}</button>`;else if(owned.placed!==false)btn=`<button class="ghost-btn" data-putaway="${item.id}">Put away</button>`;else btn=`<button data-place="${item.id}">Place</button>`;return`<div class="shop-item"><img src="${item.art}" alt="${esc(item.name)}"><strong>${esc(item.name)}</strong><small><img class="coin-ico" src="assets/coin.png" alt=""> ${item.price}</small>${btn}</div>`;}).join('');}
function renderCafeTray(){const tray=el('c-tray');if(!tray||cafeMode!=='decorate')return;if(!state.ownedItems.length){tray.innerHTML='<p class="muted">Buy cozy things below, then arrange them up here.</p>';return;}tray.innerHTML=state.ownedItems.map(o=>{const item=CAFE_ITEMS[o.id];if(!item)return'';const placed=o.placed!==false,btn=placed?`<button class="ghost-btn" data-store="${o.id}">Store</button>`:`<button data-place-tray="${o.id}">Place</button>`;return`<div class="tray-item ${placed?'is-placed':''}"><img src="${item.art}" alt="${esc(item.name)}"><small>${esc(item.name)}</small>${btn}</div>`;}).join('');}

function initCafeInteractions(){const room=el('c-cafe-room');if(!room)return;room.addEventListener('pointerdown',e=>{if(cafeMode==='decorate'){const img=e.target.closest('[data-decor]');if(!img)return;e.preventDefault();const rec=ownedCafeRecord(img.dataset.decor),[dx,dy]=cafeSlot(img.dataset.decor);cafeDrag={kind:'decor',id:img.dataset.decor,el:img,rect:room.getBoundingClientRect(),grabX:e.clientX,grabY:e.clientY,moved:false,fromX:(rec&&rec.x!=null)?rec.x:dx,fromY:(rec&&rec.y!=null)?rec.y:dy};img.classList.add('dragging');try{img.setPointerCapture(e.pointerId);}catch(_){}return;}if(cafeMode==='play'){const cat=e.target.closest('#c-cafe-cat');if(!cat)return;e.preventDefault();const wrap=el('c-cafe-cat-wrap'),rr=room.getBoundingClientRect(),wr=wrap.getBoundingClientRect(),currentX=((wr.left-rr.left)/rr.width)*100,currentY=((wr.top-rr.top)/rr.height)*100,interrupted=catState!=='idle';releaseCatTarget();setCafeHint();wrap.style.transition='none';wrap.style.left=currentX+'%';wrap.style.top=currentY+'%';wrap.style.bottom='auto';clearTimeout(catStateTimer);stopSpriteAnimation();const{cat:progress,def}=catCtx();cat.src=catRestPoseSrc(progress,def);catState='dragged';syncCatStateUI();cafeDrag={kind:'cat',el:wrap,catEl:cat,rect:room.getBoundingClientRect(),grabX:e.clientX,grabY:e.clientY,moved:false,startX:currentX,startY:currentY,interrupted};try{cat.setPointerCapture(e.pointerId);}catch(_){}}});room.addEventListener('pointermove',e=>{if(!cafeDrag)return;if(!cafeDrag.moved&&Math.abs(e.clientX-cafeDrag.grabX)+Math.abs(e.clientY-cafeDrag.grabY)>6)cafeDrag.moved=true;if(!cafeDrag.moved)return;const r=cafeDrag.rect;if(cafeDrag.kind==='decor'){const x=clampNum(((e.clientX-r.left)/r.width)*100-13,0,74),y=clampNum(((e.clientY-r.top)/r.height)*100-9.75,0,80.5);cafeDrag.el.style.left=x+'%';cafeDrag.el.style.top=y+'%';cafeDrag.lastX=x;cafeDrag.lastY=y;}else{const x=clampNum(((e.clientX-r.left)/r.width)*100-20,2,58),y=clampNum(((e.clientY-r.top)/r.height)*100-22,12,68);cafeDrag.el.style.left=x+'%';cafeDrag.el.style.top=y+'%';cafeDrag.el.style.bottom='auto';cafeDrag.lastX=x;cafeDrag.lastY=y;}});const endDrag=async e=>{if(!cafeDrag)return;const d=cafeDrag;cafeDrag=null;const round=n=>Math.round(n*10)/10;if(d.kind==='decor'){d.el.classList.remove('dragging');try{d.el.releasePointerCapture(e.pointerId);}catch(_){}if(d.moved&&d.lastX!=null){setCafeUndo({type:'move',id:d.id,x:round(d.fromX),y:round(d.fromY)});try{await store.moveCafeItem(state.familyId,d.id,round(d.lastX),round(d.lastY));}catch(_){toast('Could not save that move.');renderChildCafe();}}return;}d.el.style.transition='';try{d.catEl.releasePointerCapture(e.pointerId);}catch(_){}catState='idle';syncCatStateUI();if(d.moved&&d.lastX!=null){const x=round(d.lastX),y=round(d.lastY);catBeatsSinceWander=0;if(state.child)state.child.cafeCat={x,y};try{await store.moveCafeCat(state.familyId,x,y);}catch(_){toast('Could not save that move.');renderChildCafe();}}else{const behindCat=Number.isFinite(e.clientX)&&Number.isFinite(e.clientY)&&document.elementsFromPoint?firstCafeDecorElement(document.elementsFromPoint(e.clientX,e.clientY)):null;if(d.interrupted&&state.child){const x=round(d.startX),y=round(d.startY);state.child.cafeCat={x,y};store.moveCafeCat(state.familyId,x,y).catch(()=>{});}if(behindCat)return activateCafeItem(behindCat);reactCat(e);}};room.addEventListener('pointerup',endDrag);room.addEventListener('pointercancel',endDrag);room.addEventListener('click',e=>{if(cafeMode!=='play')return;const itemEl=e.target.closest('[data-decor]');if(itemEl)return activateCafeItem(itemEl);if(e.target.closest('#c-cafe-cat-wrap, .fx-sprite'))return;moveCatToRoomTap(e);});room.addEventListener('keydown',e=>{if(cafeMode!=='play'||(e.key!=='Enter'&&e.key!==' '))return;const itemEl=e.target.closest('[data-decor]');if(!itemEl)return;e.preventDefault();activateCafeItem(itemEl);});}
function catRestPoseSrc(cat,def){const m=catMood();return cat.evolved?def.heroArt:cafePoseArt(def,m.pose||'sit');} function catCtx(){const id=state.child.activeCatId;return{cat:state.cats[id]||{},def:CAT_DEFS[id],catEl:el('c-cafe-cat'),wrap:el('c-cafe-cat-wrap')};}
function settleCatToRest(){const{cat,def,catEl,wrap}=catCtx();clearTimeout(catStateTimer);catStateTimer=null;stopSpriteAnimation();if(catEl)catEl.src=catRestPoseSrc(cat,def);if(wrap)wrap.style.transition='';catState='idle';syncCatStateUI();releaseCatTarget();setCafeHint();}
function catTransient(next,ms,onEnd){clearTimeout(catStateTimer);stopSpriteAnimation();catState=next;syncCatStateUI();catStateTimer=ms==null?null:setTimeout(onEnd||settleCatToRest,ms);} function playSprite(poseKey,{fps=3,holdMs=0,heroAction=false}={}){const{cat,def,catEl}=catCtx();stopSpriteAnimation();if(!catEl||!def)return;const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches,frames=(!cat.evolved||heroAction)&&def.frames&&def.frames[poseKey],still=cat.evolved&&!heroAction?def.heroArt:(frames&&frames[0])||cafePoseArt(def,poseKey);if(!frames||frames.length<2||reduce){catEl.src=still;return;}let i=0;catEl.src=frames[0];catAnimTimer=setInterval(()=>{i=(i+1)%frames.length;catEl.src=frames[i];},Math.round(1000/fps));if(holdMs)catAnimStopTimer=setTimeout(stopSpriteAnimation,holdMs);}
function pulseCafeItem(itemEl,item){itemEl.classList.remove('wiggle');void itemEl.offsetWidth;itemEl.classList.add('wiggle');if(item&&item.role==='decor')toast(`${item.name} looks cozy here.`);} function actionHidesTarget(item){return item.role==='food'||(item.role==='play'&&(item.id==='rug'||item.id==='pinkYarn'));}
function cafeActionHint(item,catName){if(item.role==='food')return`${catName} is eating.`;if(item.role==='water')return`${catName} is getting a drink.`;if(item.role==='rest')return`${catName} is sleeping · tap the cat or another object to wake up`;return`${catName} is playing!`;}
function clearNeedGuides(){clearTimeout(needGuideTimer);document.querySelectorAll('.need-guide').forEach(node=>node.classList.remove('need-guide'));} function holdNeedGuide(node){if(!node)return;node.classList.remove('need-guide');void node.offsetWidth;node.classList.add('need-guide');needGuideTimer=setTimeout(()=>node.classList.remove('need-guide'),2800);}
function guideCareNeed(need){const meta=CARE_META[need],def=state.child&&CAT_DEFS[state.child.activeCatId];if(!meta||!def)return;clearNeedGuides();const placed=Array.from(document.querySelectorAll('#c-placed [data-decor]')).find(node=>CAFE_ITEMS[node.dataset.decor]?.need===need);if(placed){holdNeedGuide(placed);setCafeHint(`Tap the highlighted ${CAFE_ITEMS[placed.dataset.decor].name} to help ${def.name}'s ${meta.label}.`);return;}const stored=state.ownedItems.find(record=>record.placed===false&&CAFE_ITEMS[record.id]?.need===need);if(stored){setCafeMode('decorate');const trayCard=document.querySelector(`[data-place-tray="${stored.id}"]`)?.closest('.tray-item');holdNeedGuide(trayCard);setCafeHint(`Place the highlighted ${CAFE_ITEMS[stored.id].name}, then tap Done to use it.`);return;}setCafeHint(`${def.name}'s ${meta.label} can be helped with ${meta.objects}.`);toast(`Place or buy ${meta.objects} to help ${meta.label}.`);}
function showCareDelta(need,text,tone='gain'){const delta=el(`c-${need}-delta`);if(!delta)return;clearTimeout(careFeedbackTimers.get(need));delta.textContent=text;delta.classList.remove('show','cost');delta.classList.toggle('cost',tone==='cost');void delta.offsetWidth;delta.classList.add('show');careFeedbackTimers.set(need,setTimeout(()=>{delta.classList.remove('show','cost');delta.textContent='';},1800));}
function showCareRefill(result,destination){renderCafeCareStatus({needsOverride:result.needsBefore,chargesOverride:result.chargesBefore});requestAnimationFrame(()=>renderCafeCareStatus({needsOverride:result.needsAfter,chargesOverride:result.chargesAfter}));showCareDelta(result.need,`+${result.refill}`);if(result.restCost>0)showCareDelta('rest',`−${result.restCost}`,'cost');}
async function resolveCafeCare(item,destination){if(!item.need||!CARE_META[item.need]||careSpendPending)return;const need=item.need,meta=CARE_META[need],catId=state.child.activeCatId,def=CAT_DEFS[catId],needsBefore=activeCareNeeds(),before=needsBefore[need],chargesBefore=careCharges(state.child.careCharges);if(isNeedFull(before)){setCafeHint(`${def.name}'s ${meta.label} is full · no Care Charge used`);toast(`${meta.label} is full — your Care Charge is safe.`);return;}if(chargesBefore<1){toast('Complete a quest to earn a Care Charge.');return;}careSpendPending=true;careLockedView={needs:needsBefore,charges:chargesBefore};renderCafeCareStatus();try{const result=await store.spendCare(state.familyId,catId,need);if(state.child)state.child.careCharges=result.chargesAfter;const cat=state.cats[catId]||{};state.cats[catId]={...cat,catNeeds:{...(cat.catNeeds||{}),...result.needsAfter,lastUpdatedAt:Date.now()}};careSpendPending=false;careLockedView=null;if(state.child.activeCatId===catId){showCareRefill(result,destination);setCafeHint(`${def.name}'s ${meta.label} rose by ${result.refill}.`);}}catch(err){careSpendPending=false;careLockedView=null;renderCafeCareStatus();toast(err.message==='no-care-charges'?'No Care Charges right now.':'Care did not save — your charge is still safe.');}}
function beginCafeObjectAction(item,destination){if(catState!=='approach'||catTargetId!==item.id)return;const action=cafeActionFor(item);if(!action)return settleCatToRest();const{def,wrap}=catCtx();if(wrap)wrap.style.transition='';markCatTarget(el('c-placed').querySelector(`[data-decor="${item.id}"]`)||catTargetEl,actionHidesTarget(item));const x=Math.round(destination.x*10)/10,y=Math.round(destination.y*10)/10;if(state.child)state.child.cafeCat={x,y};store.moveCafeCat(state.familyId,x,y).catch(()=>{});catTransient(action.state,action.durationMs);playSprite(action.pose,{fps:action.state==='sleep'?2:3,holdMs:action.durationMs||0,heroAction:true});setCafeHint(cafeActionHint(item,def.name));resolveCafeCare(item,destination);}
function activateCafeItem(itemEl){const item=CAFE_ITEMS[itemEl.dataset.decor];if(!item)return;pulseCafeItem(itemEl,item);const action=cafeActionFor(item);if(!action)return;if(catTargetId===item.id&&catState!=='idle')return;const room=el('c-cafe-room'),{def,wrap}=catCtx();if(!room||!wrap||!def)return;releaseCatTarget();catTargetId=item.id;markCatTarget(itemEl);const rr=room.getBoundingClientRect(),ir=itemEl.getBoundingClientRect(),wr=wrap.getBoundingClientRect(),from={x:((wr.left-rr.left)/rr.width)*100,y:((wr.top-rr.top)/rr.height)*100},destination=catDestinationForObject({role:item.role,itemLeft:((ir.left-rr.left)/rr.width)*100,itemTop:((ir.top-rr.top)/rr.height)*100,itemWidth:(ir.width/rr.width)*100}),reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches,travelMs=catWalkDuration(from,destination,reduce);wrap.style.transition='none';wrap.style.left=from.x+'%';wrap.style.top=from.y+'%';wrap.style.bottom='auto';void wrap.offsetWidth;catTransient('approach',travelMs,()=>beginCafeObjectAction(item,destination));playSprite('walk',{fps:4,heroAction:true});setCafeHint(`${def.name} is walking to ${item.name}…`);if(travelMs===0){wrap.style.left=destination.x+'%';wrap.style.top=destination.y+'%';}else{wrap.style.transition=`left ${travelMs}ms linear, top ${travelMs}ms linear`;requestAnimationFrame(()=>{if(catState!=='approach'||catTargetId!==item.id)return;wrap.style.left=destination.x+'%';wrap.style.top=destination.y+'%';});}}
function moveCatToRoomTap(e){const room=el('c-cafe-room'),{def,wrap}=catCtx();if(!room||!wrap||!def)return;const rr=room.getBoundingClientRect(),wr=wrap.getBoundingClientRect(),from={x:((wr.left-rr.left)/rr.width)*100,y:((wr.top-rr.top)/rr.height)*100},destination=catDestinationForTap({tapX:((e.clientX-rr.left)/rr.width)*100,tapY:((e.clientY-rr.top)/rr.height)*100}),reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches,travelMs=catWalkDuration(from,destination,reduce);releaseCatTarget();wrap.style.transition='none';wrap.style.left=from.x+'%';wrap.style.top=from.y+'%';wrap.style.bottom='auto';void wrap.offsetWidth;const arrive=()=>{if(catState!=='approach'||catTargetId!==null)return;const x=Math.round(destination.x*10)/10,y=Math.round(destination.y*10)/10;if(state.child)state.child.cafeCat={x,y};store.moveCafeCat(state.familyId,x,y).catch(()=>{});settleCatToRest();};catTransient('approach',travelMs,arrive);playSprite('walk',{fps:4,heroAction:true});setCafeHint(`${def.name} is walking over…`);if(travelMs===0){wrap.style.left=destination.x+'%';wrap.style.top=destination.y+'%';arrive();}else{wrap.style.transition=`left ${travelMs}ms linear, top ${travelMs}ms linear`;requestAnimationFrame(()=>{if(catState!=='approach'||catTargetId!==null)return;wrap.style.left=destination.x+'%';wrap.style.top=destination.y+'%';});}}
function reactCat(e){const{cat,def,catEl}=catCtx();catTapCount++;const anim=(catTapCount%2)?'react':'react-wiggle';catEl.classList.remove('react','react-wiggle');void catEl.offsetWidth;catEl.classList.add(anim);if(navigator.vibrate){try{navigator.vibrate(8);}catch(_){}}if(!cat.evolved&&def.poses){catTransient('react',2600);playSprite((catTapCount%2)?'play':'celebrate');}else catTransient('react',1600);}
function catPlayBeat(){const{cat,def}=catCtx();if(cat.evolved||!def.poses)return catHop();catTransient('glance',1200);playSprite('play');} function catHop(){const{catEl}=catCtx();catTransient('glance',600);catEl.classList.remove('react');void catEl.offsetWidth;catEl.classList.add('react');} function catWiggle(){const{catEl}=catCtx();catTransient('glance',600);catEl.classList.remove('react-wiggle');void catEl.offsetWidth;catEl.classList.add('react-wiggle');} function catBlink(){const{cat,def,catEl}=catCtx(),idle=!cat.evolved&&def.frames&&def.frames.idle;if(!idle||idle.length<2)return catWiggle();catTransient('glance',180);catEl.src=idle[1];}
function catWander(){return false;} function catIdleBeat(){const onCafe=state.role==='child'&&state.child&&document.querySelector('[data-cscreen="cafe"]')?.classList.contains('active');if(onCafe&&!cafeDrag&&cafeMode==='play'&&catState==='idle'){const roll=Math.random();if(roll<.5)catBlink();else catWiggle();}scheduleCatBeat();} function scheduleCatBeat(){clearTimeout(catBeatTimer);catBeatTimer=setTimeout(catIdleBeat,7000+Math.random()*4000);} function catWelcomeBack(){if(!state.child)return;clearTimeout(catStateTimer);const wrap=el('c-cafe-cat-wrap'),pos=state.child.cafeCat;if(wrap&&pos&&pos.x!=null){wrap.style.left=pos.x+'%';wrap.style.top=pos.y+'%';wrap.style.bottom='auto';}settleCatToRest();}
function spawnFx(src,container,{count=1,cx=50,cy=50,spread=20,size=42,life=1150,mode='rise'}={}){if(!container)return;for(let i=0;i<count;i++){const s=document.createElement('img');s.src=src;s.alt='';s.className=`fx-sprite fx-${mode}`;s.style.left=(cx+(Math.random()*2-1)*spread)+'%';s.style.top=(cy+(Math.random()*2-1)*spread*.4)+'%';s.style.width=size+'px';container.appendChild(s);setTimeout(()=>s.remove(),life+i*70);}}
function confettiBurst(){const layer=document.createElement('div');layer.className='fx-layer';document.body.appendChild(layer);spawnFx('assets/fx-confetti.png',layer,{count:12,cx:50,cy:6,spread:46,size:34,life:1500,mode:'fall'});setTimeout(()=>layer.remove(),1900);}

// ---- Events -----------------------------------------------------------------
function bindEvents() {
  document.addEventListener('click', async (e) => {
    const role=e.target.closest('[data-choose-role]');if(role)return chooseRole(role.dataset.chooseRole);
    const pgo=e.target.closest('[data-pgo]');if(pgo)return navParent(pgo.dataset.pgo);
    const cgo=e.target.closest('[data-cgo]');if(cgo)return navChild(cgo.dataset.cgo);
    const needCue=e.target.closest('#c-need-cue');if(needCue&&needCue.dataset.need){guideCareNeed(needCue.dataset.need);return;}
    const fbProgress=e.target.closest('[data-fb-progress]');if(fbProgress){dismissFeedbackCard(fbProgress.closest('.feedback-card'));navChild('log');return;}
    const fbDismiss=e.target.closest('[data-fb-dismiss]');if(fbDismiss){dismissFeedbackCard(fbDismiss.closest('.feedback-card'));return;}
    const historyMode=e.target.closest('[data-history-mode]');if(historyMode){setHistoryMode(historyMode.dataset.historyMode);return;}
    if(e.target.closest('[data-week-current]')){setWeekAnchor(startOfWeek(localDate()));return;}
    if(e.target.closest('[data-day-prev]')){setSelectedDate(addDays(state.selectedDate,-1));return;}if(e.target.closest('[data-day-next]')){setSelectedDate(addDays(state.selectedDate,1));return;}if(e.target.closest('[data-day-today]')){setSelectedDate(localDate(),{reanchor:true});return;}if(e.target.closest('[data-week-prev]')){setWeekAnchor(addDays(state.weekAnchor,-7));return;}if(e.target.closest('[data-week-next]')){setWeekAnchor(addDays(state.weekAnchor,7));return;}
    const pick=e.target.closest('[data-day-pick]');if(pick){setSelectedDate(pick.dataset.dayPick);return;}const filter=e.target.closest('[data-day-filter]');if(filter){setDayFilter(filter.dataset.dayFilter);return;}const toggle=e.target.closest('[data-txn-toggle]');if(toggle){state.expandedTxn=state.expandedTxn===toggle.dataset.txnToggle?null:toggle.dataset.txnToggle;renderDayViews();return;}
    const completedToggle=e.target.closest('[data-toggle-completed]');if(completedToggle){e.preventDefault();state.completedOpen=!state.completedOpen;renderChildQuests();return;}const focusOn=e.target.closest('[data-focus]');if(focusOn){state.focusQuestId=focusOn.dataset.focus;renderChildQuests();return;}if(e.target.closest('[data-focus-exit]')){state.focusQuestId=null;renderChildQuests();return;}
    const stillToggle=e.target.closest('[data-toggle-still]');if(stillToggle){e.preventDefault();const w=stillToggle.dataset.toggleStill;if(state.stillOpen.has(w))state.stillOpen.delete(w);else state.stillOpen.add(w);renderChildQuests();return;}if(e.target.closest('[data-toggle-anytime]')){e.preventDefault();state.anytimeExpanded=!state.anytimeExpanded;renderChildQuests();return;}
    const quick=e.target.closest('[data-quick]');if(quick){const note=el('point-note').value.trim();try{await store.adjustPoints(state.familyId,state.uid,{reasonCode:quick.dataset.quick,note});const a=QUICK_ACTIONS.find(x=>x.code===quick.dataset.quick);el('point-note').value='';toast(`${a.amount>0?'+':''}${a.amount} · ${a.label}`);}catch(_){toast('Could not save — check connection.');}return;}
    const train=e.target.closest('[data-train]');if(train){await store.setActiveCat(state.familyId,train.dataset.train);toast(`${CAT_DEFS[train.dataset.train].name} is now training.`);return;}const complete=e.target.closest('[data-complete]');if(complete){await handleComplete(complete.dataset.complete);return;}
    const sirusDone=e.target.closest('[data-sirus-done]');if(sirusDone){const q=state.quests.find(x=>x.id===sirusDone.dataset.sirusDone);if(!q)return;if(!completionStatus(q.id)&&!confirm(`Mark “${q.title}” done for Sirus? He’ll get the reward now.`))return;try{await store.parentCompleteQuest(state.familyId,state.uid,q.id);toast('Marked done ⭐');}catch(_){toast('Could not mark done — try again.');}return;}
    const buy=e.target.closest('[data-buy]');if(buy){try{await store.purchaseCafeItem(state.familyId,state.uid,buy.dataset.buy);toast('Added to the café!');}catch(err){toast(err.message==='not-enough-coins'?'Not enough coins yet.':'Could not buy that.');}return;}if(e.target.closest('#c-decorate-btn'))return setCafeMode('decorate');if(e.target.closest('#c-done-btn'))return setCafeMode('play');if(e.target.closest('#c-undo-btn'))return applyCafeUndo();
    const putaway=e.target.closest('[data-putaway]');if(putaway){try{await store.setCafeItemPlaced(state.familyId,putaway.dataset.putaway,false);toast('Put away.');}catch(_){toast('Could not update the café.');}return;}const place=e.target.closest('[data-place]');if(place){try{await store.setCafeItemPlaced(state.familyId,place.dataset.place,true);toast('Placed!');}catch(_){toast('Could not update the café.');}return;}
    const delTxn=e.target.closest('[data-del-txn]');if(delTxn){if(state.role!=='parent')return;const t=state.recentTxns.find(x=>x.id===delTxn.dataset.delTxn);if(t&&confirm('Delete this entry? Its points will be reversed.')){try{await store.deleteTransaction(state.familyId,state.uid,t);toast('Entry deleted.');}catch(_){toast('Could not delete — try again.');}}return;}
    const edit=e.target.closest('[data-edit-quest]');if(edit)return openQuestDialog(edit.dataset.editQuest);const del=e.target.closest('[data-del-quest]');if(del){if(confirm('Delete this quest?')){await store.deleteQuest(state.familyId,del.dataset.delQuest);toast('Quest deleted.');}return;}const toggleQ=e.target.closest('[data-toggle-quest]');if(toggleQ){const q=state.quests.find(x=>x.id===toggleQ.dataset.toggleQuest);if(!q)return;const next=q.enabled===false;try{await store.setQuestEnabled(state.familyId,q.id,next);toast(next?'Task on for Sirus.':'🔒 Task locked off.');}catch(_){toast('Could not update — try again.');}return;}
    const approve=e.target.closest('[data-approve]');if(approve){const c=state.pendingApprovals.find(x=>x.id===approve.dataset.approve);if(!c)return;try{await store.approveCompletion(state.familyId,state.uid,c);toast('Approved! ⭐');}catch(_){toast('Could not approve — try again.');}return;}const reject=e.target.closest('[data-reject]');if(reject){const c=state.pendingApprovals.find(x=>x.id===reject.dataset.reject);if(!c)return;const title=c.questTitle||'this quest';if(confirm(`Reject “${title}”? The points disappear and the quest is given back to Sirus to do again.`)){try{await store.rejectCompletion(state.familyId,state.uid,c);toast('Sent back to Sirus.');}catch(_){toast('Could not reject — try again.');}}return;}
    if(e.target.closest('#add-quest-btn'))return openQuestDialog(null);if(e.target.closest('#undo-btn')){const last=state.recentTxns[0];if(!last)return toast('Nothing to undo.');try{await store.undoLast(state.familyId,state.uid,last);toast('Undone.');}catch(_){toast('Undo failed — try again.');}return;}
    if(e.target.closest('#redeem-btn')){const avail=state.child.available||0;el('redeem-available').textContent=avail;const input=el('redeem-minutes');input.value='';input.max=String(avail);el('redeem-note').value='';const err=el('redeem-error');err.hidden=true;err.textContent='';el('redeem-dialog').showModal();return;}
    if(e.target.closest('#make-code-btn'))return makePairingCode();if(e.target.closest('#make-coparent-code-btn'))return makeCoparentCode();if(e.target.closest('#signout-btn')){await signOutUser();location.reload();return;}if(e.target.closest('#evo-close'))return el('evolution-dialog').close();
  });
  document.addEventListener('change',e=>{const cal=e.target.closest('.day-calendar');if(cal&&cal.value)setSelectedDate(cal.value);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)processFeedback();});
  document.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const toggle=e.target.closest('[data-txn-toggle]');if(!toggle)return;e.preventDefault();state.expandedTxn=state.expandedTxn===toggle.dataset.txnToggle?null:toggle.dataset.txnToggle;renderDayViews();});
  el('signin-form').addEventListener('submit',async e=>{e.preventDefault();el('signin-note').textContent='Signing in…';try{const user=await parentSignIn(el('signin-email').value.trim(),el('signin-password').value);await store.setupFamily(user.uid,{parentName:'Mom'});rememberDeviceRole('parent',user.uid,'Mom',user.uid);await enterParent(user.uid,user,'Mom');}catch(err){el('signin-note').textContent=friendlyAuthError(err);}});
  el('coparent-form').addEventListener('submit',async e=>{e.preventDefault();el('coparent-note').textContent='Signing in…';try{const user=await parentSignIn(el('coparent-email').value.trim(),el('coparent-password').value);let fid=(deviceRole()==='parent'&&deviceUid()===user.uid&&deviceFamilyId())?deviceFamilyId():null;if(!fid){const code=el('coparent-code').value.trim();if(!code){el('coparent-note').textContent='Ask Mom for an invite code (needed the first time).';return;}fid=await store.joinFamilyAsParent(user.uid,code,'Abba');}rememberDeviceRole('parent',fid,'Abba',user.uid);await enterParent(fid,user,'Abba');}catch(err){el('coparent-note').textContent=err&&err.code?friendlyAuthError(err):(err&&err.message)||'Could not sign in.';}});
  el('pair-form').addEventListener('submit',async e=>{e.preventDefault();try{const user=await signInChildDevice(),fid=await store.joinWithPairingCode(user.uid,el('pair-code').value.trim());rememberDeviceRole('child',fid);enterChild(fid,user.uid);}catch(err){el('pair-note').textContent=err.message;}});
  el('redeem-confirm').addEventListener('click',async e=>{const mins=Number(el('redeem-minutes').value)||0,note=el('redeem-note').value.trim(),avail=(state.child&&state.child.available)||0,err=el('redeem-error');if(mins<=0){e.preventDefault();err.textContent='Enter how many minutes were used.';err.hidden=false;return;}if(mins>avail){e.preventDefault();err.textContent=`Only ${avail} minutes are available right now.`;err.hidden=false;return;}try{await store.redeemScreenTime(state.familyId,state.uid,mins,{note});toast(`Recorded ${mins} min used.`);}catch(ex){e.preventDefault();err.textContent=`Only ${typeof ex.available==='number'?ex.available:avail} minutes are available right now.`;err.hidden=false;}});
  el('custom-form').addEventListener('submit',async e=>{e.preventDefault();const amount=Number(el('custom-amount').value)||0,reason=el('point-note').value.trim()||'Custom adjustment';if(!amount)return;try{await store.adjustPoints(state.familyId,state.uid,{amount,reasonLabel:reason});toast(`${amount>0?'+':''}${amount} · ${reason}`);el('point-note').value='';}catch(_){toast('Could not save — check connection.');}});
  el('quest-save').addEventListener('click',saveQuestFromDialog);
  el('q-recurrence').addEventListener('change',syncQuestDaysRow);
  initCafeInteractions();
}

async function handleComplete(questId){try{const result=await store.completeQuest(state.familyId,state.uid,questId);confettiBurst();if(navigator.vibrate){try{navigator.vibrate(12);}catch(_){}}toast(result&&result.careChargeGranted?'Nice one! +1 Care Charge · Sent to Mom':'Nice one! Care Charges are full · Sent to Mom');}catch(err){toast(err.message==='already-completed'?'Already done today!':'Could not complete — check connection.');}}

let editingQuestId=null;
function syncQuestDaysRow(){const type=el('q-recurrence').value;el('q-days-row').hidden=type!=='selected_days';el('q-date-row').hidden=type!=='one_time';}
function openQuestDialog(id){editingQuestId=id;const q=id?state.quests.find(x=>x.id===id):null;el('quest-dialog-title').textContent=id?'Edit quest':'Add quest';el('q-title').value=q?q.title:'';el('q-section').value=q?q.section:'Morning';el('q-window').value=q?questTimeWindow(q):'morning';el('q-essential').checked=q?questIsDailyEssential(q):false;const rec=q?questRecurrence(q):{type:'everyday'};el('q-recurrence').value=rec.type;el('q-one-time-date').value=rec.type==='one_time'&&rec.date?rec.date:localDate();const days=new Set(rec.type==='selected_days'&&Array.isArray(rec.days)?rec.days:[]);document.querySelectorAll('.q-day').forEach(cb=>{cb.checked=days.has(cb.value);});syncQuestDaysRow();el('q-points').value=q?q.points:1;el('q-brain').value=q?q.brain:0;el('q-energy').value=q?q.energy:1;el('q-coins').value=q?q.coins:1;el('q-enabled').checked=q?q.enabled!==false:true;el('quest-dialog').showModal();}
function recurrenceFromDialog(){const type=el('q-recurrence').value;if(type==='one_time')return{type:'one_time',date:el('q-one-time-date').value||localDate()};if(type!=='selected_days')return{type};const days=[...document.querySelectorAll('.q-day')].filter(cb=>cb.checked).map(cb=>cb.value);return days.length?{type:'selected_days',days}:{type:'everyday'};}
async function saveQuestFromDialog(){const title=el('q-title').value.trim();if(!title)return;const existing=editingQuestId?state.quests.find(x=>x.id===editingQuestId):null,timeWindow=el('q-window').value;const quest={...(existing||{}),id:editingQuestId||`q-${Date.now()}`,title,section:el('q-section').value,points:Number(el('q-points').value)||0,brain:Math.max(0,Number(el('q-brain').value)||0),energy:Math.max(0,Number(el('q-energy').value)||0),coins:Math.max(0,Number(el('q-coins').value)||0),enabled:el('q-enabled').checked,order:existing?existing.order:state.quests.length,timeWindow,routineId:timeWindow,isDailyEssential:el('q-essential').checked,recurrence:recurrenceFromDialog()};await store.saveQuest(state.familyId,quest);toast(editingQuestId?'Quest updated.':'Quest added.');}
async function makePairingCode(){const code=await store.createPairingCode(state.familyId),disp=el('pair-code-display');disp.hidden=false;disp.textContent=code;toast('Enter this code on the tablet.');} async function makeCoparentCode(){const code=await store.createParentInviteCode(state.familyId),disp=el('coparent-code-display');disp.hidden=false;disp.textContent=code;toast('Give this code to Abba.');}
function chooseRole(choice){if(choice==='back')return showGateScreen('gate');el('gate-note').textContent='';if(choice==='parent')return showGateScreen('parent-signin');if(choice==='coparent')return showGateScreen('coparent-signin');showGateScreen('child-pair');}
async function boot(){if(!isConfigured){el('gate-note').textContent='Setup not finished yet.';return;}bindEvents();await onAuth(async user=>{if(!user){showGateScreen('gate');return;}if(user.isAnonymous){const fid=deviceFamilyId();if(fid&&deviceRole()==='child')enterChild(fid,user.uid);return;}const fid=deviceFamilyId(),rememberedUid=deviceUid(),sameAccount=!rememberedUid||rememberedUid===user.uid;if(deviceRole()==='parent'&&fid&&sameAccount){try{if(fid===user.uid)await store.setupFamily(user.uid,{parentName:'Mom'});rememberDeviceRole('parent',fid,deviceParentName(),user.uid);await enterParent(fid,user,deviceParentName());}catch(err){console.error('Parent enter failed',err);el('signin-note').textContent='Sign-in error: '+(err&&err.message||err);}}});}
boot();
