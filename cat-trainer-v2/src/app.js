// Cat Trainer — app orchestrator. Wires auth + role gate to the synced store and
// renders Mom's dashboard and Sirus's game screens from live data.

import { isConfigured } from './firebase.js?v=e08bf3c9';
import {
  parentSignIn, friendlyAuthError, signInChildDevice,
  onAuth, signOutUser, rememberDeviceRole, deviceRole, deviceFamilyId, deviceParentName, deviceUid
} from './auth.js?v=e08bf3c9';
import * as store from './store.js?v=e08bf3c9';
import { CAT_DEFS } from './data/cats.js?v=e08bf3c9';
import { SECTIONS, SECTION_META } from './data/quests.js?v=e08bf3c9';
import { CAFE_ITEMS, CAFE_ROOM_ART } from './data/cafe-items.js?v=e08bf3c9';
import { QUICK_ACTIONS, HERO_THRESHOLD, QUEST_BOND, isHeroReady } from './shared/rewards.js?v=e08bf3c9';

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
  // Leaving the café always drops back to Play mode (never reopen mid-arrange).
  if (name !== 'cafe' && cafeMode !== 'play') { cafeMode = 'play'; cafeUndo = null; updateCafeModeUI(); }
  if (name === 'cafe') catWelcomeBack();
  window.scrollTo(0, 0);
}

// ---- Entering an app --------------------------------------------------------
async function enterParent(familyId, user, name) {
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
  const reward = `+${q.points}m ${q.brain?'· ★'+q.brain:''} ${q.energy?'· ⚡'+q.energy:''} · ♥${QUEST_BOND} ${q.coins?'· 🪙'+q.coins:''}`;
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
  cafeMode = mode;
  cafeUndo = null;
  updateCafeModeUI();
  renderChildCafe();
}
function updateCafeModeUI() {
  const decorating = cafeMode === 'decorate';
  const room = el('c-cafe-room'); if (room) room.classList.toggle('decorate', decorating);
  const screen = document.querySelector('[data-cscreen="cafe"]'); if (screen) screen.classList.toggle('decorating', decorating);
  const decorateBtn = el('c-decorate-btn'); if (decorateBtn) decorateBtn.hidden = decorating;
  const actions = el('c-decorate-actions'); if (actions) actions.hidden = !decorating;
  const tray = el('c-tray'); if (tray) tray.hidden = !decorating;
  updateCafeUndoBtn();
  const hint = el('c-cafe-hint');
  if (hint) hint.textContent = decorating
    ? 'Drag things to arrange · use the tray to add or store · Undo fixes a mistake'
    : 'Tap the cat to say hi · drag it to move it around';
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
// The cat's resting base position (left %) — a saved spot if Sirus moved it, else
// the room's default. Used so autonomous strolls return to where he left the cat
// The café cat's resting look. It stays awake (sitting) by default and gets
// bright and bouncy after a quest. Sleep is NOT tied to the training Energy stat
// anymore (that stat is near zero early on, which made the cat look asleep almost
// always) — real sleep/napping will come from the Rest care-need in Slice 4.
function catMood() {
  const id = state.child.activeCatId; const cat = state.cats[id] || {};
  if (cat.evolved) return { pose: null, cls: 'mood-happy' };
  const happyToday = (state.todayCompletions && state.todayCompletions.length > 0) || (cat.bond || 0) >= 12;
  return happyToday ? { pose: 'sit', cls: 'mood-happy' } : { pose: 'sit', cls: 'mood-calm' };
}
// ---- Café cat behavior: one state, one timer -------------------------------
// A single owner for what the cat is doing. Every transition cancels the pending
// timer, so a stale beat can never override a newer action — the root cause of
// the old "snap back to center / revert the pose" bug (a 900ms settle timer and
// a separate stroll-return timer both fighting whatever was happening now).
let catTapCount = 0;
let catState = 'idle';     // idle | glance | react | dragged
let catStateTimer = null;  // duration of the current transient state
let catBeatTimer = null;   // schedules the next autonomous idle beat
let catAnimTimer = null;   // frame-swap loop for multi-frame poses (eat/play/walk)
// Art for a café pose. If the cat is "sleeping" and owns + placed its own bed,
// it naps ON that bed (the cat-on-bed art) instead of the plain curled pose.
function cafePoseArt(def, poseKey) {
  if (!def.poses) return def.art;
  if (poseKey === 'sleep' && def.bedItemId && def.bedPose) {
    const rec = ownedCafeRecord(def.bedItemId);
    if (rec && rec.placed !== false) return def.bedPose;
  }
  return def.poses[poseKey];
}

function renderChildCafe() {
  el('c-coins').textContent = state.child.coins || 0;
  const id = state.child.activeCatId; const cat = state.cats[id] || {}; const def = CAT_DEFS[id];
  el('c-cafe-room').style.backgroundImage = `url("${CAFE_ROOM_ART}")`;
  const mood = catMood();
  const wrap = el('c-cafe-cat-wrap');
  if (wrap) wrap.className = `cafe-cat-wrap ${mood.cls}`;
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
      return `<img class="cafe-decor" src="${item.art}" alt="${esc(item.name)}" data-decor="${o.id}"
        style="left:${x}%;top:${y}%" draggable="false">`;
    }).join('');
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
      wrap.style.transition = 'none'; // the wrap normally eases `left`; snap to the finger while dragging
      clearTimeout(catStateTimer); catState = 'dragged'; // a grab beats any pending beat
      cafeDrag = { kind: 'cat', el: wrap, catEl: cat, rect: room.getBoundingClientRect(),
                   grabX: e.clientX, grabY: e.clientY, moved: false };
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
      if (d.moved && d.lastX != null) {
        const x = round(d.lastX), y = round(d.lastY);
        if (state.child) state.child.cafeCat = { x, y }; // optimistic: no snap-back before the write lands
        try { await store.moveCafeCat(state.familyId, x, y); }
        catch (_) { toast('Could not save that move.'); renderChildCafe(); }
      } else {
        reactCat(e); // a tap, not a drag → pet/react
      }
    }
  };
  room.addEventListener('pointerup', endDrag);
  room.addEventListener('pointercancel', endDrag);
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
  const { cat, def, catEl } = catCtx();
  clearInterval(catAnimTimer); // stop any frame loop so it can't outlive its state
  if (catEl) catEl.src = catRestPoseSrc(cat, def);
  catState = 'idle';
}
// Enter a transient state for `ms`, then run `onEnd` (default: settle to rest).
// Cancels any pending transition first, so the newest action always wins.
function catTransient(next, ms, onEnd) {
  clearTimeout(catStateTimer);
  catState = next;
  catStateTimer = setTimeout(onEnd || settleCatToRest, ms);
}
// Animate a multi-frame pose (eat/play/walk) by cycling its frames. Falls back to
// the single pose frame when that pose has no `frames[]` entry or reduced-motion
// is on — so this is safe to call before the -b frame art exists.
function playSprite(poseKey, { fps = 3, holdMs = 0 } = {}) {
  const { cat, def, catEl } = catCtx();
  clearInterval(catAnimTimer);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const frames = !cat.evolved && def.frames && def.frames[poseKey];
  if (!frames || frames.length < 2 || reduce) { catEl.src = cafePoseArt(def, poseKey); return; }
  let i = 0; catEl.src = frames[0];
  catAnimTimer = setInterval(() => { i = (i + 1) % frames.length; catEl.src = frames[i]; }, Math.round(1000 / fps));
  if (holdMs) setTimeout(() => clearInterval(catAnimTimer), holdMs);
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
    catEl.src = cafePoseArt(def, (catTapCount % 2) ? 'play' : 'celebrate');
    catTransient('react', 2600);
  } else {
    catTransient('react', 1600);
  }
}

// ---- Autonomous behavior: the cat lives on its own between taps -------------
// We only have single-frame sprites — no walk cycle — so "life" comes from CSS
// micro-motion (a wiggle or a little hop on the still sprite) and the occasional
// brief pose swap to the play frame. No sliding across the floor (that reads as
// gliding without a walk animation), and the cat stays where Sirus left it.
function catPlayBeat() {
  const { cat, def } = catCtx();
  if (cat.evolved || !def.poses) return catHop();
  playSprite('play');   // animated bat if the play frames exist, else the single pose
  catTransient('glance', 900);
}
function catHop() {
  const { catEl } = catCtx();
  catEl.classList.remove('react'); void catEl.offsetWidth; catEl.classList.add('react');
  catTransient('glance', 600, () => { catState = 'idle'; });
}
function catWiggle() {
  const { catEl } = catCtx();
  catEl.classList.remove('react-wiggle'); void catEl.offsetWidth; catEl.classList.add('react-wiggle');
  catTransient('glance', 600, () => { catState = 'idle'; });
}
function catBlink() {
  const { cat, def, catEl } = catCtx();
  const idle = !cat.evolved && def.frames && def.frames.idle;
  if (!idle || idle.length < 2) return catWiggle();  // no blink frame yet → just wiggle
  catEl.src = idle[1];                                // eyes closed
  catTransient('glance', 160);                        // reopen (settle) shortly after
}

function catIdleBeat() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const onCafe = state.role === 'child' && state.child
    && document.querySelector('[data-cscreen="cafe"]')?.classList.contains('active');
  // Only stir when the café is open, in Play mode, the cat is at rest, and Sirus
  // isn't mid-drag. Otherwise wait quietly for the next beat.
  if (!reduce && onCafe && !cafeDrag && cafeMode === 'play' && catState === 'idle') {
    const roll = Math.random();
    if (roll < 0.35) catBlink();           // a slow blink (animated if frames exist)
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
    await store.completeQuest(state.familyId, state.uid, questId);
    // Immediate win even though the minutes are gated: celebrate + buzz so the
    // tap feels great; the reward then stacks in the "waiting for Mom" pile.
    confettiBurst();
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
    toast('Nice one! ⭐ Sent to Mom');
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
