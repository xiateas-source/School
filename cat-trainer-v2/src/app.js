// Cat Trainer — app orchestrator. Wires auth + role gate to the synced store and
// renders Mom's dashboard and Sirus's game screens from live data.

import { isConfigured } from './firebase.js?v=af1fb168';
import {
  parentSignIn, friendlyAuthError, signInChildDevice,
  onAuth, signOutUser, rememberDeviceRole, deviceRole, deviceFamilyId, deviceParentName, deviceUid
} from './auth.js?v=af1fb168';
import * as store from './store.js?v=af1fb168';
import { CAT_DEFS } from './data/cats.js?v=af1fb168';
import { SECTIONS, SECTION_META } from './data/quests.js?v=af1fb168';
import { CAFE_ITEMS, CAFE_ROOM_ART } from './data/cafe-items.js?v=af1fb168';
import { QUICK_ACTIONS, HERO_THRESHOLD, QUEST_BOND, isHeroReady } from './shared/rewards.js?v=af1fb168';

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
  scheduleCatIdle(); // the café cat ambles/glances on its own while Sirus watches
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
  if (state.role === 'parent') { renderApprovals(); renderParentDash(); renderLedger(); renderParentQuests(); renderParentCats(); renderParentCafe(); }
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
function renderParentQuests() {
  el('parent-quests').innerHTML = state.quests.map(q => {
    const on = q.enabled !== false;
    return `<div class="parent-quest-row ${on?'':'quest-off'}"><div class="q-body"><strong>${esc(q.title)}</strong>
      <br><small>${esc(q.section)} · +${q.points}m ${q.brain?'· ★'+q.brain:''} ${q.energy?'· ⚡'+q.energy:''} · ♥${QUEST_BOND} ${q.coins?'· 🪙'+q.coins:''}</small></div>
      <button class="lock-toggle ${on?'on':'off'}" data-toggle-quest="${esc(q.id)}" role="switch" aria-checked="${on}" aria-label="${on?'On — tap to lock off':'Off — tap to turn on'}">${on?'On':'🔒 Off'}</button>
      <button class="icon-btn" data-edit-quest="${esc(q.id)}">✎</button>
      <button class="icon-btn" data-del-quest="${esc(q.id)}">×</button></div>`;
  }).join('') || '<div class="empty">No quests yet.</div>';
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
  el('c-quests').innerHTML = SECTIONS.map(section => {
    const qs = state.quests.filter(q => q.section === section && q.enabled !== false);
    if (!qs.length) return '';
    const meta = SECTION_META[section];
    const icon = meta.icon ? `<img src="${meta.icon}" alt="">` : `<span>${meta.glyph}</span>`;
    return `<div class="quest-group"><h3>${icon}${section}</h3>${qs.map(childQuestCard).join('')}</div>`;
  }).join('');
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
// The café cat's resting look reflects real progress, so tapping and earning
// visibly change it: sleepy when Energy is low, bright and bouncy after a quest.
function catMood() {
  const id = state.child.activeCatId; const cat = state.cats[id] || {};
  if (cat.evolved) return { pose: null, cls: 'mood-happy' };
  const energy = cat.energy || 0;
  const happyToday = (state.todayCompletions && state.todayCompletions.length > 0) || (cat.bond || 0) >= 12;
  if (energy <= 3) return { pose: 'sleep', cls: 'mood-sleepy' };
  if (happyToday)  return { pose: 'sit',   cls: 'mood-happy' };
  return { pose: 'sit', cls: 'mood-calm' };
}
let catTapCount = 0;
let catSettleTimer = null;
let catIdleTimer = null;
let catStrollBack = null;
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
  el('c-cafe-cat').src = cat.evolved ? def.heroArt : cafePoseArt(def, mood.pose || 'sit');
  if (!cafeDrag) {
    el('c-placed').innerHTML = state.ownedItems.filter(o => o.placed !== false).map(o => {
      const item = CAFE_ITEMS[o.id]; if (!item) return '';
      const [x, y] = (o.x != null && o.y != null) ? [o.x, o.y] : cafeSlot(o.id);
      return `<img class="cafe-decor" src="${item.art}" alt="${esc(item.name)}" data-decor="${o.id}"
        style="left:${x}%;top:${y}%" draggable="false">`;
    }).join('');
  }
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

// ---- Café interactions (drag to arrange · tap to react) ---------------------
function initCafeInteractions() {
  const room = el('c-cafe-room');
  if (!room) return;

  room.addEventListener('pointerdown', (e) => {
    const img = e.target.closest('[data-decor]');
    if (!img) return; // not a décor item (e.g. the cat) — leave it to click/react
    e.preventDefault();
    cafeDrag = { id: img.dataset.decor, el: img, rect: room.getBoundingClientRect(),
                 grabX: e.clientX, grabY: e.clientY, moved: false };
    img.classList.add('dragging');
    try { img.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
  });

  room.addEventListener('pointermove', (e) => {
    if (!cafeDrag) return;
    if (!cafeDrag.moved && Math.abs(e.clientX - cafeDrag.grabX) + Math.abs(e.clientY - cafeDrag.grabY) > 6) cafeDrag.moved = true;
    if (!cafeDrag.moved) return;
    const r = cafeDrag.rect;
    // Center the item under the finger; clamp so it stays fully inside the room.
    // Décor is 26% wide and ~19.5% of the room tall (the room is a 3:4 box).
    const x = Math.min(74, Math.max(0, ((e.clientX - r.left) / r.width) * 100 - 13));
    const y = Math.min(80.5, Math.max(0, ((e.clientY - r.top) / r.height) * 100 - 9.75));
    cafeDrag.el.style.left = x + '%';
    cafeDrag.el.style.top = y + '%';
    cafeDrag.lastX = x; cafeDrag.lastY = y;
    // Leave a little paw-print trail as the item is dragged (throttled).
    const now = performance.now();
    if (now - (cafeDrag.lastPaw || 0) > 110) {
      cafeDrag.lastPaw = now;
      spawnFx('assets/fx-paw.png', room, { count: 1, cx: x + 13, cy: y + 10, spread: 0, size: 26, life: 700, mode: 'trail' });
    }
  });

  const endDrag = async (e) => {
    if (!cafeDrag) return;
    const d = cafeDrag; cafeDrag = null;
    d.el.classList.remove('dragging');
    try { d.el.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
    if (d.moved && d.lastX != null) {
      const round = (n) => Math.round(n * 10) / 10;
      try { await store.moveCafeItem(state.familyId, d.id, round(d.lastX), round(d.lastY)); }
      catch (_) { toast('Could not save that move.'); renderChildCafe(); }
    } else {
      // A tap (no real drag) → a playful wiggle.
      d.el.classList.remove('wiggle'); void d.el.offsetWidth; d.el.classList.add('wiggle');
    }
  };
  room.addEventListener('pointerup', endDrag);
  room.addEventListener('pointercancel', endDrag);
}

function reactCat(e) {
  const catEl = el('c-cafe-cat');
  const id = state.child.activeCatId; const cat = state.cats[id] || {}; const def = CAT_DEFS[id];
  catTapCount++;

  // Physical feedback: a springy squash-stretch (alternating with a wiggle) and a
  // haptic tick, so a tap feels like touching a creature, not clicking "next".
  const anim = (catTapCount % 2) ? 'react' : 'react-wiggle';
  catEl.classList.remove('react', 'react-wiggle'); void catEl.offsetWidth; catEl.classList.add(anim);
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) {} }

  // Burst right where the finger landed, not dead-center.
  const room = el('c-cafe-room');
  let cx = 50, cy = 46;
  const px = e && (e.clientX ?? e.touches?.[0]?.clientX);
  const py = e && (e.clientY ?? e.touches?.[0]?.clientY);
  if (room && px != null && py != null) {
    const r = room.getBoundingClientRect();
    cx = ((px - r.left) / r.width) * 100; cy = ((py - r.top) / r.height) * 100;
  }
  spawnFx('assets/fx-sparkle.png', room, { count: 3, cx, cy, spread: 16, size: 40 });
  if (catTapCount % 3 === 0) spawnFx('assets/fx-paw.png', room, { count: 1, cx, cy: cy + 6, spread: 0, size: 30, life: 700, mode: 'trail' });

  // Flash a happy pose, then settle back to the mood-resting look — a tap is a
  // reaction now, not a march through a slideshow.
  if (!cat.evolved && def.poses) {
    catEl.src = cafePoseArt(def, (catTapCount % 2) ? 'play' : 'celebrate');
    clearTimeout(catSettleTimer);
    catSettleTimer = setTimeout(() => {
      const m = catMood();
      catEl.src = cat.evolved ? def.heroArt : cafePoseArt(def, m.pose || 'sit');
    }, 900);
  }
}

// ---- Autonomous idle: the cat lives on its own between taps -----------------
// A randomized, mood-paced timer gives the resting cat little "beats" — a
// stroll, a glance at a toy, a hop — so the café never looks frozen. Sleepy cats
// stir rarely; happy cats are livelier. (The behavior half of the Tamagotchi
// idea, driven by real stats, on the single-frame sprites.)
function catStroll() {
  const wrap = el('c-cafe-cat-wrap');
  if (!wrap) return;
  const dir = Math.random() < 0.5 ? -1 : 1;
  const dest = 30 + dir * (5 + Math.random() * 8); // wander within the room (base left:30%)
  wrap.style.left = dest.toFixed(1) + '%';
  clearTimeout(catStrollBack);
  catStrollBack = setTimeout(() => { const w = el('c-cafe-cat-wrap'); if (w) w.style.left = '30%'; }, 1400 + Math.random() * 1200);
}

function catIdleBeat() {
  // Respect reduced-motion: skip the beat entirely (but keep the loop alive).
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { scheduleCatIdle(); return; }
  const onCafe = state.role === 'child' && state.child
    && document.querySelector('[data-cscreen="cafe"]')?.classList.contains('active');
  if (onCafe && !cafeDrag) {
    const id = state.child.activeCatId; const cat = state.cats[id] || {}; const def = CAT_DEFS[id];
    const catEl = el('c-cafe-cat');
    const mood = catMood();
    const roll = Math.random();
    if (mood.cls === 'mood-sleepy') {
      // barely stirs — a slow little sway, then keeps napping
      catEl.classList.remove('react-wiggle'); void catEl.offsetWidth; catEl.classList.add('react-wiggle');
    } else if (roll < 0.45) {
      catStroll();                                    // amble left or right
    } else if (!cat.evolved && def.poses && roll < 0.8) {
      catEl.src = cafePoseArt(def, 'play');           // glance/play, then settle back
      clearTimeout(catSettleTimer);
      catSettleTimer = setTimeout(() => { catEl.src = cat.evolved ? def.heroArt : cafePoseArt(def, catMood().pose || 'sit'); }, 800);
    } else {
      catEl.classList.remove('react'); void catEl.offsetWidth; catEl.classList.add('react');  // a happy hop
    }
  }
  scheduleCatIdle();
}

// Next beat sooner when the cat's lively, later when it's sleepy.
function scheduleCatIdle() {
  clearTimeout(catIdleTimer);
  const moodCls = state.child ? catMood().cls : 'mood-calm';
  const base = moodCls === 'mood-sleepy' ? 9000 : moodCls === 'mood-happy' ? 4500 : 6500;
  catIdleTimer = setTimeout(catIdleBeat, base + Math.random() * 4000);
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

    const buy = e.target.closest('[data-buy]');
    if (buy) { try { await store.purchaseCafeItem(state.familyId, state.uid, buy.dataset.buy); toast('Added to the café!'); } catch (err) { toast(err.message === 'not-enough-coins' ? 'Not enough coins yet.' : 'Could not buy that.'); } return; }

    if (e.target.closest('#c-cafe-cat')) return reactCat(e);
    const putaway = e.target.closest('[data-putaway]');
    if (putaway) { try { await store.setCafeItemPlaced(state.familyId, putaway.dataset.putaway, false); toast('Put away.'); } catch (err) { toast('Could not update the café.'); } return; }
    const place = e.target.closest('[data-place]');
    if (place) { try { await store.setCafeItemPlaced(state.familyId, place.dataset.place, true); toast('Placed!'); } catch (err) { toast('Could not update the café.'); } return; }

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
