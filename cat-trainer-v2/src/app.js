// Cat Trainer — app orchestrator. Wires auth + role gate to the synced store and
// renders Mom's dashboard and Sirus's game screens from live data.

import { isConfigured } from './firebase.js?v=b91a1d3e';
import {
  parentSignIn, friendlyAuthError, signInChildDevice,
  onAuth, signOutUser, rememberDeviceRole, deviceRole, deviceFamilyId, deviceParentName, deviceUid
} from './auth.js?v=b91a1d3e';
import * as store from './store.js?v=b91a1d3e';
import { CAT_DEFS } from './data/cats.js?v=b91a1d3e';
import { SECTIONS, SECTION_META } from './data/quests.js?v=b91a1d3e';
import { CAFE_ITEMS, CAFE_ROOM_ART } from './data/cafe-items.js?v=b91a1d3e';
import { QUICK_ACTIONS, HERO_THRESHOLD, QUEST_BOND, isHeroReady } from './shared/rewards.js?v=b91a1d3e';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));

const state = {
  role: null, familyId: null, uid: null,
  child: null, cats: {}, quests: [], ownedItems: [], todayCompletions: [], recentTxns: [],
  prevEvolved: {}, unsub: null
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
}

async function subscribeAll() {
  if (state.unsub) state.unsub();
  state.unsub = await store.subscribe(state.familyId, {
    onChild: (c) => { state.child = c; renderAll(); },
    onCats: (c) => { detectEvolution(c); state.cats = c; renderAll(); },
    onQuests: (q) => { state.quests = q; renderAll(); },
    onOwnedItems: (o) => { state.ownedItems = o; renderAll(); },
    onTodayCompletions: (t) => { state.todayCompletions = t; renderAll(); },
    onRecentTxns: (t) => { state.recentTxns = t; renderAll(); }
  });
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
}

// ---- Rendering --------------------------------------------------------------
function renderAll() {
  if (!state.child) return;
  if (state.role === 'parent') { renderParentDash(); renderLedger(); renderParentQuests(); renderParentCats(); renderParentCafe(); }
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
  el('parent-quests').innerHTML = state.quests.map(q =>
    `<div class="parent-quest-row"><div class="q-body"><strong>${esc(q.title)}</strong>
      <br><small>${esc(q.section)} · +${q.points}m ${q.brain?'· ★'+q.brain:''} ${q.energy?'· ⚡'+q.energy:''} · ♥${QUEST_BOND} ${q.coins?'· 🪙'+q.coins:''} ${q.enabled===false?'· (off)':''}</small></div>
      <button class="icon-btn" data-edit-quest="${esc(q.id)}">✎</button>
      <button class="icon-btn" data-del-quest="${esc(q.id)}">×</button></div>`
  ).join('') || '<div class="empty">No quests yet.</div>';
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
  const next = state.quests.filter(q => q.enabled !== false && !state.todayCompletions.includes(q.id)).slice(0, 3);
  el('c-next-quests').innerHTML = next.length ? next.map(childQuestCard).join('') : '<div class="empty">All done — great job!</div>';
}
function childQuestCard(q) {
  const done = state.todayCompletions.includes(q.id);
  return `<div class="quest-card ${done?'done':''}"><div class="q-body"><div class="q-title">${esc(q.title)}</div>
    <div class="q-reward">+${q.points}m ${q.brain?'· ★'+q.brain:''} ${q.energy?'· ⚡'+q.energy:''} · ♥${QUEST_BOND} ${q.coins?'· 🪙'+q.coins:''}</div></div>
    <button class="quest-complete" data-complete="${esc(q.id)}" ${done?'disabled':''}>${done?'✓':'+'}</button></div>`;
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
  const i = CAFE_ITEM_IDS.indexOf(itemId);
  return CAFE_SLOTS[(i < 0 ? 0 : i) % CAFE_SLOTS.length];
}
function ownedCafeRecord(itemId) { return state.ownedItems.find(o => o.id === itemId); }

// Active drag; also a render guard so a snapshot mid-drag doesn't rebuild the
// placed layer and yank the item out of Sirus's hand.
let cafeDrag = null;

function renderChildCafe() {
  el('c-coins').textContent = state.child.coins || 0;
  const id = state.child.activeCatId; const cat = state.cats[id] || {};
  el('c-cafe-room').style.backgroundImage = `url("${CAFE_ROOM_ART}")`;
  el('c-cafe-cat').src = cat.evolved ? CAT_DEFS[id].heroArt : CAT_DEFS[id].art;
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
      <small>🪙 ${item.price}</small>${btn}</div>`;
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

function reactCat() {
  const cat = el('c-cafe-cat');
  cat.classList.remove('bounce'); void cat.offsetWidth; cat.classList.add('bounce');
  const room = el('c-cafe-room');
  for (let i = 0; i < 4; i++) {
    const h = document.createElement('span');
    h.className = 'cafe-heart'; h.textContent = '💜';
    h.style.left = (38 + Math.random() * 24) + '%';
    h.style.animationDelay = (i * 90) + 'ms';
    room.appendChild(h);
    setTimeout(() => h.remove(), 1300 + i * 90);
  }
}
function renderChildLog() {
  el('c-log').innerHTML = state.recentTxns.length ? state.recentTxns.map(ledgerRow).join('') : '<div class="empty">Complete a quest to start your log!</div>';
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

    if (e.target.closest('#c-cafe-cat')) return reactCat();
    const putaway = e.target.closest('[data-putaway]');
    if (putaway) { try { await store.setCafeItemPlaced(state.familyId, putaway.dataset.putaway, false); toast('Put away.'); } catch (err) { toast('Could not update the café.'); } return; }
    const place = e.target.closest('[data-place]');
    if (place) { try { await store.setCafeItemPlaced(state.familyId, place.dataset.place, true); toast('Placed!'); } catch (err) { toast('Could not update the café.'); } return; }

    const delTxn = e.target.closest('[data-del-txn]');
    if (delTxn) {
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
  try { await store.completeQuest(state.familyId, state.uid, questId); toast('Quest complete! 🎉'); }
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
    enabled: existing ? existing.enabled !== false : true,
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
