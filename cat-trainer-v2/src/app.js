// Cat Trainer — app orchestrator. Wires auth + role gate to the synced store and
// renders Mom's dashboard and Sirus's game screens from live data.

import { isConfigured } from './firebase.js?v=e3b3c5da';
import {
  parentSignIn, friendlyAuthError, signInChildDevice,
  onAuth, signOutUser, rememberDeviceRole, deviceRole, deviceFamilyId, deviceParentName, deviceUid
} from './auth.js?v=e3b3c5da';
import * as store from './store.js?v=e3b3c5da';
import { CAT_DEFS } from './data/cats.js?v=e3b3c5da';
import { SECTIONS, SECTION_META } from './data/quests.js?v=e3b3c5da';
import { CAFE_ITEMS, CAFE_ROOM_ART } from './data/cafe-items.js?v=e3b3c5da';
import {
  cafeActionFor, catDestinationForObject, catDestinationForTap,
  firstCafeDecorElement, catWalkDuration
} from './cafe-interactions.js?v=e3b3c5da';
import {
  CARE_CONFIG, CARE_NEEDS, careCharges, displayNeedValue, isNeedFull,
  lowestCareNeed, needsAt
} from './care.js?v=e3b3c5da';
import { QUICK_ACTIONS, HERO_THRESHOLD, QUEST_BOND, isHeroReady } from './shared/rewards.js?v=e3b3c5da';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));

const state = {
  role: null, familyId: null, uid: null,
  child: null, cats: {}, quests: [], ownedItems: [], todayCompletions: [], recentTxns: [],
  pendingApprovals: [], prevEvolved: {}, prevCompletions: {}, unsub: null
};

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
  showShell('child'); navChild('home');
  await subscribeAll();
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
    onTodayCompletions: (t) => { detectApproval(t); state.todayCompletions = t; renderAll(); },
    onPendingApprovals: (p) => { state.pendingApprovals = p; renderAll(); },
    onRecentTxns: (t) => { state.recentTxns = t; renderAll(); }
  });
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
      toast(`Mom said yes! +${mins}m ⭐`);
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
  el('evo-copy').textContent = `${d.name} balanced Brain and Energy and became ${d.heroTitle}.`;
  el('evolution-dialog').showModal();
  const card = el('evolution-dialog').querySelector('.modal-card');
  spawnFx('assets/fx-starburst.png', card, { count: 1, cx: 50, cy: 42, spread: 0, size: 220, life: 900, mode: 'pop' });
  spawnFx('assets/fx-confetti.png', card, { count: 8, cx: 50, cy: 8, spread: 40, size: 40, life: 1500, mode: 'fall' });
}

// ---- Rendering --------------------------------------------------------------
function renderAll() {
  if (!state.child) return;
  if (state.role === 'parent') { renderApprovals(); renderParentDash(); renderLedger(); renderSirusToday(); renderParentQuests(); renderParentCats(); renderParentCafe(); }
  else { renderChildHome(); renderChildQuests(); renderChildCats(); renderChildCafe(); renderChildLog(); }
}

function ledgerRow(t, deletable = false) {
  const cls = t.amount >= 0 ? 'plus' : 'minus';
  const sign = t.amount >= 0 ? '+' : '';
  const del = deletable ? `<button class="icon-btn del-txn" data-del-txn="${esc(t.id)}" aria-label="Delete this entry">🗑️</button>` : '';
  const note = t.note ? `<small class="ledger-note">${esc(t.note)}</small>` : '';
  return `<div class="ledger-item"><span class="ledger-delta ${cls}">${sign}${t.amount}</span>
    <div class="ledger-text"><p>${esc(t.reasonLabel || '')}</p>${note}</div><time>${esc(t.timeLabel || '')}</time>${del}</div>`;
}

function renderQuickActions() {
  el('quick-actions').innerHTML = QUICK_ACTIONS.map(a =>
    `<button class="adjust ${a.tone}" data-quick="${a.code}">${a.amount > 0 ? '+' : ''}${a.amount}<small>${esc(a.label)}</small></button>`
  ).join('');
}

function renderParentDash() {
  el('p-available').textContent = state.child.available || 0;
  const { earned, spent } = store.todayTotals(state.recentTxns);
  el('p-earned').textContent = earned;
  el('p-spent').textContent = spent;
  const rows = state.recentTxns.slice(0, 6);
  el('dash-ledger').innerHTML = rows.length ? rows.map(t => ledgerRow(t, true)).join('') : '<div class="empty">No activity yet today.</div>';
}
function renderLedger() {
  el('full-ledger').innerHTML = state.recentTxns.length ? state.recentTxns.map(t => ledgerRow(t, true)).join('') : '<div class="empty">No point changes yet.</div>';
}
// Live mirror of what's on Sirus's tablet right now, so Mom can see his quest
// progress without picking up his device. Shows only enabled quests (the ones he
// actually sees), each with a To do / Waiting / Done status chip.
function renderSirusToday() {
  const box = el('sirus-today');
  if (!box) return;
  const active = state.quests
    .filter(q => q.enabled !== false)
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
    return `<div class="sirus-today-row"><div class="q-body"><strong>${esc(q.title)}</strong>
      <br><small>${tag}${esc(q.section)}${note}</small></div>${action}</div>`;
  }).join('') || '<div class="empty">Turn on a quest below and it\'ll show here.</div>';
}
function parentQuestRow(q) {
  const on = q.enabled !== false;
  // Section is now the group header, so the row's small line drops it and just
  // shows the reward breakdown.
  return `<div class="parent-quest-row ${on?'':'quest-off'}"><div class="q-body"><strong>${esc(q.title)}</strong>
    <br><small>+${q.points}m ${q.brain?'· ★'+q.brain:''} ${q.energy?'· ⚡'+q.energy:''} · ♥${QUEST_BOND} ${q.coins?'· 🪙'+q.coins:''}</small></div>
    <button class="lock-toggle ${on?'on':'off'}" data-toggle-quest="${esc(q.id)}" role="switch" aria-checked="${on}" aria-label="${on?'On — tap to lock off':'Off — tap to turn on'}">${on?'On':'🔒 Off'}</button>
    <button class="icon-btn" data-edit-quest="${esc(q.id)}">✎</button>
    <button class="icon-btn" data-del-quest="${esc(q.id)}">×</button></div>`;
}
function renderParentQuests() {
  const quests = state.quests.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // Group the management list under collapsible section headers so Mom can scan
  // (and collapse) Morning / Tidy / etc. instead of reading the section tag on
  // every flat row. Known sections keep their canonical order; any custom
  // section falls in after them.
  const known = SECTIONS.filter(s => quests.some(q => q.section === s));
  const custom = [...new Set(quests.map(q => q.section))].filter(s => !SECTIONS.includes(s));
  const html = [...known, ...custom].map(section => {
    const qs = quests.filter(q => q.section === section);
    const meta = SECTION_META[section] || { glyph: '•' };
    const icon = meta.icon ? `<img src="${meta.icon}" alt="">` : `<span class="section-glyph">${meta.glyph}</span>`;
    const onCount = qs.filter(q => q.enabled !== false).length;
    return `<details class="quest-section" open><summary>
      <span class="qs-head">${icon}${esc(section)}</span>
      <span class="qs-count">${onCount}/${qs.length} on</span></summary>
      <div class="qs-body">${qs.map(parentQuestRow).join('')}</div></details>`;
  }).join('');
  el('parent-quests').innerHTML = html || '<div class="empty">No quests yet.</div>';
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
    return `<div class="approval-row"><div class="q-body"><strong>${esc(title)}</strong><br><small>${reward}</small></div>
      <button class="pill-btn reject" data-reject="${esc(c.id)}" aria-label="Reject ${esc(title)}">✕</button>
      <button class="pill-btn approve" data-approve="${esc(c.id)}" aria-label="Approve ${esc(title)}">✓ Approve</button></div>`;
  }).join('') || '<div class="empty">Nothing waiting — all caught up!</div>';
}
function catCardHtml(id, canTrain) {
  const def = CAT_DEFS[id]; const cat = state.cats[id] || { brain:0, energy:0, bond:0, evolved:false };
  const active = state.child.activeCatId === id;
  return `<article class="cat-card ${active?'active':''}">${cat.evolved?'<span class="hero-badge">HERO</span>':''}
    <img src="${cat.evolved?def.heroArt:def.art}" alt="${esc(def.name)}">
    <h3>${esc(cat.evolved?def.heroName:def.name)}</h3>
    <p class="sub">★${cat.brain||0}/12 · ⚡${cat.energy||0}/12 · ♥${cat.bond||0}/20</p>
    ${canTrain?`<button class="wide-button" data-train="${id}" ${active?'disabled':''}>${active?'Training':'Train this cat'}</button>`:''}</article>`;
}
function renderParentCats() { el('parent-cats').innerHTML = Object.keys(CAT_DEFS).map(id => catCardHtml(id, false)).join(''); }
function renderParentCafe() {
  el('parent-cafe').innerHTML = `<p class="muted">Sirus decorates the café with Cat Coins. Owned: ${state.ownedItems.length} item(s).</p>`;
}

// ----- Child -----
function meter(barId, valId, value, max) {
  el(barId).style.width = `${Math.min(100, (value / max) * 100)}%`;
  el(valId).textContent = `${value}/${max}`;
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
  if (cat.evolved) el('c-hero-hint').textContent = `${def.heroName} — Hero Form!`;
  else {
    const nb = Math.max(0, HERO_THRESHOLD.brain - (cat.brain||0));
    const ne = Math.max(0, HERO_THRESHOLD.energy - (cat.energy||0));
    el('c-hero-hint').textContent = `Hero Form needs ${nb} more Brain and ${ne} more Energy.`;
  }
  const next = state.quests.filter(q => q.enabled !== false && !completionStatus(q.id)).slice(0, 3);
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
  return `<div class="quest-card ${cls}"><div class="q-body"><div class="q-title">${esc(q.title)}</div>
    <div class="q-reward">${reward}</div>
    ${status==='pending'?'<div class="q-status">Done! Waiting for Mom ⭐</div>':''}</div>
    ${btn}</div>`;
}
function renderChildQuests() {
  const active = state.quests.filter(q => q.enabled !== false);
  // "Available" = still actionable today. Anything Sirus has already tapped
  // (waiting for Mom or approved) drops into the collapsed drawer so he never
  // has to scroll past finished quests to find what's next.
  const available = active.filter(q => !completionStatus(q.id));
  const finished = active.filter(q => completionStatus(q.id));

  const groups = SECTIONS.map(section => {
    const qs = available.filter(q => q.section === section);
    if (!qs.length) return '';
    const meta = SECTION_META[section] || { glyph: '•' };
    const icon = meta.icon ? `<img src="${meta.icon}" alt="">` : `<span class="section-glyph">${meta.glyph}</span>`;
    return `<div class="quest-group"><h3>${icon}${esc(section)}</h3>${qs.map(childQuestCard).join('')}</div>`;
  }).join('');

  const availableHtml = groups || (finished.length
    ? '<div class="empty">All done — great job! 🎉</div>'
    : '<div class="empty">No quests yet.</div>');

  const finishedHtml = finished.length
    ? `<details class="completed-quests"><summary>✓ Completed today <span class="done-count">${finished.length}</span></summary>
        <div class="completed-body">${finished.map(childQuestCard).join('')}</div></details>`
    : '';

  el('c-quests').innerHTML = availableHtml + finishedHtml;
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
let catState = 'idle';     // idle | glance | react | dragged | approach | eat | drink | play | sleep
let catStateTimer = null;  // duration of the current transient state
let catBeatTimer = null;   // schedules the next autonomous idle beat
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
// Idle life uses the new blink/play frames plus CSS micro-motion. Walk frames are
// available for Slice 3 object approaches, but autonomous travel stays disabled
// until movement has a destination and interruption rules.
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
      // autonomous play beat while one of its daily needs is low.
      if (roll < 0.6) catBlink();
      else catWiggle();
    } else if (roll < 0.35) catBlink();    // a slow blink (animated if frames exist)
    else if (roll < 0.6) catWiggle();      // a little shimmy in place
    else if (roll < 0.85) catPlayBeat();   // bat at a toy, then settle
    else catHop();                         // a happy hop
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
function renderChildLog() {
  // Sirus's log is read-only: render without the delete control. Wrap in an
  // arrow so Array.map's index isn't passed as `deletable` (that leaked the
  // parent-only 🗑️ onto every row past the newest).
  el('c-log').innerHTML = state.recentTxns.length ? state.recentTxns.map(t => ledgerRow(t)).join('') : '<div class="empty">Complete a quest to start your log!</div>';
}

// ---- Events -----------------------------------------------------------------
function bindEvents() {
  document.addEventListener('click', async (e) => {
    const role = e.target.closest('[data-choose-role]');
    if (role) return chooseRole(role.dataset.chooseRole);
    const pgo = e.target.closest('[data-pgo]'); if (pgo) return navParent(pgo.dataset.pgo);
    const cgo = e.target.closest('[data-cgo]'); if (cgo) return navChild(cgo.dataset.cgo);

    const needCue = e.target.closest('#c-need-cue');
    if (needCue && needCue.dataset.need) { guideCareNeed(needCue.dataset.need); return; }

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

    const edit = e.target.closest('[data-edit-quest]'); if (edit) return openQuestDialog(edit.dataset.editQuest);
    const del = e.target.closest('[data-del-quest]');
    if (del) { if (confirm('Delete this quest?')) { await store.deleteQuest(state.familyId, del.dataset.delQuest); toast('Quest deleted.'); } return; }

    const toggleQ = e.target.closest('[data-toggle-quest]');
    if (toggleQ) {
      const q = state.quests.find(x => x.id === toggleQ.dataset.toggleQuest);
      if (!q) return;
      const next = q.enabled === false; // currently off → turn on; currently on → lock off
      try { await store.setQuestEnabled(state.familyId, q.id, next); toast(next ? 'Task on for Sirus.' : '🔒 Task locked off.'); }
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
      const title = (c && c.questTitle) || 'this quest';
      if (confirm(`Reject “${title}”? The points disappear and the quest is given back to Sirus to do again.`)) {
        try { await store.rejectCompletion(state.familyId, c.id); toast('Sent back to Sirus.'); }
        catch (err) { toast('Could not reject — try again.'); }
      }
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
    if (e.target.closest('#redeem-btn')) { el('redeem-available').textContent = state.child.available||0; el('redeem-minutes').value=''; el('redeem-note').value=''; el('redeem-dialog').showModal(); return; }
    if (e.target.closest('#make-code-btn')) return makePairingCode();
    if (e.target.closest('#make-coparent-code-btn')) return makeCoparentCode();
    if (e.target.closest('#signout-btn')) { await signOutUser(); location.reload(); return; }
    if (e.target.closest('#evo-close')) return el('evolution-dialog').close();
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
  el('redeem-confirm').addEventListener('click', async () => {
    const mins = Number(el('redeem-minutes').value) || 0;
    const note = el('redeem-note').value.trim();
    if (mins > 0) { await store.redeemScreenTime(state.familyId, state.uid, mins, { note }); el('redeem-note').value = ''; toast(`Recorded ${mins} min used.`); }
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
function openQuestDialog(id) {
  editingQuestId = id;
  const q = id ? state.quests.find(x => x.id === id) : null;
  el('quest-dialog-title').textContent = id ? 'Edit quest' : 'Add quest';
  el('q-title').value = q ? q.title : '';
  el('q-section').value = q ? q.section : 'Morning';
  el('q-points').value = q ? q.points : 1;
  el('q-brain').value = q ? q.brain : 0;
  el('q-energy').value = q ? q.energy : 1;
  el('q-coins').value = q ? q.coins : 1;
  el('q-enabled').checked = q ? q.enabled !== false : true;
  el('quest-dialog').showModal();
}
async function saveQuestFromDialog() {
  const title = el('q-title').value.trim(); if (!title) return;
  const existing = editingQuestId ? state.quests.find(x => x.id === editingQuestId) : null;
  const quest = {
    id: editingQuestId || `q-${Date.now()}`,
    title, section: el('q-section').value,
    points: Number(el('q-points').value) || 0,
    brain: Math.max(0, Number(el('q-brain').value) || 0),
    energy: Math.max(0, Number(el('q-energy').value) || 0),
    coins: Math.max(0, Number(el('q-coins').value) || 0),
    enabled: el('q-enabled').checked,
    order: existing ? existing.order : state.quests.length
  };
  await store.saveQuest(state.familyId, quest);
  toast(editingQuestId ? 'Quest updated.' : 'Quest added.');
}

async function makePairingCode() {
  const code = await store.createPairingCode(state.familyId);
  const disp = el('pair-code-display'); disp.hidden = false; disp.textContent = code;
  toast('Enter this code on the tablet.');
}

async function makeCoparentCode() {
  const code = await store.createParentInviteCode(state.familyId);
  const disp = el('coparent-code-display'); disp.hidden = false; disp.textContent = code;
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
    if (!user) { showGateScreen('gate'); return; }
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
