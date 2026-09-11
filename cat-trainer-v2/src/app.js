// Cat Trainer — app orchestrator. Wires auth + role gate to the synced store and
// renders Mom's dashboard and Sirus's game screens from live data.

import { isConfigured } from './firebase.js?v=03696e99';
import {
  parentSignIn, friendlyAuthError, signInChildDevice,
  onAuth, signOutUser, rememberDeviceRole, deviceRole, deviceFamilyId, deviceParentName, deviceUid
} from './auth.js?v=03696e99';
import * as store from './store.js?v=03696e99';
import { CAT_DEFS } from './data/cats.js?v=03696e99';
import { SECTIONS, SECTION_META } from './data/quests.js?v=03696e99';
import { CAFE_ITEMS, CAFE_ROOM_ART } from './data/cafe-items.js?v=03696e99';
import {
  cafeActionFor, catDestinationForObject, catDestinationForTap,
  catWanderDestination, firstCafeDecorElement, catWalkDuration
} from './cafe-interactions.js?v=03696e99';
import {
  CARE_CONFIG, CARE_NEEDS, careCharges, displayNeedValue, isNeedFull,
  lowestCareNeed, needsAt
} from './care.js?v=03696e99';
import {
  QUICK_ACTIONS, HERO_THRESHOLD, HERO_CARE_REQUIRED_DAYS, QUEST_BOND, heroCareDays
} from './shared/rewards.js?v=03696e99';
import {
  CATEGORY, normalizeTransaction, summarizeDay, summarizeWeek, correctedOriginalIds
} from './shared/ledger.js?v=03696e99';
import {
  localDate, localTimeLabel, addDays, startOfWeek, weekDates, isAfterDate, sameWeek,
  longDateLabel, shortWeekday, dayOfMonth
} from './shared/dates.js?v=03696e99';
import {
  partitionFeedback, bundleRecognitions, QUEST_RETURN_PRESETS, returnedQuestLine
} from './shared/feedback.js?v=03696e99';
import { PAIRING_TTL_MINUTES } from './shared/pairing.js?v=03696e99';
import {
  organizeDay, nextMissions, minutesAvailable, progressCounts, phaseNow, planDay,
  questTimeWindow, questIsDailyEssential, questIsAvailable, questIsArchived,
  questRecurrence, laterWindowFor,
  WINDOW_LABEL, WINDOW_GLYPH
} from './shared/routines.js?v=03696e99';
import {
  questManagementGroups, recurrenceLabel, reorderQuestUpdates
} from './shared/quest-management.js?v=03696e99';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));

const state = {
  role: null, familyId: null, uid: null,
  child: null, cats: {}, quests: [], ownedItems: [], todayCompletions: [], recentTxns: [],
  pendingApprovals: [], prevEvolved: {}, prevCompletions: {}, unsub: null,
  members: {},
  // Day-based ledger view (shared by My Progress and the parent Point Ledger).
  selectedDate: localDate(),      // the activity day being viewed
  weekAnchor: startOfWeek(localDate()), // Sunday of the visible 7-day strip
  dayFilter: 'all',               // all | earned | used | room_to_grow | correction
  historyMode: 'day',              // day | week (§14)
  selectedDayTxns: [],            // raw rows for selectedDate (unioned query)
  weekActivity: new Set(),        // dates in the visible range that have activity
  weekTxns: [],                    // raw rows for the visible weekly reflection
  expandedTxn: null,              // id of the row expanded for detail
  completedOpen: false,           // is the child's "Completed today" drawer open
  focusQuestId: null,             // Focus Mode: the one quest Sirus is on (§8)
  stillOpen: new Set(),           // window keys of expanded "still needs doing" groups
  anytimeExpanded: false,         // Anytime "See all" toggle
  dayOverrides: {},               // today's per-quest overrides (skip/move/next) by questId
  questTab: 'today',              // parent Quest portal sub-tab: today | routines | log
  approveSel: new Set(),          // parent Today: batch-approval selection (completion ids)
  questSelection: new Set(),      // parent Routines: conservative bulk edit selection
  feedbackEvents: [],             // unseen family-feedback events (child only)
  clientId: null                  // stable per-install id for the claim lease
};

// Selected-day + week-activity subscriptions live outside the main snapshot fan-
// out so navigating dates only re-listens to what changed (§12).
let daySubUnsub = null, weekSubUnsub = null, weekTxnUnsub = null, daySubToken = 0, weekSubToken = 0, weekTxnToken = 0;
// Date-scoped "today" reads (completions + overrides) + the midnight-rollover
// watcher, so the day resets without a reload. todaySubDate is the day the
// current listeners are bound to; the token guards a slow snapshot after a re-point.
let todaySubUnsub = null, todaySubDate = null, todaySubToken = 0, dayWatchTimer = null;
// Family-feedback delivery: one shared subscription + a re-entrancy guard so only
// one card shows at a time (§7.0).
let feedbackUnsub = null, feedbackShowing = false;
let returningCompletionId = null;

// Reduced-motion is honored everywhere the celebration animates (§7.4).
const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A stable per-install id (not the coarse phone/tablet label) so the claim lease
// can tell "this device already holds it" from "another device does" (§11).
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
// Parent Quest portal sub-tabs (§17.1: Today · Routines · Log). Today opens by
// default; routine configuration lives one level deeper. Pure DOM toggle — the
// panels are always in the tree, so switching never re-subscribes or re-renders.
function navQuestTab(name) {
  state.questTab = name;
  document.querySelectorAll('[data-qpanel]').forEach(p => { p.hidden = p.dataset.qpanel !== name; });
  document.querySelectorAll('[data-qtab]').forEach(b => {
    const on = b.dataset.qtab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  window.scrollTo(0, 0);
}
function navChild(name) {
  document.querySelectorAll('[data-cscreen]').forEach(s => s.classList.toggle('active', s.dataset.cscreen === name));
  document.querySelectorAll('[data-cgo]').forEach(b => b.classList.toggle('active', b.dataset.cgo === name));
  // In particular, end an indefinite bed nap when the café is no longer on
  // screen so its frame timer cannot keep running behind Quests/Cats/Log.
  if (name !== 'cafe' && catState !== 'idle') settleCatToRest();
  // Leaving the café always drops back to Play mode (never reopen mid-arrange).
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
  // Which family this session is actually in. Mostly invisible day to day, but
  // it is how a browser-agent test proves it is in the throwaway QA family and
  // not the real one before it touches anything (see QA-TESTING.md).
  const famEl = el('settings-family-id');
  if (famEl) famEl.textContent = familyId;
  // Skip re-subscribing if we're already in this exact family (avoids a double
  // subscribe when both a form and the auth listener route the same sign-in).
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
  // The child owns delivery of the one shared family-feedback queue (§0.2).
  if (feedbackUnsub) feedbackUnsub();
  feedbackUnsub = await store.subscribeFeedback(familyId, store.CHILD_ID, evs => {
    state.feedbackEvents = evs;
    processFeedback();
  });
  startCareClock();
  scheduleCatBeat(); // the café cat ambles/glances on its own while Sirus watches
}

async function subscribeAll() {
  if (state.unsub) state.unsub();
  state.unsub = await store.subscribe(state.familyId, {
    onChild: (c) => { state.child = c; renderAll(); },
    onCats: (c) => { detectEvolution(c); state.cats = c; renderAll(); },
    onQuests: (q) => { state.quests = q; renderAll(); },
    onOwnedItems: (o) => { state.ownedItems = o; renderAll(); },
    onPendingApprovals: (p) => { state.pendingApprovals = p; renderAll(); },
    onRecentTxns: (t) => { state.recentTxns = t; renderAll(); },
    onMembers: (m) => { state.members = m; renderAll(); }
  });
  // Today's completions + overrides are date-scoped; point them at the current
  // local day and start the rollover watcher so they re-point at midnight.
  await subscribeTodayScoped();
  startDayWatch();
  // The day view always opens on Today (§6.2).
  setSelectedDate(localDate(), { reanchor: true });
}

// The date-scoped "today" reads (completions + overrides). Re-pointed whenever
// the local day rolls over so yesterday's completions/exceptions stop shaping
// the new day even if the app was never reloaded (the Slice 2 auto-return
// promise). `todaySubDate` records which day the current listeners are bound to.
async function subscribeTodayScoped() {
  if (todaySubUnsub) { todaySubUnsub(); todaySubUnsub = null; }
  const date = localDate();
  todaySubDate = date;
  const token = ++todaySubToken;
  todaySubUnsub = await store.subscribeToday(state.familyId, date, {
    onTodayCompletions: (t) => { if (token !== todaySubToken) return; detectApproval(t); state.todayCompletions = t; renderAll(); },
    // Today-only overrides feed planDay for BOTH roles, so a parent's one-day
    // exception immediately reshapes Sirus's view too and auto-returns tomorrow.
    onDayOverrides: (o) => { if (token !== todaySubToken) return; state.dayOverrides = o; renderAll(); }
  });
}

// Watch for the local date to change (midnight, or return-from-background across
// midnight). On rollover: drop any stale completions/overrides immediately so the
// old day can't linger for a frame, re-point the date-scoped listeners at the new
// day, and re-render. Cheap 30s poll plus a tab-focus check.
function startDayWatch() {
  stopDayWatch();
  dayWatchTimer = setInterval(checkDayRollover, 30 * 1000);
}
function stopDayWatch() {
  if (dayWatchTimer) { clearInterval(dayWatchTimer); dayWatchTimer = null; }
}
async function checkDayRollover() {
  if (!state.familyId || !todaySubDate) return;
  if (localDate() === todaySubDate) return;
  // New day: clear yesterday's date-scoped state up front (the fresh snapshot
  // will repopulate today's), then re-point the listeners and repaint.
  state.todayCompletions = [];
  state.dayOverrides = {};
  state.prevCompletions = {};
  await subscribeTodayScoped();
  renderAll();
}

// ---- Day-based ledger navigation (shared by both roles) --------------------
// Re-point the selected-day + week listeners. A monotonic token guards against
// a slow first snapshot from a date we've since navigated away from.
async function subscribeSelectedDay() {
  if (daySubUnsub) { daySubUnsub(); daySubUnsub = null; }
  const token = ++daySubToken;
  const date = state.selectedDate;
  daySubUnsub = await store.subscribeDay(state.familyId, date, rows => {
    if (token !== daySubToken) return; // stale listener
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
  if (isAfterDate(date, today)) date = today; // never select the future (§6.2)
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

function setDayFilter(filter) {
  state.dayFilter = filter;
  renderDayViews();
}

// Render whichever day view is mounted for the active role.
function renderDayViews() {
  if (state.role === 'parent') renderLedger();
  else if (state.role === 'child') renderChildProgress();
}

// A completion status map keyed by questId, for today. 'pending' | 'approved'.
function completionStatus(questId) {
  const c = state.todayCompletions.find(x => x.questId === questId);
  return c ? c.status : null;
}

// Second dopamine hit: when a quest Sirus finished flips pending → approved on
// the parent's device, his tablet celebrates the payoff (mirrors detectEvolution).
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
      // Name the actual approving parent, never a hard-coded "Mom" (§7.1).
      const approver = (c.approvedBy && state.members[c.approvedBy] && state.members[c.approvedBy].displayName) || 'A parent';
      toast(`${approver} said yes! +${mins}m ⭐`);
    }
  }
  state.prevCompletions = next;
}

function detectEvolution(newCats) {
  if (state.role !== 'child') { return; }
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

// ---- Family-feedback delivery (child) --------------------------------------
// One shared queue drives both the real-time "active child" case and the
// "returning child" case: whatever accumulated while Sirus was away is delivered
// when he reconnects and the tab is visible. Positive recognitions bundle into
// one card; returned-quest messages stay separate and gentle (§7.2, §7.3).
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
  if (!claimed.length) { feedbackShowing = false; scheduleReprocess(); return; } // another device took them
  const model = bundleRecognitions(claimed);
  const cardEl = buildRecognitionCard(model);
  document.body.appendChild(cardEl);
  requestAnimationFrame(() => {
    cardEl.classList.add('show');
    recognitionFx(model, cardEl);
    // Displayed → mark seen so a reload/navigation/reconnect can't replay it
    // (§7.3). The minutes were already credited; this is only the celebration.
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
  card.setAttribute('data-testid', 'returned-feedback');
  card.setAttribute('role', 'status');
  const many = events.length > 1;
  const heading = many ? 'A few quests came back' : 'A quest came back';
  const lines = events.map(e => {
    const line = returnedQuestLine(e);
    const note = line.parentNote ? `<span class="fb-note">“${esc(line.parentNote)}”</span>` : '';
    return `<li><strong>${esc(line.questTitle)}</strong><span>${esc(line.message)}</span>${note}</li>`;
  }).join('');
  // Gentle and non-celebratory: no points move, nothing is taken away (§7.3).
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

// The celebration animation. Everything here is optional decoration on top of an
// already-credited point and an already-shown card, so it degrades cleanly:
// reduced motion shows neither flying numbers nor a pose (§7.4).
function recognitionFx(model, cardEl) {
  if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
  if (prefersReducedMotion()) return;
  spawnFx('assets/fx-starburst.png', cardEl, { count: 1, cx: 50, cy: 20, spread: 0, size: 120, life: 800, mode: 'pop' });
  spawnFx('assets/fx-sparkle.png', cardEl, { count: 3, cx: 50, cy: 20, spread: 34, size: 28, life: 900 });
  flyPointsToAvailable(model.totalAmount);
  celebrateActiveCat();
}

// Animate the earned minutes toward the Available Now badge, when it's on screen
// (§7.2). Best-effort: if the badge isn't visible on the current screen, the
// card's own "+N minutes" still communicates the credit.
function flyPointsToAvailable(amount) {
  const target = el('c-available');
  if (!target) return;
  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const startX = window.innerWidth / 2, startY = window.innerHeight * 0.28;
  const fly = document.createElement('div');
  fly.className = 'fb-fly';
  fly.textContent = `+${amount}`;
  fly.style.left = startX + 'px';
  fly.style.top = startY + 'px';
  document.body.appendChild(fly);
  requestAnimationFrame(() => {
    fly.style.transform = `translate(${rect.left + rect.width / 2 - startX}px, ${rect.top + rect.height / 2 - startY}px) scale(.5)`;
    fly.style.opacity = '0';
  });
  setTimeout(() => fly.remove(), 850);
}

// The optional cat celebrate pose, subordinate to Café state priority: a drag, a
// still-resolving eat/play/rest, a Hero event, or any non-idle state outranks it,
// so we render nothing rather than interrupt (§7.0, §7.2, §13).
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
  // On the home screen the portrait is a still image; briefly swap it to the
  // celebrate pose, then let a re-render restore it.
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
  if (state.role === 'parent') { renderApprovals(); renderParentDash(); renderLedger(); renderParentToday(); renderQuestLog(); renderSirusToday(); renderParentQuests(); renderParentCats(); renderParentCafe(); }
  else { renderChildHome(); renderChildQuests(); renderChildCats(); renderChildCafe(); renderChildProgress(); }
}

// Compact recent-activity row for the dashboard feed only. Normalized so a
// floored -2 still reads as -2 and a redemption reads in minutes.
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
  // "Used today" now counts SCREEN TIME ONLY — behavior deductions and
  // corrections are no longer swept into it (§8.2).
  const { earned, used } = store.todayTotals(state.recentTxns);
  el('p-earned').textContent = earned;
  el('p-spent').textContent = used;
  const rows = state.recentTxns.slice(0, 6);
  el('dash-ledger').innerHTML = rows.length ? rows.map(t => ledgerRow(t, true)).join('') : '<div class="empty">No activity yet today.</div>';
}

// ===== Shared day-based ledger view (My Progress + Point Ledger) =============
const CAT_META = {
  earned:       { label: 'Earned',        chip: 'earned' },
  used:         { label: 'Used',          chip: 'used' },
  room_to_grow: { label: 'Room to Grow',  chip: 'rtg' },
  correction:   { label: 'Correction',    chip: 'correction' },
  other:        { label: 'Other activity', chip: 'other' }
};
const FILTER_LABELS = {
  all: 'All', earned: 'Earned', used: 'Used',
  room_to_grow: 'Room to Grow', correction: 'Corrections'
};

// Signed amount to show on a row. Earned/Room-to-Grow use the FULL rule amount
// (requestedAmount) so a floored -2 never shows as -1/+0; Used shows minutes.
function rowDelta(t) {
  if (t.category === CATEGORY.USED) {
    return { text: `-${Math.abs(Number(t.amount) || 0)} min`, cls: 'used' };
  }
  const amt = t.category === CATEGORY.CORRECTION ? (Number(t.amount) || 0) : t.requestedAmount;
  const sign = amt > 0 ? '+' : amt < 0 ? '-' : '';
  const cls = t.category === CATEGORY.EARNED ? 'earned'
    : t.category === CATEGORY.ROOM_TO_GROW ? 'rtg'
    : t.category === CATEGORY.CORRECTION ? 'correction' : 'other';
  return { text: `${sign}${Math.abs(amt)}`, cls };
}

// The selected day's rows, normalized, placed by activity date, newest-first.
function normalizedDay() {
  const sel = state.selectedDate;
  return state.selectedDayTxns
    .map(t => normalizeTransaction(t, { members: state.members }))
    .filter(t => t.activityDate === sel)
    .sort((a, b) => (b.createdAt?.seconds ?? Infinity) - (a.createdAt?.seconds ?? Infinity));
}

function emptyMessage() {
  if (state.dayFilter !== 'all') return 'Nothing in this part of the day.';
  return state.selectedDate === localDate()
    ? 'No point activity yet today.'
    : 'No point activity on this day.';
}

// Weekly reflection navigation and display (§14). This is deliberately small:
// the same ledger truth, summarized without grades, rankings, streaks, or comparisons.
function normalizedWeek() {
  const dates = new Set(weekDates(state.weekAnchor));
  return state.weekTxns
    .map(t => normalizeTransaction(t, { members: state.members }))
    .filter(t => dates.has(t.activityDate))
    .sort((a, b) => (b.activityDate || '').localeCompare(a.activityDate || '')
      || (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
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
  return `<div class="week-nav">
    <div class="day-nav-row">
      <button class="day-arrow" data-week-prev aria-label="Previous week">‹</button>
      <div class="day-current">Week of ${esc(longDateLabel(state.weekAnchor))}</div>
      <button class="day-arrow" data-week-next ${state.weekAnchor >= current ? 'disabled' : ''} aria-label="Next week">›</button>
    </div>
    ${atCurrent ? '' : '<button class="text-button week-current" data-week-current>This week</button>'}
  </div>`;
}

function weekSummaryHtml(s, { parent }) {
  const patterns = s.behaviors.length
    ? `<div class="week-pattern-list">${s.behaviors.map(b => `<span class="week-pattern">${esc(b.label)} · ${b.count}</span>`).join('')}</div>`
    : '<p class="muted week-empty">No Room to Grow moments recorded this week.</p>';
  const resetText = s.heroResets
    ? `${s.heroResets} Hero’s ${s.heroResets === 1 ? 'Reset' : 'Resets'} · ${s.linkedRecoveries} linked ${s.linkedRecoveries === 1 ? 'recovery' : 'recoveries'}`
    : 'No Hero’s Resets recorded this week.';
  return `<section class="week-reflection" aria-label="Weekly reflection">
    <div class="week-reflection-head">
      <div><p class="eyebrow purple">${parent ? 'WEEKLY REFLECTION' : 'YOUR WEEK'}</p><h3>How this week looked</h3></div>
    </div>
    <div class="day-summary week-totals">
      <div class="sum earned"><strong>${s.earnedCount} ${s.earnedCount === 1 ? 'win' : 'wins'}</strong><span>+${s.earnedPoints} earned</span></div>
      <div class="sum used"><strong>${s.usedMinutes} min</strong><span>screen used</span></div>
      <div class="sum rtg"><strong>${s.roomToGrowCount} ${s.roomToGrowCount === 1 ? 'moment' : 'moments'}</strong><span>${s.roomToGrowPoints} Room to Grow</span></div>
    </div>
    <div class="week-recovery"><strong>Reset & recover</strong><span>${resetText}</span></div>
    <div class="week-patterns"><strong>Room to Grow patterns</strong>${patterns}</div>
  </section>`;
}

// The full date navigator: prev/next day, Today, 7-day strip with activity dots,
// week nav, and a native calendar jump. Future days are disabled (§6.2).
function dayNavHtml() {
  const today = localDate();
  const sel = state.selectedDate;
  const atToday = sel === today;
  const strip = weekDates(state.weekAnchor).map(d => {
    const future = isAfterDate(d, today);
    const active = d === sel;
    const dot = state.weekActivity.has(d) ? '<span class="day-dot" aria-hidden="true"></span>' : '';
    return `<button class="day-cell${active ? ' active' : ''}" data-day-pick="${d}" ${future ? 'disabled' : ''} aria-pressed="${active}">
      <span class="day-wd">${esc(shortWeekday(d))}</span><span class="day-num">${dayOfMonth(d)}</span>${dot}</button>`;
  }).join('');
  const weekNextDisabled = sameWeek(today, state.weekAnchor) || isAfterDate(state.weekAnchor, today);
  return `<div class="day-nav">
    <div class="day-nav-row">
      <button class="day-arrow" data-day-prev aria-label="Previous day">‹</button>
      <div class="day-current">${esc(longDateLabel(sel))}</div>
      <button class="day-arrow" data-day-next ${atToday ? 'disabled' : ''} aria-label="Next day">›</button>
    </div>
    <div class="day-nav-row secondary">
      ${atToday ? '' : '<button class="text-button" data-day-today>Today</button>'}
      <button class="text-button" data-week-prev aria-label="Previous week">‹ Week</button>
      <button class="text-button" data-week-next ${weekNextDisabled ? 'disabled' : ''} aria-label="Next week">Week ›</button>
      <label class="calendar-btn" title="Jump to a date"><span aria-hidden="true">📅</span>
        <input type="date" class="day-calendar" max="${today}" value="${sel}" aria-label="Jump to a date"></label>
    </div>
    <div class="day-strip">${strip}</div>
  </div>`;
}

function daySummaryHtml(s, { parent }) {
  const tiles = [
    `<div class="sum earned"><strong>${s.earnedCount} ${s.earnedCount === 1 ? 'win' : 'wins'}</strong><span>+${s.earnedPoints}</span></div>`,
    `<div class="sum used"><strong>${s.usedMinutes} min</strong><span>used</span></div>`,
    `<div class="sum rtg"><strong>${s.roomToGrowCount} ${s.roomToGrowCount === 1 ? 'moment' : 'moments'}</strong><span>${s.roomToGrowPoints}</span></div>`
  ];
  if (parent && s.corrections > 0) {
    tiles.push(`<div class="sum correction"><strong>${s.corrections}</strong><span>corrections</span></div>`);
  }
  return `<div class="day-summary">${tiles.join('')}</div>`;
}

function dayFilterHtml({ parent }) {
  const chips = ['all', 'earned', 'used', 'room_to_grow'].concat(parent ? ['correction'] : []);
  return `<div class="day-filters">${chips.map(c =>
    `<button class="chip${state.dayFilter === c ? ' active' : ''}" data-day-filter="${c}">${esc(FILTER_LABELS[c])}</button>`
  ).join('')}</div>`;
}

function rewardEffectsLabel(rr, ra) {
  const parts = [];
  for (const k of ['brain', 'energy', 'bond', 'coins']) {
    const req = rr ? Number(rr[k] || 0) : 0;
    const app = ra ? Number(ra[k] || 0) : 0;
    if (!req && !app) continue;
    parts.push(req === app ? `${k} +${app}` : `${k} +${app} of +${req}`);
  }
  return parts.join(', ');
}

// How to caption the actor, by what the row actually is. "Noticed by" is
// reserved for a manual positive recognition Mom/Abba typed in (e.g. "noticed he
// washed the table") — a quest is an approval, not something noticed, so it must
// not borrow that wording.
function actorLabel(t) {
  if (t.kind === 'quest') return 'Approved by';
  if (t.category === CATEGORY.USED) return 'Recorded by';
  if (t.category === CATEGORY.ROOM_TO_GROW) return 'Noted by';
  if (t.category === CATEGORY.CORRECTION) return 'Corrected by';
  return 'Noticed by'; // manual positive recognition
}

// Expanded detail. The child sees friendly context only; the parent also sees
// audit fields (source, intended-vs-applied, dates, links, cat effects) (§8.3).
function rowDetail(t, { parent }) {
  const rows = [];
  if (t.timeLabel) rows.push(['Time', t.timeLabel]);
  rows.push([actorLabel(t), t.actorName]);
  if (t.note) rows.push(['Note', t.note]);
  if (t.kind === 'quest' && t.localDate && t.localDate !== t.activityDate) {
    rows.push(['Approved', 'the next day']);
  }
  if (parent) {
    rows.push(['Source', `${t.kind || '—'}${t.reasonCode ? ' · ' + t.reasonCode : ''}`]);
    if (Number(t.requestedAmount) !== Number(t.amount)) {
      rows.push(['Intended vs applied', `${t.requestedAmount} → ${t.amount}`]);
    }
    rows.push(['Activity date', t.activityDate || '—']);
    if (t.localDate && t.localDate !== t.activityDate) rows.push(['Posted', t.localDate]);
    const eff = rewardEffectsLabel(t.rewardRequested, t.rewardApplied);
    if (eff) rows.push(['Cat effects', eff]);
    if (t.questCompletionId) rows.push(['Quest completion', t.questCompletionId]);
    if (t.questAttemptId) rows.push(['Attempt', t.questAttemptId]);
    if (t.reversesTransactionId) rows.push(['Reverses entry', t.reversesTransactionId]);
  }
  return `<dl class="prog-detail">${rows.map(([k, v]) =>
    `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function progressRow(t, { parent, corrected }) {
  const meta = CAT_META[t.category] || CAT_META.other;
  const d = rowDelta(t);
  const expanded = state.expandedTxn === t.id;
  const badges = [];
  if (t.reasonCode === 'hero_reset') badges.push('<span class="row-badge reset">Reset</span>');
  if (corrected) badges.push('<span class="row-badge corrected">Corrected</span>');
  const note = t.note ? `<small class="row-note">${esc(t.note)}</small>` : '';
  return `<div class="prog-row ${d.cls}${corrected ? ' is-corrected' : ''}${expanded ? ' open' : ''}" data-txn-toggle="${esc(t.id)}" role="button" tabindex="0" aria-expanded="${expanded}">
    <div class="prog-main">
      <span class="prog-delta ${d.cls}">${d.text}</span>
      <div class="prog-text"><p>${esc(t.reasonLabel || meta.label)}${badges.length ? ' ' + badges.join(' ') : ''}</p>${note}</div>
      <span class="prog-chip ${meta.chip}">${esc(meta.label)}</span>
    </div>
    ${expanded ? rowDetail(t, { parent }) : ''}
  </div>`;
}

// Child "My Progress": read-only. Corrections and their corrected originals are
// parent audit history only, so Sirus sees neither side of an administrative fix.
function renderChildProgress() {
  const mount = el('c-progress-view');
  if (!mount) return;
  if (state.historyMode === 'week') {
    const summary = summarizeWeek(normalizedWeek());
    const available = (state.child && state.child.available) || 0;
    mount.innerHTML = `
      <div class="available-banner"><span>Available now</span><strong>${available} min</strong></div>
      ${historyModeToggleHtml()}
      ${weekNavHtml()}
      ${weekSummaryHtml(summary, { parent: false })}`;
    return;
  }
  const day = normalizedDay();
  const summary = summarizeDay(day);
  const corrected = correctedOriginalIds(day);
  const available = (state.child && state.child.available) || 0;
  let rows = day.filter(t => t.category !== CATEGORY.CORRECTION && !corrected.has(t.id));
  if (state.dayFilter !== 'all' && state.dayFilter !== 'correction') {
    rows = rows.filter(t => t.category === state.dayFilter);
  }
  const list = rows.length
    ? rows.map(t => progressRow(t, { parent: false, corrected: corrected.has(t.id) })).join('')
    : `<div class="empty">${esc(emptyMessage())}</div>`;
  mount.innerHTML = `
    <div class="available-banner"><span>Available now</span><strong>${available} min</strong></div>
    ${historyModeToggleHtml()}
    ${dayNavHtml()}
    ${daySummaryHtml(summary, { parent: false })}
    ${dayFilterHtml({ parent: false })}
    <div class="day-list">${list}</div>`;
}

// Parent "Point Ledger": same day model, plus a Corrections chip, audit detail,
// and no 50-row ceiling for the selected day.
function renderLedger() {
  const mount = el('p-ledger-view');
  if (!mount) return;
  if (state.historyMode === 'week') {
    const summary = summarizeWeek(normalizedWeek());
    const available = (state.child && state.child.available) || 0;
    mount.innerHTML = `
      ${historyModeToggleHtml()}
      ${weekNavHtml()}
      ${weekSummaryHtml(summary, { parent: true })}
      <div class="available-banner subtle"><span>Available now</span><strong>${available} min</strong></div>`;
    return;
  }
  const day = normalizedDay();
  const summary = summarizeDay(day);
  const corrected = correctedOriginalIds(day);
  const available = (state.child && state.child.available) || 0;
  let rows = day;
  if (state.dayFilter !== 'all') rows = rows.filter(t => t.category === state.dayFilter);
  const list = rows.length
    ? rows.map(t => progressRow(t, { parent: true, corrected: corrected.has(t.id) })).join('')
    : `<div class="empty">${esc(emptyMessage())}</div>`;
  mount.innerHTML = `
    ${historyModeToggleHtml()}
    ${dayNavHtml()}
    ${daySummaryHtml(summary, { parent: true })}
    <div class="available-banner subtle"><span>Available now</span><strong>${available} min</strong></div>
    ${dayFilterHtml({ parent: true })}
    <div class="day-list">${list}</div>`;
}
// Live mirror of what's on Sirus's tablet right now, so Mom can see his quest
// progress without picking up his device. Shows only enabled quests (the ones he
// actually sees), each with a To do / Waiting / Done status chip.
function renderSirusToday() {
  const box = el('sirus-today');
  if (!box) return;
  // Mirror Sirus's ACTUAL day: run the same planDay the child view uses so
  // recurrence and today-only overrides (skip/move/next) are honored. A quest not
  // scheduled today, or skipped for today, is not "on his screen now" and must not
  // appear here. planDay also carries move/next flags, but this flat list only
  // needs the membership + order.
  const active = planDay(state.quests.filter(questIsAvailable), { ymd: localDate(), overrides: state.dayOverrides })
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const done = active.filter(q => completionStatus(q.id) === 'approved').length;
  const waiting = active.filter(q => completionStatus(q.id) === 'pending').length;
  const todo = active.length - done - waiting;
  const summary = el('sirus-today-summary');
  if (summary) {
    summary.textContent = active.length
      ? `${todo} to do · ${waiting} waiting for you · ${done} done`
      : 'No quests are turned on for Sirus right now.';
  }
  box.innerHTML = active.map(q => {
    const st = completionStatus(q.id);
    const meta = SECTION_META[q.section] || {};
    const tag = meta.glyph ? `${meta.glyph} ` : '';
    // Mom can mark a quest done straight from here. Approved → just the chip;
    // pending (Sirus tapped it) → an Approve button; to-do → a Mark done button.
    const note = st === 'pending' ? ' · ⏳ waiting for you' : '';
    const action = st === 'approved'
      ? '<span class="status-chip done">✓ Done</span>'
      : `<button class="pill-btn approve" data-sirus-done="${esc(q.id)}">${st === 'pending' ? '✓ Approve' : 'Mark done'}</button>`;
    return `<div class="sirus-today-row" data-testid="sirus-today-row" data-quest-id="${esc(q.id)}"><div class="q-body"><strong>${esc(q.title)}</strong>
      <br><small>${tag}${esc(q.section)}${note}</small></div>${action}</div>`;
  }).join('') || '<div class="empty">Turn on a quest below and it\'ll show here.</div>';
}
function parentQuestRow(q, { index = 0, total = 1, archived = false } = {}) {
  const on = q.enabled !== false;
  const selected = state.questSelection.has(q.id);
  const section = SECTION_META[q.section] || { glyph: '•' };
  const requirement = questIsDailyEssential(q) ? 'Essential' : 'Bonus';
  const status = archived ? 'Archived' : on ? 'Active' : 'Paused';
  const reward = `+${q.points}m${q.brain ? ' · ★' + q.brain : ''}${q.energy ? ' · ⚡' + q.energy : ''} · ♥${QUEST_BOND}${q.coins ? ' · 🪙' + q.coins : ''}`;
  const qaDelete = /^QA-/i.test(q.title || '')
    ? `<button class="quest-action danger" data-del-quest="${esc(q.id)}">Delete QA</button>`
    : '';
  const actions = archived
    ? `<button class="quest-action" data-duplicate-quest="${esc(q.id)}">Duplicate</button>
       <button class="quest-action primary" data-restore-quest="${esc(q.id)}">Restore</button>${qaDelete}`
    : `<button class="quest-action order" data-move-quest="${esc(q.id)}" data-direction="up" ${index === 0 ? 'disabled' : ''} aria-label="Move ${esc(q.title)} up in ${esc(WINDOW_LABEL[questTimeWindow(q)] || questTimeWindow(q))}">↑</button>
       <button class="quest-action order" data-move-quest="${esc(q.id)}" data-direction="down" ${index === total - 1 ? 'disabled' : ''} aria-label="Move ${esc(q.title)} down in ${esc(WINDOW_LABEL[questTimeWindow(q)] || questTimeWindow(q))}">↓</button>
       <button class="quest-action" data-edit-quest="${esc(q.id)}">Edit</button>
       <button class="quest-action" data-duplicate-quest="${esc(q.id)}">Duplicate</button>
       <button class="quest-action" data-toggle-quest="${esc(q.id)}">${on ? 'Pause' : 'Resume'}</button>
       <button class="quest-action" data-archive-quest="${esc(q.id)}">Archive</button>${qaDelete}`;
  return `<div class="parent-quest-row ${on ? '' : 'quest-off'} ${archived ? 'quest-archived' : ''}" data-testid="parent-quest-row" data-quest-id="${esc(q.id)}">
    <label class="quest-select" aria-label="Select ${esc(q.title)}"><input type="checkbox" data-testid="quest-selection" data-select-quest="${esc(q.id)}" ${selected ? 'checked' : ''}></label>
    <div class="q-body"><strong>${esc(q.title)}</strong>
      <div class="quest-meta"><span>${esc(section.glyph || '•')} ${esc(q.section || 'General')}</span><span>${esc(requirement)}</span><span>${esc(recurrenceLabel(q))}</span><span>${esc(status)}</span></div>
      <small>${reward}</small></div>
    <div class="quest-row-actions">${actions}</div></div>`;
}

function renderQuestBulkToolbar() {
  const live = new Set(state.quests.map(q => q.id));
  for (const id of [...state.questSelection]) if (!live.has(id)) state.questSelection.delete(id);
  const count = state.questSelection.size;
  el('quest-selection-count').textContent = count ? `${count} selected` : 'Select quests to change together';
  el('quest-bulk-edit').disabled = count === 0;
  el('quest-clear-selection').hidden = count === 0;
}

function renderParentQuests() {
  const { groups, archived } = questManagementGroups(state.quests);
  const activeHtml = groups.map(group => {
    const activeCount = group.quests.filter(q => q.enabled !== false).length;
    const paused = group.quests.length - activeCount;
    const requirementGroup = (label, quests, kind) => quests.length
      ? `<section class="quest-requirement-group" data-requirement="${kind}">
          <h4>${label} <span>${quests.length}</span></h4>
          ${quests.map((q, index) => parentQuestRow(q, { index, total: quests.length })).join('')}
        </section>`
      : '';
    return `<details class="quest-section" open data-window="${esc(group.window)}"><summary>
      <span class="qs-head"><span class="section-glyph">${esc(WINDOW_GLYPH[group.window] || '•')}</span>${esc(group.label)}</span>
      <span class="qs-count">${activeCount} active${paused ? ` · ${paused} paused` : ''}</span></summary>
      <div class="qs-body">
        ${requirementGroup('Daily Essentials', group.essentialQuests, 'essential')}
        ${requirementGroup('Bonus quests', group.bonusQuests, 'bonus')}
      </div></details>`;
  }).join('');
  const archivedHtml = archived.length
    ? `<details class="quest-section archived-section"><summary><span class="qs-head"><span class="section-glyph">▣</span>Archived</span><span class="qs-count">${archived.length} recoverable</span></summary>
       <div class="qs-body">${archived.map(q => parentQuestRow(q, { archived: true })).join('')}</div></details>`
    : '';
  el('parent-quests').innerHTML = activeHtml + archivedHtml || '<div class="empty">No quests yet.</div>';
  renderQuestBulkToolbar();
}

function syncQuestBulkDialog() {
  const action = el('quest-bulk-action').value;
  const recurrence = el('quest-bulk-recurrence').value;
  el('quest-bulk-window-row').hidden = action !== 'daypart';
  el('quest-bulk-recurrence-row').hidden = action !== 'recurrence';
  el('quest-bulk-days-row').hidden = action !== 'recurrence' || recurrence !== 'selected_days';
  el('quest-bulk-once-row').hidden = action !== 'recurrence' || recurrence !== 'one_time';
}

function openQuestBulkDialog() {
  if (!state.questSelection.size) return;
  el('quest-bulk-summary').textContent = `${state.questSelection.size} quest${state.questSelection.size === 1 ? '' : 's'} selected. Rewards and today-only changes will not be touched.`;
  el('quest-bulk-action').value = 'pause';
  el('quest-bulk-window').value = 'morning';
  el('quest-bulk-recurrence').value = 'everyday';
  document.querySelectorAll('.quest-bulk-day').forEach(cb => { cb.checked = false; });
  el('quest-bulk-once-date').value = localDate();
  el('quest-bulk-error').hidden = true;
  syncQuestBulkDialog();
  el('quest-bulk-dialog').showModal();
}

function questBulkValue(action) {
  if (action === 'daypart') return el('quest-bulk-window').value;
  if (action === 'essential') return true;
  if (action === 'bonus') return false;
  if (action !== 'recurrence') return null;
  const type = el('quest-bulk-recurrence').value;
  if (type === 'selected_days') {
    return { type, days: [...document.querySelectorAll('.quest-bulk-day')].filter(cb => cb.checked).map(cb => cb.value) };
  }
  if (type === 'one_time') return { type, date: el('quest-bulk-once-date').value };
  return { type };
}

async function applyQuestBulk() {
  const ids = [...state.questSelection];
  if (!ids.length) return;
  let action = el('quest-bulk-action').value;
  const value = questBulkValue(action);
  if (action === 'bonus') action = 'essential';
  const error = el('quest-bulk-error');
  error.hidden = true;
  try {
    const result = await store.bulkUpdateQuests(state.familyId, state.uid, ids, action, value);
    state.questSelection.clear();
    el('quest-bulk-dialog').close();
    renderParentQuests();
    toast(`Updated ${result.updated} quest${result.updated === 1 ? '' : 's'}.`);
  } catch (err) {
    error.textContent = err.message === 'recurrence-days-required'
      ? 'Choose at least one day.'
      : err.message === 'recurrence-date-required'
        ? 'Choose a date.'
        : 'Could not update these quests — try again.';
    error.hidden = false;
  }
}

function openQuestReturnDialog(completion) {
  returningCompletionId = completion && completion.id;
  if (!returningCompletionId) return;
  el('quest-return-title').textContent = completion.questTitle || 'Quest';
  const first = QUEST_RETURN_PRESETS[0];
  const choice = document.querySelector(`input[name="quest-return-reason"][value="${first.code}"]`);
  if (choice) choice.checked = true;
  el('quest-return-note').value = '';
  el('quest-return-dialog').showModal();
}

async function applyQuestReturn() {
  const completion = state.pendingApprovals.find(c => c.id === returningCompletionId);
  if (!completion) {
    el('quest-return-dialog').close();
    returningCompletionId = null;
    toast('That quest was already handled.');
    return;
  }
  const reason = document.querySelector('input[name="quest-return-reason"]:checked');
  try {
    await store.rejectCompletion(state.familyId, state.uid, completion, {
      reasonCode: reason ? reason.value : QUEST_RETURN_PRESETS[0].code,
      note: el('quest-return-note').value
    });
    el('quest-return-dialog').close();
    returningCompletionId = null;
    toast('Returned gently — no points removed.');
  } catch (err) {
    toast('Could not return — try again.');
  }
}

// ===== Parent Today portal (§17.2) ==========================================
// The calm operations screen. Reads the SAME planDay + organizeDay model as the
// child view so the two devices can never disagree about "what is on today".
// Reward economics are untouched — Today only re-frames the same quests and the
// same approval actions for the parent.

// Prune the batch-approval selection to completions that are still pending, so
// one approved on another device (or via the single-approve button) can't linger
// as a ghost checkbox that Approve-selected would then no-op over.
function pendingApprovalSelection() {
  const live = new Set((state.pendingApprovals || []).map(c => c.id));
  for (const id of [...state.approveSel]) if (!live.has(id)) state.approveSel.delete(id);
  return state.approveSel;
}

// Needs You (§17.3 / §26.3): the shared attention queue at the top of Today —
// shown only when parent action is required. Batch review preserves per-Quest
// integrity (each row still approves through the idempotent approveCompletion).
function todayNeedsYouHtml() {
  const items = state.pendingApprovals || [];
  if (!items.length) return '';
  const sel = pendingApprovalSelection();
  const rows = items.map(c => {
    const q = state.quests.find(x => x.id === c.questId);
    const title = (q && q.title) || c.questTitle || 'Quest';
    const r = c.rewards || {};
    const pts = q ? q.points : (r.points || 0);
    const coins = q ? q.coins : (r.coins || 0);
    const reward = `+${pts}m${q&&q.brain?' · ★'+q.brain:(r.brain?' · ★'+r.brain:'')}${q&&q.energy?' · ⚡'+q.energy:(r.energy?' · ⚡'+r.energy:'')} · ♥${QUEST_BOND}${coins?' · 🪙'+coins:''}`;
    return `<div class="needsyou-row">
      <label class="needsyou-check"><input type="checkbox" data-approve-sel="${esc(c.id)}" ${sel.has(c.id)?'checked':''} aria-label="Select ${esc(title)}"></label>
      <div class="q-body"><strong>${esc(title)}</strong><br><small>${reward}</small></div>
      <button class="pill-btn reject" data-reject="${esc(c.id)}" aria-label="Return ${esc(title)}">✕</button>
      <button class="pill-btn approve" data-approve="${esc(c.id)}" aria-label="Approve ${esc(title)}">✓</button>
    </div>`;
  }).join('');
  const selCount = sel.size;
  const allChecked = selCount === items.length;
  return `<section class="card needsyou-card">
    <div class="card-head"><h3>Needs you <span class="badge">${items.length}</span></h3></div>
    <p class="muted">Sirus finished these — approve to turn them into minutes, or return one to try again.</p>
    <div class="needsyou-bar">
      <label class="needsyou-check"><input type="checkbox" data-approve-selall ${allChecked?'checked':''}> Select all</label>
      <button class="pill-btn approve batch" data-approve-selected ${selCount?'':'disabled'}>✓ Approve ${selCount||''} selected</button>
    </div>${rows}</section>`;
}

// One quest row on Today: title, an at-a-glance status chip, and (Slice 2c) its
// today-only actions. `phase` is the current daypart, threaded through so the
// Later action only appears when there is a genuinely-later slot to move to.
function parentTodayQuestRow(q, phase) {
  const st = completionStatus(q.id); // null | 'pending' | 'approved'
  const chip = st === 'approved'
    ? '<span class="status-chip done">✓ Done</span>'
    : st === 'pending'
      ? '<span class="status-chip waiting">⏳ Waiting</span>'
      : '<span class="status-chip todo">To do</span>';
  return `<div class="ptoday-row" data-testid="ptoday-row" data-quest-id="${esc(q.id)}"><div class="q-body"><strong>${esc(q.title)}</strong>${todayFlagHtml(q)}</div>${chip}${todayActionsHtml(q, phase)}</div>`;
}
// Inline marker for a quest carrying a today-only move/next (skips leave the
// board entirely and are managed from the Today-is-different card instead).
function todayFlagHtml(q) {
  if (q.movedToday) return ' · <em>moved to later</em>';
  if (q.nextToday) return ' · <em>next</em>';
  return '';
}
// Per-quest today-only actions (§17.5): Skip · Later · Next, a schedule change
// for today only — never a point deduction. A quest already carrying a move/next
// shows a single Undo instead. (A skipped quest isn't on the board, so it has no
// row here — undo it from the Today-is-different card.) Later is omitted when the
// quest has no genuinely-later daypart to move into (e.g. an Anytime quest).
function todayActionsHtml(q, phase) {
  const ov = state.dayOverrides[q.id];
  if (ov && (ov.action === 'move' || ov.action === 'next')) {
    return `<button class="pill-btn reject sm" data-today-clear="${esc(q.id)}" aria-label="Undo today's change to ${esc(q.title)}">Undo</button>`;
  }
  const canMoveLater = laterWindowFor(questTimeWindow(q), phase) !== null;
  const laterBtn = canMoveLater
    ? `<button class="chip-btn" data-today-move="${esc(q.id)}" aria-label="Move ${esc(q.title)} to later today">Later</button>`
    : '';
  return `<div class="today-actions">
    <button class="chip-btn" data-today-skip="${esc(q.id)}" aria-label="Skip ${esc(q.title)} today">Skip</button>
    ${laterBtn}
    <button class="chip-btn" data-today-next="${esc(q.id)}" aria-label="Make ${esc(q.title)} the next mission">Next</button>
  </div>`;
}

function renderParentToday() {
  const box = el('p-today');
  if (!box) return;
  const active = state.quests.filter(questIsAvailable);
  const doneIds = new Set(active.filter(q => completionStatus(q.id)).map(q => q.id));
  // Recurrence + today-only overrides decide what is actually on today; the same
  // organizer the child uses then groups it into Now / Next / Later / Anytime.
  const planned = planDay(active, { ymd: localDate(), overrides: state.dayOverrides });
  const phase = phaseNow();
  const day = organizeDay(planned, { phase, completedIds: doneIds });

  const sections = [todayNeedsYouHtml(), todayExceptionBarHtml()];

  // Current routine is visually dominant, with progress framed as minutes STILL
  // AVAILABLE to earn — never as points lost (§3, §15).
  if (day.now) {
    const g = day.now;
    const counts = progressCounts(g.quests, doneIds);
    const mins = minutesAvailable(g.quests, doneIds);
    sections.push(`<section class="card ptoday-now">
      <p class="phase-eyebrow now-eyebrow">RIGHT NOW · ${esc(WINDOW_LABEL[g.window] || g.window)}</p>
      <p class="ptoday-progress">${counts.complete}/${counts.total} done${mins?` · <strong>${mins}m</strong> still to earn`:' · all done here — great job! 🎉'}</p>
      ${g.quests.map(q => parentTodayQuestRow(q, phase)).join('')}</section>`);
  } else {
    sections.push('<section class="card ptoday-now"><p class="phase-eyebrow now-eyebrow">RIGHT NOW</p><p class="muted">Nothing scheduled for this part of the day.</p></section>');
  }

  // Future routines stay compact but discoverable (§17.2).
  const upcoming = [day.next, ...day.later].filter(Boolean);
  if (upcoming.length) {
    const chips = upcoming.map(g => `<span class="later-chip">${esc(WINDOW_LABEL[g.window] || g.window)} <b>${g.quests.length}</b></span>`).join('');
    sections.push(`<section class="card ptoday-later"><p class="phase-eyebrow">COMING UP</p><div class="later-chips">${chips}</div></section>`);
  }

  // Anytime is available independently of the day phase.
  if (day.anytime && day.anytime.length) {
    sections.push(`<section class="card ptoday-anytime"><p class="phase-eyebrow">ANYTIME</p>${day.anytime.map(q => parentTodayQuestRow(q, phase)).join('')}</section>`);
  }

  // Past windows still holding unfinished work — "still needs doing", never a
  // failure (§10.1). Only rows that are actually unfinished are listed.
  if (day.stillNeedsDoing.length) {
    const rows = day.stillNeedsDoing.map(g =>
      `<p class="phase-eyebrow">${esc(WINDOW_LABEL[g.window] || g.window)} · STILL NEEDS DOING</p>` +
      g.quests.filter(q => !doneIds.has(q.id)).map(q => parentTodayQuestRow(q, phase)).join('')
    ).join('');
    sections.push(`<section class="card ptoday-still">${rows}</section>`);
  }

  box.innerHTML = sections.join('');
}
// "Today Is Different" (§17.6): a launcher for one-day presets plus the list of
// exceptions currently in effect, each with an Undo. This is also the ONLY place
// a skipped quest can be un-skipped, since a skip removes it from the board.
// Exceptions are never framed as Sirus failing a task.
function todayExceptionBarHtml() {
  const entries = Object.entries(state.dayOverrides || {})
    .filter(([, ov]) => ov && ov.action);
  const n = entries.length;
  const rows = entries.map(([qid, ov]) => {
    const q = state.quests.find(x => x.id === qid);
    const title = (q && q.title) || qid;
    const what = ov.action === 'skip' ? 'Skipped today'
      : ov.action === 'move' ? `Moved to ${WINDOW_LABEL[ov.window] || 'later'}`
      : 'Made next';
    return `<div class="exception-row" data-testid="exception-row" data-quest-id="${esc(qid)}"><div class="q-body"><strong>${esc(title)}</strong><br><small>${esc(what)}</small></div>
      <button class="pill-btn reject" data-today-clear="${esc(qid)}" aria-label="Undo change to ${esc(title)}">Undo</button></div>`;
  }).join('');
  return `<section class="card exception-card">
    <div class="card-head"><h3>Today is different</h3>${n?`<span class="badge">${n}</span>`:''}</div>
    <p class="muted">${n ? `${n} one-day change${n>1?'s':''} in effect — back to normal tomorrow.` : 'One-off day? Sick day, school off, out all day — set a one-day exception.'}</p>
    <button class="pill-btn today-preset-btn" data-today-presets>${n ? 'Add another exception' : 'Set up a one-day exception'}</button>
    ${rows}</section>`;
}

// Quest Log (§17.11): what happened with responsibilities today — history, not
// the home screen, and distinct from the Point Ledger. Date-nav + filters are
// Slice 3; this is today's completions in the order they happened.
function renderQuestLog() {
  const box = el('p-quest-log');
  if (!box) return;
  const items = (state.todayCompletions || []).slice()
    .sort((a, b) => (a.at?.seconds ?? 0) - (b.at?.seconds ?? 0));
  if (!items.length) {
    box.innerHTML = '<div class="empty">Nothing logged yet today.</div>';
    return;
  }
  box.innerHTML = `<section class="card"><div class="card-head"><h3>Today</h3></div>${
    items.map(c => {
      const q = state.quests.find(x => x.id === c.questId);
      const title = (q && q.title) || c.questTitle || 'Quest';
      const label = c.status === 'pending'
        ? '<span class="status-chip waiting">⏳ Waiting for you</span>'
        : '<span class="status-chip done">✓ Approved</span>';
      const time = c.at && typeof c.at.seconds === 'number'
        ? localTimeLabel(new Date(c.at.seconds * 1000)) : '';
      return `<div class="questlog-row"><div class="q-body"><strong>${esc(title)}</strong>${time?`<br><small>${esc(time)}</small>`:''}</div>${label}</div>`;
    }).join('')
  }</section>`;
}

// Parent review queue: quests Sirus finished that are waiting to become minutes.
function renderApprovals() {
  const box = el('pending-approvals');
  if (!box) return;
  const items = state.pendingApprovals || [];
  const badge = el('approvals-count');
  if (badge) { badge.textContent = items.length; badge.hidden = items.length === 0; }
  const card = el('approvals-card');
  if (card) card.hidden = items.length === 0;
  box.innerHTML = items.map(c => {
    const q = state.quests.find(x => x.id === c.questId);
    const title = (q && q.title) || c.questTitle || 'Quest';
    const r = c.rewards || {};
    const pts = q ? q.points : (r.points || 0);
    const coins = q ? q.coins : (r.coins || 0);
    const reward = `+${pts}m${q&&q.brain?' · ★'+q.brain:(r.brain?' · ★'+r.brain:'')}${q&&q.energy?' · ⚡'+q.energy:(r.energy?' · ⚡'+r.energy:'')} · ♥${QUEST_BOND}${coins?' · 🪙'+coins:''}`;
    return `<div class="approval-row" data-testid="approval-row" data-quest-id="${esc(c.questId || '')}"><div class="q-body"><strong>${esc(title)}</strong><br><small>${reward}</small></div>
      <button class="pill-btn reject" data-reject="${esc(c.id)}" aria-label="Reject ${esc(title)}">✕</button>
      <button class="pill-btn approve" data-approve="${esc(c.id)}" aria-label="Approve ${esc(title)}">✓ Approve</button></div>`;
  }).join('') || '<div class="empty">Nothing waiting — all caught up!</div>';
}
function catCardHtml(id, canTrain) {
  const def = CAT_DEFS[id]; const cat = state.cats[id] || { brain:0, energy:0, bond:0, evolved:false };
  const active = state.child.activeCatId === id;
  const careDays = heroCareDays(cat);
  const careLabel = cat.evolved ? '☀ Hero' : `☀${careDays}/${HERO_CARE_REQUIRED_DAYS}`;
  return `<article class="cat-card ${active?'active':''}">${cat.evolved?'<span class="hero-badge">HERO</span>':''}
    <img src="${cat.evolved?def.heroArt:def.art}" alt="${esc(def.name)}">
    <h3>${esc(cat.evolved?def.heroName:def.name)}</h3>
    <p class="sub">★${cat.brain||0}/12 · ⚡${cat.energy||0}/12 · ${careLabel} · ♥${cat.bond||0}/20</p>
    ${canTrain?`<button class="wide-button" data-train="${id}" ${active?'disabled':''}>${active?'Training':'Train this cat'}</button>`:''}</article>`;
}
function renderParentCats() { el('parent-cats').innerHTML = Object.keys(CAT_DEFS).map(id => catCardHtml(id, false)).join(''); }
function renderParentCafe() {
  // Owned items are listed with a Return control so a parent can refund a
  // purchase. This is mainly a QA affordance: the QA family eventually owns the
  // whole catalog, which leaves no Buy button and blocks every purchase test.
  // It is safe for the real family too — refunding restores the exact coins
  // paid — but it is a parent-only control and the rules, not this markup,
  // are what enforce that.
  const rows = state.ownedItems.map(o => {
    const item = CAFE_ITEMS[o.id];
    if (!item) return '';
    const refund = o.price ?? item.price ?? 0;
    return `<div class="parent-cafe-row" data-testid="parent-cafe-row" data-item-id="${esc(o.id)}">
      <div class="q-body"><strong>${esc(item.name)}</strong><br><small>🪙${refund}${o.placed === false ? ' · put away' : ''}</small></div>
      <button class="quest-action danger" data-return-item="${esc(o.id)}">Return</button>
    </div>`;
  }).join('');
  el('parent-cafe').innerHTML = `<p class="muted">Sirus decorates the café with Cat Coins. Owned: ${state.ownedItems.length} item(s).</p>`
    + (rows || '<div class="empty">Nothing bought yet.</div>');
}

// ----- Child -----
function meter(barId, valId, value, max) {
  el(barId).style.width = `${Math.min(100, (value / max) * 100)}%`;
  el(valId).textContent = `${value}/${max}`;
}
function naturalList(items) {
  if (items.length < 2) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}
function heroNeedsText(cat) {
  const brain = Math.max(0, HERO_THRESHOLD.brain - (cat.brain || 0));
  const energy = Math.max(0, HERO_THRESHOLD.energy - (cat.energy || 0));
  const care = Math.max(0, HERO_CARE_REQUIRED_DAYS - heroCareDays(cat));
  const needs = [];
  if (brain) needs.push(`${brain} more Brain`);
  if (energy) needs.push(`${energy} more Energy`);
  if (care) needs.push(`${care} more active care ${care === 1 ? 'day' : 'days'}`);
  return needs.length ? `Hero Form needs ${naturalList(needs)}.` : 'Hero Form is ready!';
}
function renderChildHome() {
  const id = state.child.activeCatId; const def = CAT_DEFS[id];
  const cat = state.cats[id] || { brain:0, energy:0, bond:0, evolved:false };
  el('c-available').textContent = state.child.available || 0;
  const { earned } = store.todayTotals(state.recentTxns);
  el('c-earned').textContent = earned;
  // "Waiting for Mom" pile: pending rewards stack up visibly so finishing quests
  // still feels rewarding even though the minutes are gated on approval.
  const pend = state.pendingApprovals || [];
  const pMin = pend.reduce((s, c) => s + ((c.rewards && c.rewards.points) || 0), 0);
  const pCoins = pend.reduce((s, c) => s + ((c.rewards && c.rewards.coins) || 0), 0);
  const tray = el('c-pending-tray');
  if (tray) {
    tray.hidden = pend.length === 0;
    el('c-pending').innerHTML = `⭐ <strong>${pMin}m</strong>${pCoins?` · 🪙 <strong>${pCoins}</strong>`:''} waiting for Mom`;
  }
  el('c-cat-art').src = cat.evolved ? def.heroArt : def.art;
  el('c-cat-name').textContent = cat.evolved ? def.heroName : def.name;
  meter('c-brain-bar','c-brain-val', cat.brain||0, 12);
  meter('c-energy-bar','c-energy-val', cat.energy||0, 12);
  meter('c-bond-bar','c-bond-val', cat.bond||0, 20);
  meter('c-care-days-bar','c-care-days-val', heroCareDays(cat), HERO_CARE_REQUIRED_DAYS);
  el('c-care-days-row').hidden = !!cat.evolved;
  if (cat.evolved) el('c-hero-hint').textContent = `${def.heroName} — Hero Form!`;
  else el('c-hero-hint').textContent = heroNeedsText(cat);
  // The Home preview must show only what is actually on for today: recurrence and
  // today-only Skip/Move/Next overrides are applied through planDay before taking
  // the first few unfinished quests (same source of truth as the Quests screen and
  // the parent Today view), so a skipped or off-schedule quest never leaks here.
  const planned = planDay(state.quests.filter(questIsAvailable), { ymd: localDate(), overrides: state.dayOverrides });
  const next = planned.filter(q => !completionStatus(q.id)).slice(0, 3);
  el('c-next-quests').innerHTML = next.length ? next.map(childQuestCard).join('') : '<div class="empty">All done — great job!</div>';
}
function childQuestCard(q) {
  const status = completionStatus(q.id); // null | 'pending' | 'approved'
  const cls = status === 'approved' ? 'done' : status === 'pending' ? 'pending' : '';
  const careReward = careCharges(state.child && state.child.careCharges) >= CARE_CONFIG.chargeCap
    ? '· ✦ care full'
    : '· ✦1 care';
  const reward = `+${q.points}m ${q.brain?'· ★'+q.brain:''} ${q.energy?'· ⚡'+q.energy:''} · ♥${QUEST_BOND} ${q.coins?'· 🪙'+q.coins:''} ${careReward}`;
  const btn = status === 'approved'
    ? `<button class="quest-complete" disabled>✓</button>`
    : status === 'pending'
      ? `<span class="quest-pending" aria-label="Waiting for Mom">⏳</span>`
      : `<button class="quest-complete" data-complete="${esc(q.id)}">+</button>`;
  // data-quest-status is the card's state in one attribute ('todo' | 'pending' |
  // 'approved') so a test can read where a quest stands without inferring it
  // from which control happens to be rendered.
  return `<div class="quest-card ${cls}" data-testid="quest-card" data-quest-id="${esc(q.id)}" data-quest-status="${status || 'todo'}"><div class="q-body"><div class="q-title">${esc(q.title)}</div>
    <div class="q-reward">${reward}</div>
    ${status==='pending'?'<div class="q-status">Done! Waiting for Mom ⭐</div>':''}</div>
    ${btn}</div>`;
}
// A mission card = the normal quest card, plus a Focus affordance ONLY where
// Routine Mode wants "work one at a time" (the NOW block). Everywhere else the
// Focus row is omitted so long lists don't double in height. Finished cards
// render unchanged.
function childMissionCard(q, { focus = false } = {}) {
  const card = childQuestCard(q);
  if (!focus || completionStatus(q.id)) return card;
  return `<div class="mission-wrap">${card}<button class="focus-btn" data-focus="${esc(q.id)}" aria-label="Focus on ${esc(q.title)}">🔎 Focus</button></div>`;
}

// Now / Next / Later / Anytime + Routine Mode + Focus Mode (§6, §7, §8, §10.1).
// Reward economics are untouched — this only changes how the same quests and the
// same completion actions are organized on screen.
function renderChildQuests() {
  const active = state.quests.filter(questIsAvailable);
  // A quest with any completion (pending = waiting for Mom, or approved) is not
  // actionable again today; both count as "handled".
  const doneIds = new Set(active.filter(q => completionStatus(q.id)).map(q => q.id));

  // Focus Mode: one task, everything else hidden. Falls through to the list if
  // the focused quest was finished or turned off.
  if (state.focusQuestId) {
    const fq = active.find(q => q.id === state.focusQuestId);
    if (fq && !doneIds.has(fq.id)) {
      el('c-quests').innerHTML =
        `<div class="focus-mode">
           <button class="text-button focus-back" data-focus-exit>← Back to missions</button>
           <div class="focus-card">${childQuestCard(fq)}</div>
         </div>`;
      return;
    }
    state.focusQuestId = null;
  }

  // Recurrence + today-only overrides decide what is actually on for today; the
  // result feeds the same Now/Next/Later organizer. Legacy quests (everyday, no
  // override) pass through unchanged, preserving accepted Slice 1 UX.
  const planned = planDay(active, { ymd: localDate(), overrides: state.dayOverrides });
  const day = organizeDay(planned, { phase: phaseNow(), completedIds: doneIds });
  const sections = [];

  // NOW — Routine Mode: "Pick your next mission" (2–4 eligible). A clear
  // "Right now" eyebrow orients Sirus to the current routine at a glance.
  if (day.now) {
    const missions = nextMissions(day.now.quests, doneIds, 4);
    const left = progressCounts(day.now.quests, doneIds).left;
    const mins = minutesAvailable(day.now.quests, doneIds);
    const head = `<div class="phase-head now">
      <span class="phase-eyebrow now-eyebrow">Right now</span>
      <h3>${WINDOW_GLYPH[day.now.window]} ${esc(WINDOW_LABEL[day.now.window])}</h3>
      <small>${left} left · ${mins} minute${mins === 1 ? '' : 's'} available to earn</small></div>`;
    const body = missions.length
      ? `<p class="pick-cue">Pick your next mission</p>${missions.map(q => childMissionCard(q, { focus: true })).join('')}`
      : `<div class="empty">All done here — great job! 🎉</div>`;
    sections.push(`<section class="phase now">${head}${body}</section>`);
  }

  // STILL NEEDS DOING — past windows with unfinished work, neutral (§10.1).
  // Collapsed by default so it can't bury Now/Next/Later; every unfinished quest
  // stays one tap away. Open state is app-controlled so a background re-render
  // can't snap it shut mid-use.
  for (const g of day.stillNeedsDoing) {
    const unfinished = g.quests.filter(q => !doneIds.has(q.id));
    const open = state.stillOpen.has(g.window);
    sections.push(`<details class="phase still"${open ? ' open' : ''}>
      <summary data-toggle-still="${g.window}"><span class="still-head">${WINDOW_GLYPH[g.window]} ${esc(WINDOW_LABEL[g.window])} — still needs doing</span><span class="still-count">${unfinished.length} left</span></summary>
      <div class="still-body">${unfinished.map(q => childMissionCard(q, { focus: false })).join('')}</div></details>`);
  }

  // NEXT — compact + explicit label, no invented timing (an empty Evening can
  // sit between, so "starts after <now>" would be misleading).
  if (day.next) {
    sections.push(`<section class="phase next compact"><div class="phase-head">
      <span class="phase-eyebrow">Next</span>
      <h3>${WINDOW_GLYPH[day.next.window]} ${esc(WINDOW_LABEL[day.next.window])}</h3></div></section>`);
  }

  // LATER — compact labelled list of upcoming windows.
  if (day.later.length) {
    const items = day.later.map(g => `<li>${WINDOW_GLYPH[g.window]} ${esc(WINDOW_LABEL[g.window])}</li>`).join('');
    sections.push(`<section class="phase later compact"><div class="phase-head"><span class="phase-eyebrow">Later</span></div><ul class="later-list">${items}</ul></section>`);
  }

  // ANYTIME — flexible-TIMING quests (not "optional"). Cap the initially visible
  // list with a See all expander so it doesn't recreate the original wall.
  const anytimeOpen = day.anytime.filter(q => !doneIds.has(q.id));
  if (anytimeOpen.length) {
    const CAP = 3;
    const capped = !state.anytimeExpanded && anytimeOpen.length > CAP;
    const shown = capped ? anytimeOpen.slice(0, CAP) : anytimeOpen;
    const cards = shown.map(q => childMissionCard(q, { focus: false })).join('');
    const toggle = anytimeOpen.length > CAP
      ? `<button class="anytime-toggle" data-toggle-anytime>${state.anytimeExpanded ? 'Show less' : `See all (${anytimeOpen.length})`}</button>`
      : '';
    sections.push(`<section class="phase anytime"><div class="phase-head"><h3>⭐ Anytime</h3><small>do these any time today</small></div>${cards}${toggle}</section>`);
  }

  // Completed drawer — open state controlled by app state so a background
  // re-render can't snap it shut while Sirus has it open.
  const finished = active.filter(q => completionStatus(q.id));
  const finishedHtml = finished.length
    ? `<details class="completed-quests"${state.completedOpen ? ' open' : ''}><summary data-toggle-completed>✓ Completed today <span class="done-count">${finished.length}</span></summary>
        <div class="completed-body">${finished.map(childQuestCard).join('')}</div></details>`
    : '';

  const body = sections.join('') || (finished.length ? '' : '<div class="empty">No quests yet.</div>');
  el('c-quests').innerHTML = body + finishedHtml;
}
function renderChildCats() {
  const canSwitch = state.child.childCanSwitchCat !== false;
  el('c-cats').innerHTML = Object.keys(CAT_DEFS).map(id => catCardHtml(id, canSwitch)).join('');
}
// Stable default slot per item (indexed by café-item order) so freshly-bought
// décor lands somewhere sensible before Sirus drags it. 11 slots for 11 items;
// each avoids the cat's center-bottom area and the other slots.
const CAFE_ITEM_IDS = Object.keys(CAFE_ITEMS);
const CAFE_SLOTS = [
  [5,5],  [39,4],  [72,6],
  [4,28],          [72,28],
          [40,22],
  [5,50],          [73,49],
          [40,48],
  [6,71],          [73,70]
];
function cafeSlot(itemId) {
  const i = Math.max(0, CAFE_ITEM_IDS.indexOf(itemId));
  const [bx, by] = CAFE_SLOTS[i % CAFE_SLOTS.length];
  const wrap = Math.floor(i / CAFE_SLOTS.length); // 0 for the first 11, 1 for 12–17
  return [Math.min(74, bx + wrap * 7), Math.min(80, by + wrap * 4)];
}
function ownedCafeRecord(itemId) { return state.ownedItems.find(o => o.id === itemId); }

// Active drag; also a render guard so a snapshot mid-drag doesn't rebuild the
// placed layer and yank the item out of Sirus's hand.
let cafeDrag = null;
const clampNum = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- Café modes: Play (interact) vs Decorate (arrange) ----------------------
// Two explicit modes so arranging furniture never triggers cat actions, and the
// cat is only draggable while playing. `cafeUndo` holds the inverse of the last
// decorate action for one-step Undo (cleared when the session ends).
let cafeMode = 'play';
let cafeUndo = null;

function setCafeMode(mode) {
  // Arranging the room takes priority over an in-progress play action. Leave the
  // cat awake and stable instead of letting an old action finish behind the tray.
  if (mode === 'decorate' && catState !== 'idle') settleCatToRest();
  cafeMode = mode;
  catBeatsSinceWander = 0;
  cafeUndo = null;
  updateCafeModeUI();
  renderChildCafe();
}
function cafeDefaultHint() {
  return cafeMode === 'decorate'
    ? 'Drag things to arrange · use the tray to add or store · Undo fixes a mistake'
    : 'Tap anywhere to call the cat · bowls, beds, and toys are playable';
}
function setCafeHint(message) {
  const hint = el('c-cafe-hint');
  if (hint) hint.textContent = message || cafeDefaultHint();
}
function updateCafeModeUI() {
  const decorating = cafeMode === 'decorate';
  const room = el('c-cafe-room'); if (room) room.classList.toggle('decorate', decorating);
  const screen = document.querySelector('[data-cscreen="cafe"]'); if (screen) screen.classList.toggle('decorating', decorating);
  const decorateBtn = el('c-decorate-btn'); if (decorateBtn) decorateBtn.hidden = decorating;
  const actions = el('c-decorate-actions'); if (actions) actions.hidden = !decorating;
  const tray = el('c-tray'); if (tray) tray.hidden = !decorating;
  updateCafeUndoBtn();
  setCafeHint();
}
function setCafeUndo(u) { cafeUndo = u; updateCafeUndoBtn(); }
function updateCafeUndoBtn() { const b = el('c-undo-btn'); if (b) b.disabled = !cafeUndo; }
async function applyCafeUndo() {
  const u = cafeUndo; if (!u) return;
  setCafeUndo(null);
  try {
    if (u.type === 'move') await store.moveCafeItem(state.familyId, u.id, u.x, u.y);
    else if (u.type === 'place') await store.setCafeItemPlaced(state.familyId, u.id, true);
    else if (u.type === 'store') await store.setCafeItemPlaced(state.familyId, u.id, false);
    toast('Undone.');
  } catch (_) { toast('Could not undo — try again.'); }
}
// The café cat's resting look. It is driven by daily care — never the long-term
// training Energy stat. Low Rest gets a quiet sleep pose; another low need keeps
// the cat calm while the functional cue points toward a useful object.
function catMood() {
  const id = state.child.activeCatId; const cat = state.cats[id] || {};
  const low = lowestCareNeed(activeCareNeeds(), 40);
  if (low && low.need === 'rest') return { pose: 'sleep', cls: 'mood-sleepy' };
  if (low) return { pose: 'sit', cls: 'mood-calm' };
  if (cat.evolved) return { pose: null, cls: 'mood-happy' };
  const happyToday = (state.todayCompletions && state.todayCompletions.length > 0) || (cat.bond || 0) >= 12;
  return happyToday ? { pose: 'sit', cls: 'mood-happy' } : { pose: 'sit', cls: 'mood-calm' };
}

// ---- Daily care: Hunger + Rest + Happiness ---------------------------------
// Existing Hunger-only cats are lazily migrated with healthy Rest/Happiness
// defaults; a Set prevents duplicate writes while the realtime snapshot catches
// up. All three needs use the same timestamp but distinct decay rates.
const careInitPending = new Set();
let careSpendPending = false;
let careLockedView = null;
const careFeedbackTimers = new Map();
let careClockTimer = null;
let needGuideTimer = null;

const CARE_META = Object.freeze({
  hunger: Object.freeze({ label: 'Hunger', icon: 'assets/food-bowl-purple.png', objects: 'a food bowl' }),
  rest: Object.freeze({ label: 'Rest', icon: 'assets/night-routine-icon.png', objects: 'a bed, pillow, or house' }),
  happiness: Object.freeze({ label: 'Happiness', icon: 'assets/yarn-blue.png', objects: 'yarn, a toy basket, or the cat tree' })
});

function stopCareClock() {
  clearInterval(careClockTimer);
  careClockTimer = null;
}

function startCareClock() {
  stopCareClock();
  careClockTimer = setInterval(() => {
    const onCafe = document.querySelector('[data-cscreen="cafe"]')?.classList.contains('active');
    if (state.role === 'child' && onCafe && !careSpendPending) renderCafeCareStatus();
  }, 60 * 1000);
}

function careBand(value) {
  if (value >= 70) return { label: 'Thriving', cls: 'thriving' };
  if (value >= 40) return { label: 'Okay', cls: 'okay' };
  if (value >= 15) return { label: 'Needs care', cls: 'needs-care' };
  return { label: 'Ready for care', cls: 'urgent-safe' };
}

function activeCareNeeds() {
  if (!state.child) return needsAt(null);
  const cat = state.cats[state.child.activeCatId] || {};
  return needsAt(cat.catNeeds);
}

function renderNeedCue(needs) {
  const cue = el('c-need-cue');
  const icon = el('c-need-cue-icon');
  if (!cue || !icon || !state.child) return;
  const lowest = lowestCareNeed(needs, 40);
  cue.hidden = !lowest || cafeMode !== 'play';
  if (!lowest || cafeMode !== 'play') { delete cue.dataset.need; return; }
  const meta = CARE_META[lowest.need];
  const def = CAT_DEFS[state.child.activeCatId];
  cue.dataset.need = lowest.need;
  cue.setAttribute('aria-label', `Help ${def.name} with ${meta.label}`);
  cue.title = `${meta.label} could use care`;
  icon.src = meta.icon;
  icon.alt = '';
}

function renderCafeCareStatus({ needsOverride = null, chargesOverride = null } = {}) {
  if (!state.child) return;

  const locked = careSpendPending && careLockedView ? careLockedView : null;
  const needs = needsOverride || (locked ? locked.needs : activeCareNeeds());
  const charges = chargesOverride == null
    ? (locked ? locked.charges : careCharges(state.child.careCharges))
    : careCharges(chargesOverride);

  el('c-care-charges').textContent = charges;
  el('c-care-charges').setAttribute('aria-label', `${charges} of ${CARE_CONFIG.chargeCap} Care Charges`);
  for (const need of CARE_NEEDS) {
    const value = needs[need];
    const rounded = displayNeedValue(value);
    const band = careBand(value);
    const bar = el(`c-${need}-bar`);
    const meterEl = el(`c-${need}-meter`);
    const row = el(`c-${need}-need`);
    if (!bar || !meterEl || !row) continue;
    el(`c-${need}-val`).textContent = `${rounded}/100`;
    el(`c-${need}-band`).textContent = band.label;
    bar.style.width = `${value}%`;
    meterEl.setAttribute('aria-valuenow', String(rounded));
    row.classList.remove('thriving', 'okay', 'needs-care', 'urgent-safe', 'is-saving');
    row.classList.add(band.cls);
    row.classList.toggle('is-saving', careSpendPending);
  }
  renderNeedCue(needs);
}

function ensureActiveCatCare(catId, cat) {
  const complete = cat.catNeeds && cat.catNeeds.lastUpdatedAt
    && CARE_NEEDS.every(need => cat.catNeeds[need] != null && Number.isFinite(Number(cat.catNeeds[need])));
  if (!catId || complete || careInitPending.has(catId)) return;
  careInitPending.add(catId);
  store.ensureCatCare(state.familyId, catId)
    .catch(() => setTimeout(() => careInitPending.delete(catId), 5000));
}
// ---- Café cat behavior: one state, one timer -------------------------------
// A single owner for what the cat is doing. Every transition cancels the pending
// timer, so a stale beat can never override a newer action — the root cause of
// the old "snap back to center / revert the pose" bug (a 900ms settle timer and
// a separate stroll-return timer both fighting whatever was happening now).
let catTapCount = 0;
let catState = 'idle';     // idle | glance | wander | react | dragged | approach | eat | drink | play | sleep
let catStateTimer = null;  // duration of the current transient state
let catBeatTimer = null;   // schedules the next autonomous idle beat
let catBeatsSinceWander = 0;
let catAnimTimer = null;   // frame-swap loop for multi-frame poses (eat/play/walk)
let catAnimStopTimer = null;
let catTargetId = null;    // placed object currently selected by Sirus
let catTargetEl = null;
let catTargetHidden = false;
const preloadedCatFrames = new Set();

function stopSpriteAnimation() {
  clearInterval(catAnimTimer);
  clearTimeout(catAnimStopTimer);
  catAnimTimer = null;
  catAnimStopTimer = null;
}

function syncCatStateUI() {
  const wrap = el('c-cafe-cat-wrap');
  if (wrap) wrap.dataset.catState = catState;
}

function releaseCatTarget() {
  if (catTargetEl) catTargetEl.classList.remove('is-cat-target', 'is-in-use');
  document.querySelectorAll('#c-placed .is-cat-target, #c-placed .is-in-use')
    .forEach(node => node.classList.remove('is-cat-target', 'is-in-use'));
  catTargetId = null;
  catTargetEl = null;
  catTargetHidden = false;
}

function markCatTarget(itemEl, hidden = false) {
  catTargetEl = itemEl || (catTargetId && document.querySelector(`[data-decor="${catTargetId}"]`));
  catTargetHidden = hidden;
  if (!catTargetEl) return;
  catTargetEl.classList.add('is-cat-target');
  catTargetEl.classList.toggle('is-in-use', hidden);
}

// Load a selected cat's alternate frames before its first autonomous beat. This
// avoids a network flash between frame A and B, while keeping the initial page
// load small because unselected cats are not preloaded.
function preloadCatFrames(def) {
  if (!def || !def.frames) return;
  Object.values(def.frames).flat().forEach((src) => {
    if (preloadedCatFrames.has(src)) return;
    preloadedCatFrames.add(src);
    const img = new Image();
    img.src = src;
  });
}
// Art for a café pose. Sleep always uses the cat-only transparent sprite layered
// over the actual object Sirus selected. The old signature-bed composites made
// Moss appear inside one bed while Nova and Ember appeared beside that same bed.
// One shared layering path keeps every cat and every sleep object consistent.
function cafePoseArt(def, poseKey) {
  if (!def.poses) return def.art;
  return def.poses[poseKey] || def.poses.sit || def.art;
}

function renderChildCafe() {
  el('c-coins').textContent = state.child.coins || 0;
  const id = state.child.activeCatId; const cat = state.cats[id] || {}; const def = CAT_DEFS[id];
  renderCafeCareStatus();
  ensureActiveCatCare(id, cat);
  el('c-cafe-room').style.backgroundImage = `url("${CAFE_ROOM_ART}")`;
  preloadCatFrames(def);
  const mood = catMood();
  const wrap = el('c-cafe-cat-wrap');
  if (wrap) {
    wrap.className = `cafe-cat-wrap ${mood.cls}`;
    wrap.dataset.catState = catState;
  }
  // The cat's position is owned by the behavior machine (drag + welcome-back +
  // wander), not re-applied here — a data snapshot must never teleport a cat that
  // has wandered or been dragged back to its base spot.
  // Only refresh the resting sprite while the cat is actually resting; if it's
  // mid-react/glance/wander, leave its pose alone so a snapshot can't cut it off.
  if (catState === 'idle') el('c-cafe-cat').src = catRestPoseSrc(cat, def);
  if (!cafeDrag) {
    el('c-placed').innerHTML = state.ownedItems.filter(o => o.placed !== false).map(o => {
      const item = CAFE_ITEMS[o.id]; if (!item) return '';
      const [x, y] = (o.x != null && o.y != null) ? [o.x, o.y] : cafeSlot(o.id);
      const selected = o.id === catTargetId;
      const targetClasses = selected ? ` is-cat-target${catTargetHidden ? ' is-in-use' : ''}` : '';
      const actionLabel = item.role === 'decor' ? `Look at ${item.name}` : `Ask the cat to use ${item.name}`;
      return `<img class="cafe-decor${targetClasses}" src="${item.art}" alt="${esc(item.name)}" data-decor="${o.id}"
        style="left:${x}%;top:${y}%" draggable="false" role="button" tabindex="0" aria-label="${esc(actionLabel)}">`;
    }).join('');
    if (catTargetId) catTargetEl = el('c-placed').querySelector(`[data-decor="${catTargetId}"]`);
  }
  renderCafeTray();
  el('c-shop').innerHTML = CAFE_ITEM_IDS.map(itemId => {
    const item = CAFE_ITEMS[itemId];
    const owned = ownedCafeRecord(itemId);
    const afford = (state.child.coins || 0) >= item.price;
    let btn;
    if (!owned) btn = `<button data-buy="${item.id}" ${afford ? '' : 'disabled'}>${afford ? 'Buy' : 'Need coins'}</button>`;
    else if (owned.placed !== false) btn = `<button class="ghost-btn" data-putaway="${item.id}">Put away</button>`;
    else btn = `<button data-place="${item.id}">Place</button>`;
    return `<div class="shop-item"><img src="${item.art}" alt="${esc(item.name)}"><strong>${esc(item.name)}</strong>
      <small><img class="coin-ico" src="assets/coin.png" alt=""> ${item.price}</small>${btn}</div>`;
  }).join('');
}

// The Decorate-mode tray: every owned item, with a one-tap Place (bring it into
// the room) or Store (put it away, keeping its saved spot for next time).
function renderCafeTray() {
  const tray = el('c-tray');
  if (!tray || cafeMode !== 'decorate') return;
  if (!state.ownedItems.length) {
    tray.innerHTML = `<p class="muted">Buy cozy things below, then arrange them up here.</p>`;
    return;
  }
  tray.innerHTML = state.ownedItems.map(o => {
    const item = CAFE_ITEMS[o.id]; if (!item) return '';
    const placed = o.placed !== false;
    const btn = placed
      ? `<button class="ghost-btn" data-store="${o.id}">Store</button>`
      : `<button data-place-tray="${o.id}">Place</button>`;
    return `<div class="tray-item ${placed ? 'is-placed' : ''}">
      <img src="${item.art}" alt="${esc(item.name)}"><small>${esc(item.name)}</small>${btn}</div>`;
  }).join('');
}

// ---- Café interactions ------------------------------------------------------
// One pointer flow drives two modes: in Decorate, drag placed décor to rearrange;
// in Play, drag the cat to move it (a tap that doesn't move is a pet/react). The
// modes never overlap, so arranging furniture can't accidentally poke the cat.
function initCafeInteractions() {
  const room = el('c-cafe-room');
  if (!room) return;

  room.addEventListener('pointerdown', (e) => {
    if (cafeMode === 'decorate') {
      const img = e.target.closest('[data-decor]');
      if (!img) return;
      e.preventDefault();
      const rec = ownedCafeRecord(img.dataset.decor);
      const [dx, dy] = cafeSlot(img.dataset.decor);
      cafeDrag = { kind: 'decor', id: img.dataset.decor, el: img, rect: room.getBoundingClientRect(),
                   grabX: e.clientX, grabY: e.clientY, moved: false,
                   fromX: (rec && rec.x != null) ? rec.x : dx, fromY: (rec && rec.y != null) ? rec.y : dy };
      img.classList.add('dragging');
      try { img.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
      return;
    }
    if (cafeMode === 'play') {
      const cat = e.target.closest('#c-cafe-cat');
      if (!cat) return;
      e.preventDefault();
      const wrap = el('c-cafe-cat-wrap');
      const rr = room.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      const currentX = ((wr.left - rr.left) / rr.width) * 100;
      const currentY = ((wr.top - rr.top) / rr.height) * 100;
      const interrupted = catState !== 'idle';
      releaseCatTarget();
      setCafeHint();
      // Freeze at the currently rendered point before removing an approach
      // transition; otherwise a mid-walk grab would jump to the old destination.
      wrap.style.transition = 'none';
      wrap.style.left = currentX + '%';
      wrap.style.top = currentY + '%';
      wrap.style.bottom = 'auto';
      clearTimeout(catStateTimer);
      stopSpriteAnimation();
      const { cat: progress, def } = catCtx();
      cat.src = catRestPoseSrc(progress, def);
      catState = 'dragged'; // a grab beats any pending beat
      syncCatStateUI();
      cafeDrag = { kind: 'cat', el: wrap, catEl: cat, rect: room.getBoundingClientRect(),
                   grabX: e.clientX, grabY: e.clientY, moved: false,
                   startX: currentX, startY: currentY, interrupted };
      try { cat.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
    }
  });

  room.addEventListener('pointermove', (e) => {
    if (!cafeDrag) return;
    if (!cafeDrag.moved && Math.abs(e.clientX - cafeDrag.grabX) + Math.abs(e.clientY - cafeDrag.grabY) > 6) cafeDrag.moved = true;
    if (!cafeDrag.moved) return;
    const r = cafeDrag.rect;
    if (cafeDrag.kind === 'decor') {
      // Center the item under the finger; clamp so it stays fully inside the room.
      // Décor is 26% wide and ~19.5% of the room tall (the room is a 3:4 box).
      const x = clampNum(((e.clientX - r.left) / r.width) * 100 - 13, 0, 74);
      const y = clampNum(((e.clientY - r.top) / r.height) * 100 - 9.75, 0, 80.5);
      cafeDrag.el.style.left = x + '%'; cafeDrag.el.style.top = y + '%';
      cafeDrag.lastX = x; cafeDrag.lastY = y;
      const now = performance.now();
      if (now - (cafeDrag.lastPaw || 0) > 110) {
        cafeDrag.lastPaw = now;
        spawnFx('assets/fx-paw.png', room, { count: 1, cx: x + 13, cy: y + 10, spread: 0, size: 26, life: 700, mode: 'trail' });
      }
    } else if (cafeDrag.kind === 'cat') {
      // The cat wrap is 40% wide (~30% tall); offset so the body sits under the
      // finger, and keep it in the walkable part of the room.
      const x = clampNum(((e.clientX - r.left) / r.width) * 100 - 20, 2, 58);
      const y = clampNum(((e.clientY - r.top) / r.height) * 100 - 22, 12, 68);
      cafeDrag.el.style.left = x + '%'; cafeDrag.el.style.top = y + '%'; cafeDrag.el.style.bottom = 'auto';
      cafeDrag.lastX = x; cafeDrag.lastY = y;
    }
  });

  const endDrag = async (e) => {
    if (!cafeDrag) return;
    const d = cafeDrag; cafeDrag = null;
    const round = (n) => Math.round(n * 10) / 10;
    if (d.kind === 'decor') {
      d.el.classList.remove('dragging');
      try { d.el.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
      if (d.moved && d.lastX != null) {
        setCafeUndo({ type: 'move', id: d.id, x: round(d.fromX), y: round(d.fromY) });
        try { await store.moveCafeItem(state.familyId, d.id, round(d.lastX), round(d.lastY)); }
        catch (_) { toast('Could not save that move.'); renderChildCafe(); }
      } else {
        d.el.classList.remove('wiggle'); void d.el.offsetWidth; d.el.classList.add('wiggle');
      }
      return;
    }
    if (d.kind === 'cat') {
      d.el.style.transition = ''; // restore the gentle ease for autonomous strolls
      try { d.catEl.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
      catState = 'idle';
      syncCatStateUI();
      if (d.moved && d.lastX != null) {
        const x = round(d.lastX), y = round(d.lastY);
        catBeatsSinceWander = 0;
        if (state.child) state.child.cafeCat = { x, y }; // optimistic: no snap-back before the write lands
        try { await store.moveCafeCat(state.familyId, x, y); }
        catch (_) { toast('Could not save that move.'); renderChildCafe(); }
      } else {
        // The 256×256 cat PNG has a large transparent rectangle. If a visible
        // bowl/toy/bed sits under that rectangle, the browser reports the cat as
        // the tap target even though Sirus clearly touched the object. Look
        // through the cat layer and prioritize that placed object so Water and
        // Toy Basket cannot become mysteriously untappable after decorating.
        const behindCat = Number.isFinite(e.clientX) && Number.isFinite(e.clientY)
          && document.elementsFromPoint
          ? firstCafeDecorElement(document.elementsFromPoint(e.clientX, e.clientY))
          : null;
        if (d.interrupted && state.child) {
          const x = round(d.startX), y = round(d.startY);
          state.child.cafeCat = { x, y };
          store.moveCafeCat(state.familyId, x, y).catch(() => {});
        }
        if (behindCat) return activateCafeItem(behindCat);
        reactCat(e); // a tap, not a drag → pet/react
      }
    }
  };
  room.addEventListener('pointerup', endDrag);
  room.addEventListener('pointercancel', endDrag);
  room.addEventListener('click', (e) => {
    if (cafeMode !== 'play') return;
    const itemEl = e.target.closest('[data-decor]');
    if (itemEl) return activateCafeItem(itemEl);
    // Cat taps are handled by the pointer flow above. A blank-room tap is a
    // movement request: walk there, remain there, and persist the new spot.
    if (e.target.closest('#c-cafe-cat-wrap, .fx-sprite')) return;
    moveCatToRoomTap(e);
  });
  room.addEventListener('keydown', (e) => {
    if (cafeMode !== 'play' || (e.key !== 'Enter' && e.key !== ' ')) return;
    const itemEl = e.target.closest('[data-decor]');
    if (!itemEl) return;
    e.preventDefault();
    activateCafeItem(itemEl);
  });
}

// The cat's mood-resting sprite (Hero art once evolved).
function catRestPoseSrc(cat, def) {
  const m = catMood();
  return cat.evolved ? def.heroArt : cafePoseArt(def, m.pose || 'sit');
}
function catCtx() {
  const id = state.child.activeCatId;
  return { cat: state.cats[id] || {}, def: CAT_DEFS[id], catEl: el('c-cafe-cat'), wrap: el('c-cafe-cat-wrap') };
}
// Return to the resting look and mark the cat idle again.
function settleCatToRest() {
  const { cat, def, catEl, wrap } = catCtx();
  clearTimeout(catStateTimer);
  catStateTimer = null;
  stopSpriteAnimation(); // stop any frame loop so it can't outlive its state
  if (catEl) catEl.src = catRestPoseSrc(cat, def);
  if (wrap) wrap.style.transition = '';
  catState = 'idle';
  syncCatStateUI();
  releaseCatTarget();
  setCafeHint();
}
// Enter a transient state for `ms`, then run `onEnd` (default: settle to rest).
// Cancels the old transition and its sprite loop first, so the newest action
// always wins. Call playSprite() after catTransient() to start the new loop.
function catTransient(next, ms, onEnd) {
  clearTimeout(catStateTimer);
  stopSpriteAnimation();
  catState = next;
  syncCatStateUI();
  catStateTimer = ms == null ? null : setTimeout(onEnd || settleCatToRest, ms);
}
// Animate a multi-frame pose by cycling its frames. Falls back to a meaningful
// still under reduced motion or when a pose has no alternate frame. A dedicated
// stop timer is cleared on every new run so an older hold can never stop a newer
// animation.
function playSprite(poseKey, { fps = 3, holdMs = 0, heroAction = false, targetItemId = null } = {}) {
  const { cat, def, catEl } = catCtx();
  stopSpriteAnimation();
  if (!catEl || !def) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Hero is a permanent unlock, not an endpoint. Until dedicated Hero action
  // frames exist, object interactions use the same cat's base action frames and
  // return to Hero art afterward; ordinary idle reactions keep Hero art.
  const frames = (!cat.evolved || heroAction) && def.frames && def.frames[poseKey];
  const poseArt = cafePoseArt(def, poseKey, targetItemId);
  const still = cat.evolved && !heroAction
    ? def.heroArt
    : (frames && frames[0]) || poseArt;
  if (!frames || frames.length < 2 || reduce) { catEl.src = still; return; }
  let i = 0; catEl.src = frames[0];
  catAnimTimer = setInterval(() => { i = (i + 1) % frames.length; catEl.src = frames[i]; }, Math.round(1000 / fps));
  if (holdMs) catAnimStopTimer = setTimeout(stopSpriteAnimation, holdMs);
}

// ---- Placed object → walk → lasting action ---------------------------------
function pulseCafeItem(itemEl, item) {
  itemEl.classList.remove('wiggle'); void itemEl.offsetWidth; itemEl.classList.add('wiggle');
  const room = el('c-cafe-room');
  if (room) {
    const rr = room.getBoundingClientRect();
    const ir = itemEl.getBoundingClientRect();
    const cx = ((ir.left + ir.width / 2 - rr.left) / rr.width) * 100;
    const cy = ((ir.top + ir.height / 2 - rr.top) / rr.height) * 100;
    spawnFx('assets/fx-sparkle.png', room, { count: 2, cx, cy, spread: 8, size: 30, life: 850 });
  }
  if (item && item.role === 'decor') toast(`${item.name} looks cozy here.`);
}

function actionHidesTarget(item) {
  if (item.role === 'food') return true; // eat art already contains a bowl
  if (item.role === 'play' && (item.id === 'rug' || item.id === 'pinkYarn')) return true;
  return false;
}

function cafeActionHint(item, catName) {
  if (item.role === 'food') return `${catName} is eating.`;
  if (item.role === 'water') return `${catName} is getting a drink.`;
  if (item.role === 'rest') return `${catName} is sleeping · tap the cat or another object to wake up`;
  return `${catName} is playing!`;
}

function clearNeedGuides() {
  clearTimeout(needGuideTimer);
  document.querySelectorAll('.need-guide').forEach(node => node.classList.remove('need-guide'));
}

function holdNeedGuide(node) {
  if (!node) return;
  node.classList.remove('need-guide'); void node.offsetWidth; node.classList.add('need-guide');
  needGuideTimer = setTimeout(() => node.classList.remove('need-guide'), 2800);
}

// The cue is guidance only. It highlights a usable placed object, or opens the
// owned-item tray when the matching object is stored. It never starts an action
// or spends a Care Charge on Sirus's behalf.
function guideCareNeed(need) {
  const meta = CARE_META[need];
  const def = state.child && CAT_DEFS[state.child.activeCatId];
  if (!meta || !def) return;
  clearNeedGuides();

  const placed = Array.from(document.querySelectorAll('#c-placed [data-decor]'))
    .find(node => CAFE_ITEMS[node.dataset.decor]?.need === need);
  if (placed) {
    holdNeedGuide(placed);
    setCafeHint(`Tap the highlighted ${CAFE_ITEMS[placed.dataset.decor].name} to help ${def.name}'s ${meta.label}.`);
    return;
  }

  const stored = state.ownedItems.find(record =>
    record.placed === false && CAFE_ITEMS[record.id]?.need === need);
  if (stored) {
    setCafeMode('decorate');
    const trayCard = document.querySelector(`[data-place-tray="${stored.id}"]`)?.closest('.tray-item');
    holdNeedGuide(trayCard);
    setCafeHint(`Place the highlighted ${CAFE_ITEMS[stored.id].name}, then tap Done to use it.`);
    return;
  }

  setCafeHint(`${def.name}'s ${meta.label} can be helped with ${meta.objects}.`);
  toast(`Place or buy ${meta.objects} to help ${meta.label}.`);
}

function showCareDelta(need, text, tone = 'gain') {
  const delta = el(`c-${need}-delta`);
  if (!delta) return;
  clearTimeout(careFeedbackTimers.get(need));
  delta.textContent = text;
  delta.classList.remove('show', 'cost');
  delta.classList.toggle('cost', tone === 'cost');
  void delta.offsetWidth;
  delta.classList.add('show');
  careFeedbackTimers.set(need, setTimeout(() => {
    delta.classList.remove('show', 'cost');
    delta.textContent = '';
  }, 1800));
}

function showCareRefill(result, destination) {
  renderCafeCareStatus({ needsOverride: result.needsBefore, chargesOverride: result.chargesBefore });
  const bar = el(`c-${result.need}-bar`);
  if (bar) void bar.offsetWidth;
  requestAnimationFrame(() => {
    renderCafeCareStatus({ needsOverride: result.needsAfter, chargesOverride: result.chargesAfter });
  });

  showCareDelta(result.need, `+${result.refill}`);
  if (result.restCost > 0) showCareDelta('rest', `−${result.restCost}`, 'cost');
  const charge = el('c-care-charges');
  if (charge) { charge.classList.remove('spent'); void charge.offsetWidth; charge.classList.add('spent'); }

  const room = el('c-cafe-room');
  if (room) spawnFx('assets/fx-sparkle.png', room, {
    count: 3, cx: destination.x + 20, cy: destination.y + 23,
    spread: 10, size: 30, life: 1000
  });
}

async function resolveCafeCare(item, destination) {
  if (!item.need || !CARE_META[item.need] || careSpendPending) return;
  const need = item.need;
  const meta = CARE_META[need];
  const catId = state.child.activeCatId;
  const def = CAT_DEFS[catId];
  const needsBefore = activeCareNeeds();
  const before = needsBefore[need];
  const chargesBefore = careCharges(state.child.careCharges);

  if (isNeedFull(before)) {
    setCafeHint(`${def.name}'s ${meta.label} is full · no Care Charge used`);
    toast(`${meta.label} is full — your Care Charge is safe.`);
    return;
  }
  if (chargesBefore < 1) {
    setCafeHint(`${def.name} enjoyed that. Complete a quest to earn a Care Charge for ${meta.label}.`);
    toast('Complete a quest to earn a Care Charge.');
    return;
  }

  careSpendPending = true;
  careLockedView = { needs: needsBefore, charges: chargesBefore };
  renderCafeCareStatus();
  setCafeHint(`${def.name} is enjoying some care · saving…`);

  try {
    const result = await store.spendCare(state.familyId, catId, need);
    if (state.child) state.child.careCharges = result.chargesAfter;
    const cat = state.cats[catId] || {};
    state.cats[catId] = {
      ...cat,
      catNeeds: { ...(cat.catNeeds || {}), ...result.needsAfter, lastUpdatedAt: Date.now() }
    };
    careSpendPending = false;
    careLockedView = null;
    if (state.child.activeCatId === catId) {
      showCareRefill(result, destination);
      const restCopy = result.restCost > 0 ? ` · play used ${result.restCost} Rest` : '';
      setCafeHint(`${def.name}'s ${meta.label} rose by ${result.refill}${restCopy}.`);
    }
  } catch (err) {
    careSpendPending = false;
    careLockedView = null;
    renderCafeCareStatus();
    if (err.message === 'no-care-charges') {
      setCafeHint(`Complete a quest to earn a Care Charge for ${def.name}'s ${meta.label}.`);
      toast('No Care Charges right now.');
    } else if (err.message === 'need-full') {
      setCafeHint(`${def.name}'s ${meta.label} is full · no Care Charge used`);
      toast(`${meta.label} is full — your Care Charge is safe.`);
    } else {
      setCafeHint('Care did not save yet · try again when connected');
      toast('Care did not save — your charge is still safe.');
    }
  }
}

function beginCafeObjectAction(item, destination) {
  if (catState !== 'approach' || catTargetId !== item.id) return;
  const action = cafeActionFor(item);
  if (!action) return settleCatToRest();

  const { def, wrap } = catCtx();
  if (wrap) wrap.style.transition = '';
  const liveTarget = el('c-placed').querySelector(`[data-decor="${item.id}"]`) || catTargetEl;
  markCatTarget(liveTarget, actionHidesTarget(item));

  // The destination is now the cat's real location, not a temporary animation
  // offset. Save it just like a direct drag so reopening the café doesn't snap
  // back to the old spot; a failed offline write does not cancel the play action.
  const x = Math.round(destination.x * 10) / 10;
  const y = Math.round(destination.y * 10) / 10;
  catBeatsSinceWander = 0;
  if (state.child) state.child.cafeCat = { x, y };
  store.moveCafeCat(state.familyId, x, y).catch(() => {});

  catTransient(action.state, action.durationMs);
  playSprite(action.pose, {
    fps: action.state === 'sleep' ? 2 : 3,
    holdMs: action.durationMs || 0,
    heroAction: true,
    targetItemId: item.id
  });
  setCafeHint(cafeActionHint(item, def.name));

  const room = el('c-cafe-room');
  if (room) spawnFx('assets/fx-paw.png', room, {
    count: 2, cx: destination.x + 20, cy: destination.y + 25,
    spread: 8, size: 28, life: 800, mode: 'trail'
  });
  resolveCafeCare(item, destination);
}

function activateCafeItem(itemEl) {
  const item = CAFE_ITEMS[itemEl.dataset.decor];
  if (!item) return;
  pulseCafeItem(itemEl, item);
  const action = cafeActionFor(item);
  if (!action) return; // decorative things acknowledge the tap but do not fake care

  // Repeated taps on the same active object acknowledge without restarting its
  // timer or flashing between walk/action frames. A different target interrupts.
  if (catTargetId === item.id && catState !== 'idle') return;

  const room = el('c-cafe-room');
  const { def, wrap } = catCtx();
  if (!room || !wrap || !def) return;
  releaseCatTarget();
  catTargetId = item.id;
  markCatTarget(itemEl);

  const rr = room.getBoundingClientRect();
  const ir = itemEl.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  const from = {
    x: ((wr.left - rr.left) / rr.width) * 100,
    y: ((wr.top - rr.top) / rr.height) * 100
  };
  const destination = catDestinationForObject({
    role: item.role,
    itemLeft: ((ir.left - rr.left) / rr.width) * 100,
    itemTop: ((ir.top - rr.top) / rr.height) * 100,
    itemWidth: (ir.width / rr.width) * 100
  });
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const travelMs = catWalkDuration(from, destination, reduce);

  // Convert the current rendered location to left/top before removing `bottom`;
  // this prevents the first walk from jumping a few pixels at its start.
  wrap.style.transition = 'none';
  wrap.style.left = from.x + '%';
  wrap.style.top = from.y + '%';
  wrap.style.bottom = 'auto';
  void wrap.offsetWidth;

  catTransient('approach', travelMs, () => beginCafeObjectAction(item, destination));
  playSprite('walk', { fps: 4, heroAction: true });
  setCafeHint(`${def.name} is walking to ${item.name}…`);

  if (travelMs === 0) {
    wrap.style.left = destination.x + '%';
    wrap.style.top = destination.y + '%';
  } else {
    wrap.style.transition = `left ${travelMs}ms linear, top ${travelMs}ms linear`;
    requestAnimationFrame(() => {
      if (catState !== 'approach' || catTargetId !== item.id) return;
      wrap.style.left = destination.x + '%';
      wrap.style.top = destination.y + '%';
    });
  }
}

function moveCatToRoomTap(e) {
  const room = el('c-cafe-room');
  const { def, wrap } = catCtx();
  if (!room || !wrap || !def) return;

  const rr = room.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  const from = {
    x: ((wr.left - rr.left) / rr.width) * 100,
    y: ((wr.top - rr.top) / rr.height) * 100
  };
  const destination = catDestinationForTap({
    tapX: ((e.clientX - rr.left) / rr.width) * 100,
    tapY: ((e.clientY - rr.top) / rr.height) * 100
  });
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const travelMs = catWalkDuration(from, destination, reduce);

  releaseCatTarget();
  wrap.style.transition = 'none';
  wrap.style.left = from.x + '%';
  wrap.style.top = from.y + '%';
  wrap.style.bottom = 'auto';
  void wrap.offsetWidth;

  const arrive = () => {
    if (catState !== 'approach' || catTargetId !== null) return;
    const x = Math.round(destination.x * 10) / 10;
    const y = Math.round(destination.y * 10) / 10;
    catBeatsSinceWander = 0;
    if (state.child) state.child.cafeCat = { x, y };
    store.moveCafeCat(state.familyId, x, y).catch(() => toast('Could not save that spot.'));
    settleCatToRest();
  };

  catTransient('approach', travelMs, arrive);
  playSprite('walk', { fps: 4, heroAction: true });
  setCafeHint(`${def.name} is walking over…`);

  if (travelMs === 0) {
    wrap.style.left = destination.x + '%';
    wrap.style.top = destination.y + '%';
    arrive();
  } else {
    wrap.style.transition = `left ${travelMs}ms linear, top ${travelMs}ms linear`;
    requestAnimationFrame(() => {
      if (catState !== 'approach' || catTargetId !== null) return;
      wrap.style.left = destination.x + '%';
      wrap.style.top = destination.y + '%';
    });
  }
}

// ---- Direct interaction: a pet/react ---------------------------------------
function reactCat(e) {
  const { cat, def, catEl } = catCtx();
  const room = el('c-cafe-room');
  catTapCount++;

  // Physical feedback: a springy squash-stretch (alternating with a wiggle) and a
  // haptic tick, so a tap feels like touching a creature, not clicking "next".
  const anim = (catTapCount % 2) ? 'react' : 'react-wiggle';
  catEl.classList.remove('react', 'react-wiggle'); void catEl.offsetWidth; catEl.classList.add(anim);
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) {} }

  // Burst right where the finger landed, not dead-center.
  let cx = 50, cy = 46;
  const px = e && (e.clientX ?? e.touches?.[0]?.clientX);
  const py = e && (e.clientY ?? e.touches?.[0]?.clientY);
  if (room && px != null && py != null) {
    const r = room.getBoundingClientRect();
    cx = ((px - r.left) / r.width) * 100; cy = ((py - r.top) / r.height) * 100;
  }
  spawnFx('assets/fx-sparkle.png', room, { count: 3, cx, cy, spread: 16, size: 40 });
  if (catTapCount % 3 === 0) spawnFx('assets/fx-paw.png', room, { count: 1, cx, cy: cy + 6, spread: 0, size: 30, life: 700, mode: 'trail' });

  // Hold a happy pose for a readable beat, then settle back. Tapping again during
  // the beat just refreshes it (catTransient cancels the old timer) — no flicker,
  // no slideshow, and no stale timer snapping the pose back early.
  if (!cat.evolved && def.poses) {
    catTransient('react', 2600);
    playSprite((catTapCount % 2) ? 'play' : 'celebrate');
  } else {
    catTransient('react', 1600);
  }
}

// ---- Autonomous behavior: the cat lives on its own between taps -------------
// Idle life mixes small in-place beats with occasional bounded travel. Wander
// uses the same state owner and walk loop as directed movement, so any tap,
// drag, mode change, or newer action interrupts it cleanly.
function catPlayBeat() {
  const { cat, def } = catCtx();
  if (cat.evolved || !def.poses) return catHop();
  catTransient('glance', 1200);
  playSprite('play');   // animated bat if the play frames exist, else the single pose
}
function catHop() {
  const { catEl } = catCtx();
  catTransient('glance', 600);
  catEl.classList.remove('react'); void catEl.offsetWidth; catEl.classList.add('react');
}
function catWiggle() {
  const { catEl } = catCtx();
  catTransient('glance', 600);
  catEl.classList.remove('react-wiggle'); void catEl.offsetWidth; catEl.classList.add('react-wiggle');
}
function catBlink() {
  const { cat, def, catEl } = catCtx();
  const idle = !cat.evolved && def.frames && def.frames.idle;
  if (!idle || idle.length < 2) return catWiggle();  // no blink frame yet → just wiggle
  catTransient('glance', 180);                        // reopen (settle) shortly after
  catEl.src = idle[1];                                // eyes closed
}

function cafeObstacleRects(room) {
  const rr = room.getBoundingClientRect();
  if (!rr.width || !rr.height) return [];
  return Array.from(document.querySelectorAll('#c-placed [data-decor]')).map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      x: ((rect.left - rr.left) / rr.width) * 100,
      y: ((rect.top - rr.top) / rr.height) * 100,
      width: (rect.width / rr.width) * 100,
      height: (rect.height / rr.height) * 100
    };
  });
}

function catWander(preferredNeed = null) {
  const room = el('c-cafe-room');
  const { wrap } = catCtx();
  if (!room || !wrap || cafeMode !== 'play' || catState !== 'idle') return false;

  const rr = room.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  if (!rr.width || !rr.height) return false;
  const from = {
    x: ((wr.left - rr.left) / rr.width) * 100,
    y: ((wr.top - rr.top) / rr.height) * 100
  };

  let preferred = null;
  if (preferredNeed) {
    const itemEl = Array.from(document.querySelectorAll('#c-placed [data-decor]'))
      .find(node => CAFE_ITEMS[node.dataset.decor]?.need === preferredNeed);
    if (!itemEl) return false;
    const item = CAFE_ITEMS[itemEl.dataset.decor];
    const ir = itemEl.getBoundingClientRect();
    preferred = catDestinationForObject({
      role: item.role,
      itemLeft: ((ir.left - rr.left) / rr.width) * 100,
      itemTop: ((ir.top - rr.top) / rr.height) * 100,
      itemWidth: (ir.width / rr.width) * 100
    });
  }

  const destination = catWanderDestination({
    from,
    obstacles: cafeObstacleRects(room),
    preferred
  });
  if (!destination) return false;

  const travelMs = catWalkDuration(from, destination, false);
  const arrive = () => {
    if (catState !== 'wander') return;
    const x = Math.round(destination.x * 10) / 10;
    const y = Math.round(destination.y * 10) / 10;
    if (state.child) state.child.cafeCat = { x, y };
    // This ordinary room write is intentionally offline-safe. A transient sync
    // failure must not snap the cat back or interrupt its autonomous life.
    store.moveCafeCat(state.familyId, x, y).catch(() => {});
    settleCatToRest();
  };

  releaseCatTarget();
  wrap.style.transition = 'none';
  wrap.style.left = from.x + '%';
  wrap.style.top = from.y + '%';
  wrap.style.bottom = 'auto';
  void wrap.offsetWidth;

  catTransient('wander', travelMs, arrive);
  playSprite('walk', { fps: 4, heroAction: true });
  wrap.style.transition = `left ${travelMs}ms linear, top ${travelMs}ms linear`;
  requestAnimationFrame(() => {
    if (catState !== 'wander') return;
    wrap.style.left = destination.x + '%';
    wrap.style.top = destination.y + '%';
  });
  return true;
}

function catIdleBeat() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const onCafe = state.role === 'child' && state.child
    && document.querySelector('[data-cscreen="cafe"]')?.classList.contains('active');
  // Only stir when the café is open, in Play mode, the cat is at rest, and Sirus
  // isn't mid-drag. Otherwise wait quietly for the next beat.
  if (!reduce && onCafe && !cafeDrag && cafeMode === 'play' && catState === 'idle') {
    const roll = Math.random();
    const low = lowestCareNeed(activeCareNeeds(), 40);
    if (low) {
      // A cat asking for care stays quieter instead of performing a confusing
      // autonomous play beat while one of its daily needs is low. Low Rest
      // suppresses travel entirely; Hunger/Happiness may occasionally prompt a
      // gentle walk near a matching placed object without using it or spending.
      const traveled = low.need !== 'rest' && roll >= 0.9 && catWander(low.need);
      if (traveled) catBeatsSinceWander = 0;
      else if (roll < 0.6) catBlink();
      else catWiggle();
    } else {
      // Randomness keeps the cat from feeling clockwork; the five-beat ceiling
      // keeps a valid build observable without making Sirus wait indefinitely.
      const travelDue = catBeatsSinceWander >= 5 || roll < 0.18;
      const traveled = travelDue && catWander();
      if (traveled) catBeatsSinceWander = 0;
      else {
        catBeatsSinceWander++;
        if (roll < 0.46) catBlink();         // a slow blink (animated if frames exist)
        else if (roll < 0.68) catWiggle();   // a little shimmy in place
        else if (roll < 0.9) catPlayBeat();  // bat at a toy, then settle
        else catHop();                       // a happy hop
      }
    }
  }
  scheduleCatBeat();
}
// A livelier cat (just did a quest) stirs a bit more often.
function scheduleCatBeat() {
  clearTimeout(catBeatTimer);
  const moodCls = state.child ? catMood().cls : 'mood-calm';
  const base = moodCls === 'mood-happy' ? 5000 : 7000;
  catBeatTimer = setTimeout(catIdleBeat, base + Math.random() * 4000);
}
// Reopening the café shouldn't freeze the cat mid-center. Place it at its saved
// spot in its resting pose and give a small wiggle hello (CSS, no walk needed).
function catWelcomeBack() {
  if (!state.child) return;
  clearTimeout(catStateTimer);
  catBeatsSinceWander = 0;
  // Place the cat at its saved spot (this is the one moment we apply it).
  const wrap = el('c-cafe-cat-wrap');
  const pos = state.child.cafeCat;
  if (wrap && pos && pos.x != null) { wrap.style.left = pos.x + '%'; wrap.style.top = pos.y + '%'; wrap.style.bottom = 'auto'; }
  settleCatToRest();
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) catStateTimer = setTimeout(() => { if (catState === 'idle' && cafeMode === 'play') catWiggle(); }, 700);
}

// Spawn a few effect sprites inside a positioned container. mode: rise | fall | pop.
function spawnFx(src, container, { count = 1, cx = 50, cy = 50, spread = 20, size = 42, life = 1150, mode = 'rise' } = {}) {
  if (!container) return;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('img');
    s.src = src; s.alt = ''; s.className = `fx-sprite fx-${mode}`;
    s.style.left = (cx + (Math.random() * 2 - 1) * spread) + '%';
    s.style.top = (cy + (Math.random() * 2 - 1) * spread * 0.4) + '%';
    s.style.width = size + 'px';
    s.style.animationDelay = (i * 70) + 'ms';
    container.appendChild(s);
    setTimeout(() => s.remove(), life + i * 70);
  }
}

// Full-screen confetti burst (for quest completion / celebrations).
function confettiBurst() {
  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  document.body.appendChild(layer);
  spawnFx('assets/fx-confetti.png', layer, { count: 12, cx: 50, cy: 6, spread: 46, size: 34, life: 1500, mode: 'fall' });
  setTimeout(() => layer.remove(), 1900);
}
// ---- Events -----------------------------------------------------------------
function bindEvents() {
  document.addEventListener('click', async (e) => {
    const role = e.target.closest('[data-choose-role]');
    if (role) return chooseRole(role.dataset.chooseRole);
    const pgo = e.target.closest('[data-pgo]'); if (pgo) return navParent(pgo.dataset.pgo);
    const cgo = e.target.closest('[data-cgo]'); if (cgo) return navChild(cgo.dataset.cgo);
    const qtab = e.target.closest('[data-qtab]'); if (qtab) return navQuestTab(qtab.dataset.qtab);

    if (e.target.closest('#quest-bulk-edit')) { openQuestBulkDialog(); return; }
    if (e.target.closest('#quest-select-active')) {
      state.questSelection = new Set(state.quests.filter(q => !questIsArchived(q)).map(q => q.id));
      renderParentQuests();
      return;
    }
    if (e.target.closest('#quest-clear-selection')) {
      state.questSelection.clear();
      renderParentQuests();
      return;
    }
    if (e.target.closest('#quest-bulk-apply')) {
      e.preventDefault();
      await applyQuestBulk();
      return;
    }
    if (e.target.closest('#quest-return-submit')) {
      e.preventDefault();
      await applyQuestReturn();
      return;
    }

    // Needs You batch review: approve every currently-selected completion. Each
    // still routes through the idempotent approveCompletion, so a row already
    // resolved elsewhere is a safe no-op and per-Quest integrity is preserved.
    if (e.target.closest('[data-approve-selected]')) {
      const sel = pendingApprovalSelection();
      const batch = (state.pendingApprovals || []).filter(c => sel.has(c.id));
      if (!batch.length) return;
      let ok = 0;
      for (const c of batch) {
        try { await store.approveCompletion(state.familyId, state.uid, c); state.approveSel.delete(c.id); ok++; }
        catch (err) { /* leave selected so the parent can retry the ones that failed */ }
      }
      toast(ok ? `Approved ${ok} ⭐` : 'Could not approve — try again.');
      return;
    }

    // Today-only overrides (§17.5). Each is a schedule action for today only —
    // no points move — and auto-returns tomorrow.
    const tSkip = e.target.closest('[data-today-skip]');
    if (tSkip) {
      try { await store.setDayOverride(state.familyId, state.uid, tSkip.dataset.todaySkip, 'skip'); toast('Skipped for today.'); }
      catch (err) { toast('Could not update — try again.'); }
      return;
    }
    const tMove = e.target.closest('[data-today-move]');
    if (tMove) {
      const q = state.quests.find(x => x.id === tMove.dataset.todayMove);
      // Recompute the target at click time (the daypart may have advanced since
      // render). If there's no genuinely-later slot, don't write a no-op move.
      const win = q ? laterWindowFor(questTimeWindow(q), phaseNow()) : null;
      if (!win) { toast('That’s already as late as today goes.'); return; }
      try { await store.setDayOverride(state.familyId, state.uid, tMove.dataset.todayMove, 'move', win); toast(`Moved to ${WINDOW_LABEL[win] || win} today.`); }
      catch (err) { toast('Could not update — try again.'); }
      return;
    }
    const tNext = e.target.closest('[data-today-next]');
    if (tNext) {
      try { await store.setDayOverride(state.familyId, state.uid, tNext.dataset.todayNext, 'next'); toast('Made next for today.'); }
      catch (err) { toast('Could not update — try again.'); }
      return;
    }
    const tClear = e.target.closest('[data-today-clear]');
    if (tClear) {
      try { await store.clearDayOverride(state.familyId, tClear.dataset.todayClear); toast('Back to normal for today.'); }
      catch (err) { toast('Could not update — try again.'); }
      return;
    }
    if (e.target.closest('[data-today-presets]')) { el('today-different-dialog').showModal(); return; }
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      const kind = preset.dataset.preset;
      try {
        const r = await store.applyTodayPreset(state.familyId, state.uid, kind, state.quests);
        el('today-different-dialog').close();
        toast(kind === 'custom'
          ? 'Choose Skip / Later / Next on each quest below.'
          : (r.skipped ? `Set for today — ${r.skipped} skipped.` : 'Nothing to change for today.'));
      } catch (err) { toast('Could not apply — try again.'); }
      return;
    }

    const needCue = e.target.closest('#c-need-cue');
    if (needCue && needCue.dataset.need) { guideCareNeed(needCue.dataset.need); return; }

    // Family-feedback card controls.
    const fbProgress = e.target.closest('[data-fb-progress]');
    if (fbProgress) { dismissFeedbackCard(fbProgress.closest('.feedback-card')); navChild('log'); return; }
    const fbDismiss = e.target.closest('[data-fb-dismiss]');
    if (fbDismiss) { dismissFeedbackCard(fbDismiss.closest('.feedback-card')); return; }

    // ---- Day/Week ledger navigation (My Progress + Point Ledger) ----
    const historyMode = e.target.closest('[data-history-mode]');
    if (historyMode) { setHistoryMode(historyMode.dataset.historyMode); return; }
    if (e.target.closest('[data-week-current]')) { setWeekAnchor(startOfWeek(localDate())); return; }
    if (e.target.closest('[data-day-prev]')) { setSelectedDate(addDays(state.selectedDate, -1)); return; }
    if (e.target.closest('[data-day-next]')) { setSelectedDate(addDays(state.selectedDate, 1)); return; }
    if (e.target.closest('[data-day-today]')) { setSelectedDate(localDate(), { reanchor: true }); return; }
    if (e.target.closest('[data-week-prev]')) { setWeekAnchor(addDays(state.weekAnchor, -7)); return; }
    if (e.target.closest('[data-week-next]')) { setWeekAnchor(addDays(state.weekAnchor, 7)); return; }
    const pick = e.target.closest('[data-day-pick]');
    if (pick) { setSelectedDate(pick.dataset.dayPick); return; }
    const filter = e.target.closest('[data-day-filter]');
    if (filter) { setDayFilter(filter.dataset.dayFilter); return; }
    const toggle = e.target.closest('[data-txn-toggle]');
    if (toggle) { state.expandedTxn = state.expandedTxn === toggle.dataset.txnToggle ? null : toggle.dataset.txnToggle; renderDayViews(); return; }

    // "Completed today" drawer: drive the open state ourselves so a re-render
    // preserves it. preventDefault stops the native <details> from also toggling.
    const completedToggle = e.target.closest('[data-toggle-completed]');
    if (completedToggle) { e.preventDefault(); state.completedOpen = !state.completedOpen; renderChildQuests(); return; }

    // Focus Mode: enter on one mission / return to the full routine (§8).
    const focusOn = e.target.closest('[data-focus]');
    if (focusOn) { state.focusQuestId = focusOn.dataset.focus; renderChildQuests(); return; }
    const focusExit = e.target.closest('[data-focus-exit]');
    if (focusExit) { state.focusQuestId = null; renderChildQuests(); return; }

    // Expand/collapse a "still needs doing" group; app-controlled so a background
    // re-render can't reset it (like the Completed drawer).
    const stillToggle = e.target.closest('[data-toggle-still]');
    if (stillToggle) {
      e.preventDefault();
      const w = stillToggle.dataset.toggleStill;
      if (state.stillOpen.has(w)) state.stillOpen.delete(w); else state.stillOpen.add(w);
      renderChildQuests();
      return;
    }
    // Anytime "See all" / "Show less".
    const anytimeToggle = e.target.closest('[data-toggle-anytime]');
    if (anytimeToggle) { e.preventDefault(); state.anytimeExpanded = !state.anytimeExpanded; renderChildQuests(); return; }

    const quick = e.target.closest('[data-quick]');
    if (quick) { const note = el('point-note').value.trim(); try { await store.adjustPoints(state.familyId, state.uid, { reasonCode: quick.dataset.quick, note }); const a = QUICK_ACTIONS.find(x=>x.code===quick.dataset.quick); el('point-note').value = ''; toast(`${a.amount>0?'+':''}${a.amount} · ${a.label}`); } catch (err) { toast('Could not save — check connection.'); } return; }

    const train = e.target.closest('[data-train]');
    if (train) { await store.setActiveCat(state.familyId, train.dataset.train); toast(`${CAT_DEFS[train.dataset.train].name} is now training.`); return; }

    const complete = e.target.closest('[data-complete]');
    if (complete) { await handleComplete(complete.dataset.complete); return; }

    // Parent marks a quest done for Sirus from the "On Sirus's screen now" card.
    const sirusDone = e.target.closest('[data-sirus-done]');
    if (sirusDone) {
      const q = state.quests.find(x => x.id === sirusDone.dataset.sirusDone);
      if (!q) return;
      // Approving Sirus's own pending tap is a straight yes (like the approvals
      // card). Crediting a quest he hasn't tapped grants minutes he didn't
      // request, so confirm that one.
      if (!completionStatus(q.id) && !confirm(`Mark “${q.title}” done for Sirus? He’ll get the reward now.`)) return;
      try { await store.parentCompleteQuest(state.familyId, state.uid, q.id); toast('Marked done ⭐'); }
      catch (err) { toast('Could not mark done — try again.'); }
      return;
    }

    const ret = e.target.closest('[data-return-item]');
    if (ret) {
      const item = CAFE_ITEMS[ret.dataset.returnItem];
      if (!confirm(`Return ${item ? item.name : 'this item'} and refund its coins?`)) return;
      try { await store.returnCafeItem(state.familyId, ret.dataset.returnItem); toast('Returned — coins refunded.'); }
      catch (err) { toast(err.message === 'not-owned' ? 'That item is not owned.' : 'Could not return that.'); }
      return;
    }

    const buy = e.target.closest('[data-buy]');
    if (buy) { try { await store.purchaseCafeItem(state.familyId, state.uid, buy.dataset.buy); toast('Added to the café!'); } catch (err) { toast(err.message === 'not-enough-coins' ? 'Not enough coins yet.' : 'Could not buy that.'); } return; }

    // Café mode toggle (cat tap/drag is handled by the pointer flow, not here).
    if (e.target.closest('#c-decorate-btn')) return setCafeMode('decorate');
    if (e.target.closest('#c-done-btn')) return setCafeMode('play');
    if (e.target.closest('#c-undo-btn')) return applyCafeUndo();

    const putaway = e.target.closest('[data-putaway]');
    if (putaway) { try { await store.setCafeItemPlaced(state.familyId, putaway.dataset.putaway, false); toast('Put away.'); } catch (err) { toast('Could not update the café.'); } return; }
    const place = e.target.closest('[data-place]');
    if (place) { try { await store.setCafeItemPlaced(state.familyId, place.dataset.place, true); toast('Placed!'); } catch (err) { toast('Could not update the café.'); } return; }
    // Decorate-tray Place / Store, with one-step undo of that action.
    const placeTray = e.target.closest('[data-place-tray]');
    if (placeTray) { const id = placeTray.dataset.placeTray; try { await store.setCafeItemPlaced(state.familyId, id, true); setCafeUndo({ type: 'store', id }); toast('Placed!'); } catch (err) { toast('Could not update the café.'); } return; }
    const store2 = e.target.closest('[data-store]');
    if (store2) { const id = store2.dataset.store; try { await store.setCafeItemPlaced(state.familyId, id, false); setCafeUndo({ type: 'place', id }); toast('Stored.'); } catch (err) { toast('Could not update the café.'); } return; }

    const delTxn = e.target.closest('[data-del-txn]');
    if (delTxn) {
      if (state.role !== 'parent') return; // deleting a ledger entry is parent-only
      const t = state.recentTxns.find(x => x.id === delTxn.dataset.delTxn);
      if (t && confirm('Delete this entry? Its points will be reversed.')) {
        try { await store.deleteTransaction(state.familyId, state.uid, t); toast('Entry deleted.'); }
        catch (err) { toast('Could not delete — try again.'); }
      }
      return;
    }

    const moveQuest = e.target.closest('[data-move-quest]');
    if (moveQuest) {
      const updates = reorderQuestUpdates(state.quests, moveQuest.dataset.moveQuest, moveQuest.dataset.direction);
      if (!updates.length) return;
      try { await store.reorderQuests(state.familyId, updates); toast('Quest order updated.'); }
      catch (err) { toast('Could not reorder — try again.'); }
      return;
    }

    const duplicate = e.target.closest('[data-duplicate-quest]');
    if (duplicate) {
      const q = state.quests.find(x => x.id === duplicate.dataset.duplicateQuest);
      if (!q) return;
      const nextOrder = Math.max(-1, ...state.quests.map(item => Number(item.order) || 0)) + 1;
      try {
        await store.duplicateQuest(state.familyId, state.uid, q, nextOrder);
        toast('Copy created and paused for review.');
      } catch (err) { toast('Could not duplicate — try again.'); }
      return;
    }

    const archive = e.target.closest('[data-archive-quest]');
    if (archive) {
      const q = state.quests.find(x => x.id === archive.dataset.archiveQuest);
      if (!q || !confirm(`Archive “${q.title}”? You can restore it later.`)) return;
      try { await store.setQuestArchived(state.familyId, state.uid, q.id, true); toast('Quest archived.'); }
      catch (err) { toast('Could not archive — try again.'); }
      return;
    }

    const restore = e.target.closest('[data-restore-quest]');
    if (restore) {
      const q = state.quests.find(x => x.id === restore.dataset.restoreQuest);
      if (!q) return;
      try {
        await store.setQuestArchived(state.familyId, state.uid, q.id, false);
        toast(q.enabled === false ? 'Quest restored — still paused.' : 'Quest restored.');
      } catch (err) { toast('Could not restore — try again.'); }
      return;
    }

    const edit = e.target.closest('[data-edit-quest]'); if (edit) return openQuestDialog(edit.dataset.editQuest);
    const del = e.target.closest('[data-del-quest]');
    if (del) { if (confirm('Permanently delete this QA quest?')) { await store.deleteQuest(state.familyId, del.dataset.delQuest); toast('QA quest deleted.'); } return; }

    const toggleQ = e.target.closest('[data-toggle-quest]');
    if (toggleQ) {
      const q = state.quests.find(x => x.id === toggleQ.dataset.toggleQuest);
      if (!q) return;
      const next = q.enabled === false;
      try { await store.setQuestEnabled(state.familyId, q.id, next); toast(next ? 'Quest resumed.' : 'Quest paused.'); }
      catch (err) { toast('Could not update — try again.'); }
      return;
    }

    const approve = e.target.closest('[data-approve]');
    if (approve) {
      const c = state.pendingApprovals.find(x => x.id === approve.dataset.approve);
      if (!c) return;
      try { await store.approveCompletion(state.familyId, state.uid, c); toast('Approved! ⭐'); }
      catch (err) { toast('Could not approve — try again.'); }
      return;
    }
    const reject = e.target.closest('[data-reject]');
    if (reject) {
      const c = state.pendingApprovals.find(x => x.id === reject.dataset.reject);
      if (!c) return;
      openQuestReturnDialog(c);
      return;
    }

    if (e.target.closest('#add-quest-btn')) return openQuestDialog(null);
    if (e.target.closest('#undo-btn')) {
      const last = state.recentTxns[0];
      if (!last) return toast('Nothing to undo.');
      try { await store.undoLast(state.familyId, state.uid, last); toast('Undone.'); }
      catch (err) { console.error('Undo failed', err); toast('Undo failed — try again.'); }
      return;
    }
    if (e.target.closest('#redeem-btn')) {
      const avail = state.child.available || 0;
      el('redeem-available').textContent = avail;
      const input = el('redeem-minutes');
      input.value = ''; input.max = String(avail); // cap so the picker can't exceed Available
      el('redeem-note').value = '';
      const err = el('redeem-error'); err.hidden = true; err.textContent = '';
      el('redeem-dialog').showModal();
      return;
    }
    if (e.target.closest('#make-code-btn')) return makePairingCode();
    if (e.target.closest('#make-coparent-code-btn')) return makeCoparentCode();
    if (e.target.closest('#signout-btn')) { await signOutUser(); location.reload(); return; }
    if (e.target.closest('#evo-close')) return el('evolution-dialog').close();
  });

  // Native calendar jump (either day view). Future dates are blocked by the
  // input's max, but clamp defensively too.
  document.addEventListener('change', (e) => {
    const cal = e.target.closest('.day-calendar');
    if (cal && cal.value) setSelectedDate(cal.value);

    const questChoice = e.target.closest('[data-select-quest]');
    if (questChoice) {
      if (questChoice.checked) state.questSelection.add(questChoice.dataset.selectQuest);
      else state.questSelection.delete(questChoice.dataset.selectQuest);
      renderQuestBulkToolbar();
      return;
    }

    if (e.target.closest('#quest-bulk-action') || e.target.closest('#quest-bulk-recurrence')) {
      syncQuestBulkDialog();
      return;
    }

    // Needs You batch selection. A single row toggle updates the set; "Select
    // all" checks/unchecks every pending row. Re-render so the "Approve N
    // selected" button count and the select-all state stay in sync.
    const selBox = e.target.closest('[data-approve-sel]');
    if (selBox) {
      const id = selBox.dataset.approveSel;
      if (selBox.checked) state.approveSel.add(id); else state.approveSel.delete(id);
      renderParentToday();
      return;
    }
    const selAll = e.target.closest('[data-approve-selall]');
    if (selAll) {
      const ids = (state.pendingApprovals || []).map(c => c.id);
      if (selAll.checked) ids.forEach(id => state.approveSel.add(id));
      else ids.forEach(id => state.approveSel.delete(id));
      renderParentToday();
      return;
    }
  });

  // Deliver any waiting recognition the moment Sirus returns to the tab, so a
  // point earned while he was away shows once he's actually present (§7.3). Also
  // catch a date rollover that happened while the tab was backgrounded (a device
  // left open overnight), so returning to it doesn't show yesterday's plan.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    processFeedback();
    checkDayRollover();
  });

  // Keyboard access for expanding a ledger row (rows are role="button").
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const toggle = e.target.closest('[data-txn-toggle]');
    if (!toggle) return;
    e.preventDefault();
    state.expandedTxn = state.expandedTxn === toggle.dataset.txnToggle ? null : toggle.dataset.txnToggle;
    renderDayViews();
  });

  el('signin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('signin-note').textContent = 'Signing in…';
    try {
      const user = await parentSignIn(el('signin-email').value.trim(), el('signin-password').value);
      // Owner path: first sign-in creates the family; later ones are a no-op.
      await store.setupFamily(user.uid, { parentName: 'Mom' });
      rememberDeviceRole('parent', user.uid, 'Mom', user.uid);
      await enterParent(user.uid, user, 'Mom');
    } catch (err) { el('signin-note').textContent = friendlyAuthError(err); }
  });
  el('coparent-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('coparent-note').textContent = 'Signing in…';
    try {
      const user = await parentSignIn(el('coparent-email').value.trim(), el('coparent-password').value);
      // If THIS account has already joined on THIS device, no code is needed.
      // (uid match guards against a shared device remembering a different parent.)
      let fid = (deviceRole() === 'parent' && deviceUid() === user.uid && deviceFamilyId())
        ? deviceFamilyId() : null;
      if (!fid) {
        const code = el('coparent-code').value.trim();
        if (!code) { el('coparent-note').textContent = 'Ask Mom for an invite code (needed the first time).'; return; }
        fid = await store.joinFamilyAsParent(user.uid, code, 'Abba');
      }
      rememberDeviceRole('parent', fid, 'Abba', user.uid);
      await enterParent(fid, user, 'Abba');
    } catch (err) {
      // Auth errors have a .code; join errors are plain messages we wrote.
      el('coparent-note').textContent = err && err.code ? friendlyAuthError(err) : (err && err.message) || 'Could not sign in.';
    }
  });
  el('pair-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = el('pair-code').value.trim();
    try {
      const user = await signInChildDevice();
      const fid = await store.joinWithPairingCode(user.uid, code);
      rememberDeviceRole('child', fid);
      enterChild(fid, user.uid);
    } catch (err) { el('pair-note').textContent = err.message; }
  });
  el('redeem-confirm').addEventListener('click', async (e) => {
    const mins = Number(el('redeem-minutes').value) || 0;
    const note = el('redeem-note').value.trim();
    const avail = (state.child && state.child.available) || 0;
    const err = el('redeem-error');
    // Block an over-limit request instead of silently clamping it (§10.3). The
    // button lives in a method="dialog" form, so preventDefault keeps the dialog
    // open on an invalid value.
    if (mins <= 0) { e.preventDefault(); err.textContent = 'Enter how many minutes were used.'; err.hidden = false; return; }
    if (mins > avail) { e.preventDefault(); err.textContent = `Only ${avail} minutes are available right now.`; err.hidden = false; return; }
    try {
      await store.redeemScreenTime(state.familyId, state.uid, mins, { note });
      el('redeem-note').value = '';
      toast(`Recorded ${mins} min used.`);
    } catch (ex) {
      // A concurrent change dropped the balance between opening and confirming.
      e.preventDefault();
      const max = typeof ex.available === 'number' ? ex.available : avail;
      err.textContent = `Only ${max} minutes are available right now.`;
      err.hidden = false;
    }
  });
  el('custom-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = Number(el('custom-amount').value) || 0;
    const reason = el('point-note').value.trim() || 'Custom adjustment';
    if (!amount) return;
    try {
      await store.adjustPoints(state.familyId, state.uid, { amount, reasonLabel: reason });
      toast(`${amount > 0 ? '+' : ''}${amount} · ${reason}`);
      el('point-note').value = '';
    } catch (err) { toast('Could not save — check connection.'); }
  });
  el('quest-save').addEventListener('click', saveQuestFromDialog);
  el('q-recurrence').addEventListener('change', syncQuestDaysRow);
  initCafeInteractions();
}

async function handleComplete(questId) {
  try {
    const result = await store.completeQuest(state.familyId, state.uid, questId);
    // Immediate win even though the minutes are gated: celebrate + buzz so the
    // tap feels great; the reward then stacks in the "waiting for Mom" pile.
    confettiBurst();
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
    toast(result && result.careChargeGranted
      ? 'Nice one! +1 Care Charge · Sent to Mom'
      : 'Nice one! Care Charges are full · Sent to Mom');
  }
  catch (err) {
    if (err.message === 'already-completed') toast('Already done today!');
    else toast('Could not complete — check connection.');
  }
}

let editingQuestId = null;
function syncQuestDaysRow() {
  const type = el('q-recurrence').value;
  el('q-days-row').hidden = type !== 'selected_days';
  el('q-once-row').hidden = type !== 'one_time';
}
function openQuestDialog(id) {
  editingQuestId = id;
  const q = id ? state.quests.find(x => x.id === id) : null;
  el('quest-dialog-title').textContent = id ? 'Edit quest' : 'Add quest';
  el('q-title').value = q ? q.title : '';
  el('q-section').value = q ? q.section : 'Morning';
  // Routine fields fall back to Slice 1's read-time derivation for legacy quests,
  // so opening an unedited quest shows its effective window/schedule; saving then
  // persists them explicitly (write-on-edit — no bulk backfill).
  el('q-window').value = q ? questTimeWindow(q) : 'morning';
  el('q-essential').checked = q ? questIsDailyEssential(q) : false;
  const rec = q ? questRecurrence(q) : { type: 'everyday' };
  el('q-recurrence').value = rec.type;
  const days = new Set(rec.type === 'selected_days' && Array.isArray(rec.days) ? rec.days : []);
  document.querySelectorAll('.q-day').forEach(cb => { cb.checked = days.has(cb.value); });
  el('q-once-date').value = rec.type === 'one_time' && rec.date ? rec.date : localDate();
  syncQuestDaysRow();
  el('q-points').value = q ? q.points : 1;
  el('q-brain').value = q ? q.brain : 0;
  el('q-energy').value = q ? q.energy : 1;
  el('q-coins').value = q ? q.coins : 1;
  el('q-enabled').checked = q ? q.enabled !== false : true;
  el('quest-dialog').showModal();
}
function recurrenceFromDialog() {
  const type = el('q-recurrence').value;
  if (type === 'selected_days') {
    const days = [...document.querySelectorAll('.q-day')].filter(cb => cb.checked).map(cb => cb.value);
    // No days chosen degrades to everyday rather than an unreachable quest.
    return days.length ? { type: 'selected_days', days } : { type: 'everyday' };
  }
  if (type === 'one_time') {
    const date = el('q-once-date').value;
    // A one-time quest needs a date to ever be scheduled; without one, fall back
    // to everyday rather than persist a quest that shows on no day at all.
    return date ? { type: 'one_time', date } : { type: 'everyday' };
  }
  return { type };
}
async function saveQuestFromDialog() {
  const title = el('q-title').value.trim(); if (!title) return;
  const existing = editingQuestId ? state.quests.find(x => x.id === editingQuestId) : null;
  const timeWindow = el('q-window').value;
  const quest = {
    id: editingQuestId || `q-${Date.now()}`,
    title, section: el('q-section').value,
    points: Number(el('q-points').value) || 0,
    brain: Math.max(0, Number(el('q-brain').value) || 0),
    energy: Math.max(0, Number(el('q-energy').value) || 0),
    coins: Math.max(0, Number(el('q-coins').value) || 0),
    enabled: el('q-enabled').checked,
    order: existing ? existing.order : state.quests.length,
    // Explicit §18 routine fields, persisted on every save (write-on-edit).
    timeWindow,
    routineId: timeWindow,
    isDailyEssential: el('q-essential').checked,
    recurrence: recurrenceFromDialog()
  };
  await store.saveQuest(state.familyId, quest);
  toast(editingQuestId ? 'Quest updated.' : 'Quest added.');
}

// Codes are single-use and expire after PAIRING_TTL_MINUTES, so the display
// says so plainly — "it stopped working" should read as expected, not broken.
async function makePairingCode() {
  const code = await store.createPairingCode(state.familyId, state.uid);
  const disp = el('pair-code-display'); disp.hidden = false;
  disp.innerHTML = `<strong data-testid="pair-code-value">${esc(code)}</strong>
    <small class="code-expiry">Works once · expires in ${PAIRING_TTL_MINUTES} minutes</small>`;
  toast('Enter this code on the tablet.');
}

async function makeCoparentCode() {
  const code = await store.createParentInviteCode(state.familyId, state.uid);
  const disp = el('coparent-code-display'); disp.hidden = false;
  disp.innerHTML = `<strong data-testid="coparent-code-value">${esc(code)}</strong>
    <small class="code-expiry">Works once · expires in ${PAIRING_TTL_MINUTES} minutes</small>`;
  toast('Give this code to Abba.');
}

// ---- Role gate + boot -------------------------------------------------------
function chooseRole(choice) {
  if (choice === 'back') return showGateScreen('gate');
  el('gate-note').textContent = '';
  if (choice === 'parent') return showGateScreen('parent-signin');
  if (choice === 'coparent') return showGateScreen('coparent-signin');
  showGateScreen('child-pair');
}

async function boot() {
  if (!isConfigured) { el('gate-note').textContent = 'Setup not finished yet.'; return; }
  bindEvents();

  await onAuth(async (user) => {
    if (!user) {
      // Firebase resolves "signed out" a beat AFTER the page loads (it has to
      // fetch the SDK first). By then the person may already have tapped a role
      // and started typing, so resetting unconditionally yanks them back to the
      // gate mid-sign-in — worst on the slow connections that need it least.
      // Only reset when we're not already on a gate screen, which still covers
      // the case this exists for: signing out from inside the app.
      const active = document.querySelector('[data-screen].active');
      if (!active || active.dataset.screen === 'gate') showGateScreen('gate');
      return;
    }
    if (user.isAnonymous) {
      const fid = deviceFamilyId();
      if (fid && deviceRole() === 'child') enterChild(fid, user.uid);
      return; // otherwise, waiting for the pairing form to complete
    }
    // A signed-in parent (Mom or Abba). If this device already knows their
    // family, route them straight in. First-time create/join is handled by the
    // sign-in forms, so a brand-new account with no device memory falls through
    // and waits for the form to finish.
    const fid = deviceFamilyId();
    const rememberedUid = deviceUid();
    // Route only if this device's memory belongs to the account signing in.
    // Legacy installs stored no uid — treat that as a match so Mom isn't logged
    // out by this update; we backfill the uid below.
    const sameAccount = !rememberedUid || rememberedUid === user.uid;
    if (deviceRole() === 'parent' && fid && sameAccount) {
      try {
        // Only the owner (familyId == their own uid) needs setup; a co-parent
        // must never create a second family.
        if (fid === user.uid) await store.setupFamily(user.uid, { parentName: 'Mom' });
        rememberDeviceRole('parent', fid, deviceParentName(), user.uid);
        await enterParent(fid, user, deviceParentName());
      } catch (err) {
        console.error('Parent enter failed', err);
        el('signin-note').textContent = 'Sign-in error: ' + (err && err.message || err);
      }
    }
  });
}

boot();
