'use strict';

const STORAGE_KEY = 'catTrainerMvpV1';
const TODAY = () => new Date().toISOString().slice(0, 10);

const sectionMeta = {
  Morning: { icon: '☀' },
  Brain: { icon: '★' },
  Move: { icon: 'ϟ' },
  Tidy: { icon: '◆' },
  Night: { icon: '☾' }
};

const CAT_DEFS = {
  nova: {
    name: 'Nova', evolvedName: 'Astranova', title: 'Curious Starcat', evolvedTitle: 'Mythic Sky Guide',
    colors: ['#7d64df', '#d7c9ff', '#ffe681'], evolvedColors: ['#4f3cc4', '#9debd9', '#ffe681'],
    glow: 'rgba(156,124,255,.24)'
  },
  ember: {
    name: 'Ember', evolvedName: 'Voltiger', title: 'Brave Sprintcat', evolvedTitle: 'Thunder Trail Hero',
    colors: ['#ef8b58', '#ffd0a2', '#5e3a35'], evolvedColors: ['#ff7f55', '#ffe37e', '#59323c'],
    glow: 'rgba(255,142,88,.23)'
  },
  moss: {
    name: 'Moss', evolvedName: 'Groveguard', title: 'Steady Helper Cat', evolvedTitle: 'Guardian of Home',
    colors: ['#56b58f', '#cbe9cf', '#315c4d'], evolvedColors: ['#3b9d78', '#e1f0a2', '#2a5246'],
    glow: 'rgba(98,231,191,.21)'
  }
};

const DECOR_DEFS = {
  rug: { name: 'Moon Rug', price: 4, icon: '◉', className: 'decor-rug' },
  bed: { name: 'Cozy Bed', price: 6, icon: '▰', className: 'decor-bed' },
  plant: { name: 'Catnip Plant', price: 8, icon: '♧', className: 'decor-plant' },
  tower: { name: 'Climbing Tower', price: 12, icon: '♜', className: 'decor-tower' }
};

const DEFAULT_QUESTS = [
  { id: 'm-bathroom', title: 'Bathroom', section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-wesley', title: 'Take Wesley out', section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-water', title: "Check Wesley's water", section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-bedding', title: 'Fold bedding and put it away', section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-dressed', title: 'Get dressed', section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-teeth', title: 'Brush teeth', section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-face', title: 'Wash face and fix hair', section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'm-breakfast', title: 'Eat breakfast and wash bowl', section: 'Morning', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'b-read', title: 'Read or complete a Brain Quest', section: 'Brain', points: 1, brain: 2, energy: 0, coins: 1 },
  { id: 'v-move', title: 'Complete a movement challenge', section: 'Move', points: 1, brain: 0, energy: 2, coins: 1 },
  { id: 't-space', title: 'Reset one shared space', section: 'Tidy', points: 1, brain: 0, energy: 1, coins: 2 },
  { id: 'n-teeth', title: 'Night teeth and pajamas', section: 'Night', points: 1, brain: 0, energy: 1, coins: 1 },
  { id: 'n-room', title: 'Tidy and make bed', section: 'Night', points: 1, brain: 0, energy: 1, coins: 1 }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freshState() {
  return {
    version: 1,
    date: TODAY(),
    points: 0,
    coins: 0,
    activeCat: 'nova',
    cats: {
      nova: { unlocked: true, brain: 0, energy: 0, bond: 0, evolved: false },
      ember: { unlocked: true, brain: 0, energy: 0, bond: 0, evolved: false },
      moss: { unlocked: true, brain: 0, energy: 0, bond: 0, evolved: false }
    },
    quests: clone(DEFAULT_QUESTS),
    completed: {},
    history: [],
    decorOwned: [],
    settings: { allowNegative: false, pin: '2468' }
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || parsed.version !== 1) return freshState();
    const base = freshState();
    const sameDay = parsed.date === TODAY();
    return {
      ...base,
      ...parsed,
      date: TODAY(),
      points: sameDay ? Number(parsed.points || 0) : 0,
      completed: sameDay ? (parsed.completed || {}) : {},
      history: sameDay ? (parsed.history || []) : [],
      cats: { ...base.cats, ...(parsed.cats || {}) },
      settings: { ...base.settings, ...(parsed.settings || {}) },
      quests: Array.isArray(parsed.quests) && parsed.quests.length ? parsed.quests : base.quests,
      decorOwned: Array.isArray(parsed.decorOwned) ? parsed.decorOwned : []
    };
  } catch (error) {
    console.warn('Could not load saved Cat Trainer data.', error);
    return freshState();
  }
}

let state = loadState();
let pendingParentMode = 'unlock';
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  }[character]));
}

function nowLabel() {
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date());
}

function catSvg(catId, evolved = false) {
  const def = CAT_DEFS[catId];
  const colors = evolved ? def.evolvedColors : def.colors;
  const [main, light, accent] = colors;
  const star = catId === 'nova';
  const fire = catId === 'ember';
  const leaf = catId === 'moss';
  const prefix = `${catId}-${evolved ? 'e' : 'b'}`;

  let extra = '';
  if (star) {
    extra = evolved
      ? `<path d="M44 48 27 26 53 37 66 10 77 37 105 23 89 49" fill="none" stroke="${accent}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="66" cy="10" r="6" fill="#fff4b7"/>`
      : `<path d="m68 18 5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2Z" fill="${accent}"/>`;
  } else if (fire) {
    extra = evolved
      ? `<path d="M27 120C8 91 25 58 45 42c-2 22 12 29 19 9 17 25 15 51-2 66" fill="${accent}"/><path d="M108 128c26-30 8-62-13-76 6 19-7 30-14 13-12 22-9 43 5 59" fill="#ffe176"/>`
      : `<path d="M111 132c24-27 9-55-9-68 4 18-7 28-13 13-11 20-7 40 7 51" fill="${accent}"/>`;
  } else if (leaf) {
    extra = evolved
      ? `<path d="M31 43C23 20 44 7 62 12c-1 18-11 29-31 31Zm72 0c8-23-13-36-31-31 1 18 11 29 31 31Z" fill="${accent}"/><path d="M68 27c0-15 10-23 21-25 1 13-6 24-21 25Z" fill="#f3f3ad"/>`
      : `<path d="M70 25c0-14 12-23 25-22-1 14-10 23-25 22Z" fill="${accent}"/>`;
  }

  return `<svg viewBox="0 0 140 180" role="img" aria-label="${escapeHtml(evolved ? def.evolvedName : def.name)}">
    <defs>
      <linearGradient id="body-${prefix}" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${light}"/><stop offset="1" stop-color="${main}"/></linearGradient>
    </defs>
    ${extra}
    <path d="M39 68 24 42 51 53c10-7 29-7 40 0l25-12-12 29c8 11 10 29 5 44-5 15-16 25-33 28-22 4-43-5-50-24-7-18-1-38 13-50Z" fill="url(#body-${prefix})" stroke="${accent}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M43 139c-8 1-17 9-17 19 0 7 7 13 16 13h57c9 0 17-5 17-13 0-10-10-18-19-19-9 11-42 13-54 0Z" fill="${main}" stroke="${accent}" stroke-width="4"/>
    <path d="M99 143c25 1 31 20 20 30-7 6-20 2-20-8 0-7 9-10 14-5" fill="none" stroke="${accent}" stroke-width="8" stroke-linecap="round"/>
    <ellipse cx="51" cy="91" rx="7" ry="9" fill="#19213d"/><ellipse cx="89" cy="91" rx="7" ry="9" fill="#19213d"/>
    <circle cx="49" cy="88" r="2.2" fill="white"/><circle cx="87" cy="88" r="2.2" fill="white"/>
    <path d="m65 105 5 4 5-4" fill="${accent}" stroke="${accent}" stroke-width="2" stroke-linecap="round"/>
    <path d="M70 109c0 7-10 8-13 3m13-3c0 7 10 8 13 3" fill="none" stroke="#49364e" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M40 106 15 101m25 12-26 4m86-11 25-5m-25 12 26 5" stroke="${accent}" stroke-width="2" stroke-linecap="round" opacity=".9"/>
    ${evolved ? `<path d="M31 131c12 8 67 8 79-1" fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round"/><circle cx="70" cy="133" r="7" fill="${light}" stroke="${accent}" stroke-width="3"/>` : ''}
  </svg>`;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function activeCatState() { return state.cats[state.activeCat]; }
function activeCatDef() { return CAT_DEFS[state.activeCat]; }

function addHistory({ points = 0, coins = 0, brain = 0, energy = 0, bond = 0, reason, questId = null, catId = state.activeCat }) {
  const entry = {
    id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    points, coins, brain, energy, bond, reason, questId, catId,
    time: nowLabel()
  };
  state.history.unshift(entry);
  state.history = state.history.slice(0, 100);
  return entry;
}

function applyPointAdjustment(amount, reason, options = {}) {
  const requested = Number(amount) || 0;
  const oldPoints = state.points;
  const newPoints = state.settings.allowNegative ? oldPoints + requested : Math.max(0, oldPoints + requested);
  const actual = newPoints - oldPoints;
  state.points = newPoints;

  const cat = activeCatState();
  let bond = 0;
  if (actual > 0 && options.giveBond !== false) {
    bond = options.bond ?? (reason.includes("Yes, ma'am/sir") ? 2 : reason.includes("Hero's Reset") ? 2 : 1);
    cat.bond = clamp(cat.bond + bond, 0, 20);
  }

  addHistory({ points: actual, bond, reason });
  saveAndRender();
  showToast(`${actual >= 0 ? '+' : ''}${actual} minute${Math.abs(actual) === 1 ? '' : 's'} · ${reason}`);
}

function completeQuest(questId) {
  const quest = state.quests.find(item => item.id === questId);
  if (!quest || state.completed[questId]) return;

  const cat = activeCatState();
  const oldPoints = state.points;
  const requestedPoints = Number(quest.points) || 0;
  state.points = state.settings.allowNegative ? oldPoints + requestedPoints : Math.max(0, oldPoints + requestedPoints);
  const actualPoints = state.points - oldPoints;

  const beforeEvolved = cat.evolved;
  const brain = Math.max(0, Number(quest.brain) || 0);
  const energy = Math.max(0, Number(quest.energy) || 0);
  const coins = Math.max(0, Number(quest.coins) || 0);
  cat.brain = clamp(cat.brain + brain, 0, 12);
  cat.energy = clamp(cat.energy + energy, 0, 12);
  cat.bond = clamp(cat.bond + 1, 0, 20);
  state.coins += coins;
  state.completed[questId] = true;

  if (!cat.evolved && cat.brain >= 12 && cat.energy >= 12) cat.evolved = true;

  addHistory({
    points: actualPoints, coins, brain, energy, bond: 1,
    reason: `Quest: ${quest.title}`, questId, catId: state.activeCat
  });

  saveAndRender();
  showToast(`Quest complete! +${actualPoints} minute${actualPoints === 1 ? '' : 's'} · +${coins} coin${coins === 1 ? '' : 's'}`);
  if (!beforeEvolved && cat.evolved) showEvolution(state.activeCat);
}

function undoLastAction() {
  const entry = state.history[0];
  if (!entry) { showToast('Nothing to undo yet.'); return; }

  state.points -= Number(entry.points || 0);
  if (!state.settings.allowNegative) state.points = Math.max(0, state.points);
  state.coins = Math.max(0, state.coins - Number(entry.coins || 0));

  const cat = state.cats[entry.catId];
  if (cat) {
    cat.brain = clamp(cat.brain - Number(entry.brain || 0), 0, 12);
    cat.energy = clamp(cat.energy - Number(entry.energy || 0), 0, 12);
    cat.bond = clamp(cat.bond - Number(entry.bond || 0), 0, 20);
    if (cat.brain < 12 || cat.energy < 12) cat.evolved = false;
  }

  if (entry.questId) delete state.completed[entry.questId];
  state.history.shift();
  saveAndRender();
  showToast('Last action undone.');
}

function showEvolution(catId) {
  const def = CAT_DEFS[catId];
  $('#evolution-title').textContent = `${def.name} evolved into ${def.evolvedName}!`;
  $('#evolution-art').innerHTML = catSvg(catId, true);
  $('#evolution-copy').textContent = `${def.evolvedName} balanced Brain and Energy to become a ${def.evolvedTitle}.`;
  $('#evolution-dialog').showModal();
}

function renderHome() {
  const cat = activeCatState();
  const def = activeCatDef();
  $('#points-total').textContent = state.points;
  $('#active-cat-name').textContent = cat.evolved ? def.evolvedName : def.name;
  $('#active-cat-stage').innerHTML = catSvg(state.activeCat, cat.evolved);
  $('#brain-value').textContent = `${cat.brain} / 12`;
  $('#energy-value').textContent = `${cat.energy} / 12`;
  $('#bond-value').textContent = `${cat.bond} / 20`;
  $('#brain-meter').style.width = `${(cat.brain / 12) * 100}%`;
  $('#energy-meter').style.width = `${(cat.energy / 12) * 100}%`;
  $('#bond-meter').style.width = `${(cat.bond / 20) * 100}%`;
  $('#coin-total-home').textContent = state.coins;

  const next = state.quests.filter(quest => !state.completed[quest.id]).slice(0, 3);
  $('#next-quests').innerHTML = next.length ? next.map(quest => `
    <div class="quest-mini">
      <span class="quest-symbol">${sectionMeta[quest.section]?.icon || '•'}</span>
      <div><strong>${escapeHtml(quest.title)}</strong><small>${escapeHtml(quest.section)}</small></div>
      <div class="reward-chips">${rewardChips(quest)}</div>
    </div>`).join('') : '<div class="empty-state">Every quest is complete. Your cats are proud of the work you practiced today.</div>';
}

function rewardChips(quest) {
  const chips = [];
  if (Number(quest.points)) chips.push(`<span class="reward-chip">+${quest.points}m</span>`);
  if (Number(quest.brain)) chips.push(`<span class="reward-chip">★${quest.brain}</span>`);
  if (Number(quest.energy)) chips.push(`<span class="reward-chip">ϟ${quest.energy}</span>`);
  if (Number(quest.coins)) chips.push(`<span class="reward-chip">●${quest.coins}</span>`);
  return chips.join('');
}

function rewardLine(quest) {
  const parts = [];
  if (Number(quest.points)) parts.push(`+${quest.points} min`);
  if (Number(quest.brain)) parts.push(`+${quest.brain} Brain`);
  if (Number(quest.energy)) parts.push(`+${quest.energy} Energy`);
  if (Number(quest.coins)) parts.push(`+${quest.coins} coin${Number(quest.coins) === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Practice quest';
}

function renderQuests() {
  const done = Object.keys(state.completed).filter(id => state.completed[id] && state.quests.some(q => q.id === id)).length;
  $('#quest-done-count').textContent = done;
  $('#quest-left-count').textContent = Math.max(0, state.quests.length - done);
  $('#coin-total-quests').textContent = state.coins;

  $('#quest-sections').innerHTML = Object.keys(sectionMeta).map(section => {
    const quests = state.quests.filter(quest => quest.section === section);
    if (!quests.length) return '';
    return `<section class="quest-group">
      <div class="quest-group-title"><span>${sectionMeta[section].icon}</span><h3>${section}</h3></div>
      <div class="quest-list">
        ${quests.map(quest => {
          const completed = Boolean(state.completed[quest.id]);
          return `<article class="quest-card ${completed ? 'done' : ''}">
            <span class="quest-symbol">${sectionMeta[section].icon}</span>
            <div class="quest-info"><span class="quest-title">${escapeHtml(quest.title)}</span><div class="quest-reward-line">${escapeHtml(rewardLine(quest))}</div></div>
            <button class="quest-complete" data-complete-quest="${escapeHtml(quest.id)}" ${completed ? 'disabled' : ''} aria-label="${completed ? 'Completed' : `Complete ${escapeHtml(quest.title)}`}">${completed ? '✓' : '+'}</button>
          </article>`;
        }).join('')}
      </div>
    </section>`;
  }).join('');
}

function renderCats() {
  $('#cat-collection').innerHTML = Object.entries(CAT_DEFS).map(([id, def]) => {
    const cat = state.cats[id];
    const active = id === state.activeCat;
    const displayName = cat.evolved ? def.evolvedName : def.name;
    const displayTitle = cat.evolved ? def.evolvedTitle : def.title;
    return `<article class="cat-card ${active ? 'active-cat' : ''}" style="--cat-glow:${def.glow}">
      ${cat.evolved ? '<span class="evolved-badge">EVOLVED</span>' : ''}
      <div class="cat-art">${catSvg(id, cat.evolved)}</div>
      <h3>${escapeHtml(displayName)}</h3>
      <p class="cat-subtitle">${escapeHtml(displayTitle)} · ★${cat.brain}/12 · ϟ${cat.energy}/12</p>
      <div class="cat-card-footer">
        <button data-select-cat="${id}" ${active ? 'disabled' : ''}>${active ? 'Training' : 'Train'}</button>
        <button class="secondary" data-preview-evolution="${id}">${cat.evolved ? 'View form' : 'Preview'}</button>
      </div>
    </article>`;
  }).join('');
}

function renderCafe() {
  $('#coin-total-cafe').textContent = state.coins;
  const cat = activeCatState();
  $('#cafe-cat').innerHTML = catSvg(state.activeCat, cat.evolved);
  $('#placed-decor').innerHTML = state.decorOwned.map(id => {
    const decor = DECOR_DEFS[id];
    if (!decor) return '';
    if (id === 'plant') return `<div class="decor ${decor.className}" aria-label="${escapeHtml(decor.name)}">🌿</div>`;
    return `<div class="decor ${decor.className}" aria-label="${escapeHtml(decor.name)}"></div>`;
  }).join('');

  $('#decor-shop').innerHTML = Object.entries(DECOR_DEFS).map(([id, decor]) => {
    const owned = state.decorOwned.includes(id);
    const affordable = state.coins >= decor.price;
    return `<article class="shop-item">
      <span class="shop-icon">${decor.icon}</span>
      <div><strong>${escapeHtml(decor.name)}</strong><small>● ${decor.price}</small></div>
      <button data-buy-decor="${id}" ${owned || !affordable ? 'disabled' : ''}>${owned ? 'Placed' : affordable ? 'Buy & place' : 'Need more coins'}</button>
    </article>`;
  }).join('');
}

function renderParent() {
  $('#parent-points').textContent = state.points;
  $('#allow-negative').checked = state.settings.allowNegative;

  $('#parent-quest-list').innerHTML = state.quests.map(quest => `
    <div class="parent-quest-row">
      <div><strong>${escapeHtml(quest.title)}</strong><small>${escapeHtml(quest.section)} · ${escapeHtml(rewardLine(quest))}</small></div>
      <button class="delete-quest" data-delete-quest="${escapeHtml(quest.id)}" aria-label="Delete ${escapeHtml(quest.title)}">×</button>
    </div>`).join('');

  $('#history-list').innerHTML = state.history.length ? state.history.map(entry => `
    <div class="history-item">
      <span class="history-delta ${entry.points < 0 ? 'minus' : 'plus'}">${entry.points >= 0 ? '+' : ''}${entry.points}</span>
      <p>${escapeHtml(entry.reason)}</p>
      <time>${escapeHtml(entry.time)}</time>
    </div>`).join('') : '<div class="empty-state">No point changes yet today.</div>';
}

function saveAndRender() { saveState(); renderAll(); }
function renderAll() { renderHome(); renderQuests(); renderCats(); renderCafe(); renderParent(); }

function navigate(screenName) {
  $$('.screen').forEach(screen => screen.classList.toggle('active', screen.dataset.screen === screenName));
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.go === screenName));
  $('.bottom-nav').hidden = screenName === 'parent';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openParentGate(mode = 'unlock') {
  pendingParentMode = mode;
  $('#pin-input').value = '';
  $('#pin-error').textContent = '';
  $('#pin-title').textContent = mode === 'change' ? 'Change parent PIN' : 'Grown-up gate';
  $('#pin-copy').textContent = mode === 'change' ? 'Enter the current PIN first.' : 'Enter your 4-digit PIN.';
  $('#pin-dialog').showModal();
  setTimeout(() => $('#pin-input').focus(), 80);
}

function processPin() {
  const value = $('#pin-input').value.trim();
  if (value !== state.settings.pin) {
    $('#pin-error').textContent = 'That PIN does not match.';
    return false;
  }

  $('#pin-dialog').close();
  if (pendingParentMode === 'change') {
    const nextPin = window.prompt('Choose a new 4-digit parent PIN:', '');
    if (nextPin && /^\d{4}$/.test(nextPin)) {
      state.settings.pin = nextPin;
      saveAndRender();
      showToast('Parent PIN changed.');
    } else if (nextPin !== null) {
      showToast('PIN must be exactly 4 digits.');
    }
  } else {
    navigate('parent');
  }
  return true;
}

function buyDecor(id) {
  const decor = DECOR_DEFS[id];
  if (!decor || state.decorOwned.includes(id) || state.coins < decor.price) return;
  state.coins -= decor.price;
  state.decorOwned.push(id);
  saveAndRender();
  showToast(`${decor.name} added to the café!`);
}

function selectCat(id) {
  if (!state.cats[id]?.unlocked) return;
  state.activeCat = id;
  saveAndRender();
  showToast(`${CAT_DEFS[id].name} is now your active cat.`);
}

function addQuestFromForm(event) {
  event.preventDefault();
  const title = $('#quest-title-input').value.trim();
  if (!title) return;
  state.quests.push({
    id: `q-${Date.now()}`,
    title,
    section: $('#quest-section-input').value,
    points: Number($('#quest-points-input').value) || 0,
    brain: Math.max(0, Number($('#quest-brain-input').value) || 0),
    energy: Math.max(0, Number($('#quest-energy-input').value) || 0),
    coins: Math.max(0, Number($('#quest-coins-input').value) || 0)
  });
  event.currentTarget.reset();
  $('#quest-points-input').value = 1;
  $('#quest-energy-input').value = 1;
  $('#quest-coins-input').value = 1;
  saveAndRender();
  showToast('Recurring quest added.');
}

function deleteQuest(id) {
  const quest = state.quests.find(item => item.id === id);
  if (!quest) return;
  if (!window.confirm(`Delete “${quest.title}” from the daily quest list?`)) return;
  state.quests = state.quests.filter(item => item.id !== id);
  delete state.completed[id];
  saveAndRender();
  showToast('Quest removed.');
}

function startNewDay() {
  if (!window.confirm('Start a fresh day? Today’s point total, completions, and history will reset. Cats, coins, quests, and café decorations will stay.')) return;
  state.date = TODAY();
  state.points = 0;
  state.completed = {};
  state.history = [];
  saveAndRender();
  navigate('home');
  showToast('A fresh day has begun.');
}

function exportBackup() {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), app: 'Cat Trainer', data: state }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cat-trainer-backup-${TODAY()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded to this device.');
}

function bindEvents() {
  document.addEventListener('click', event => {
    const go = event.target.closest('[data-go]');
    if (go) { navigate(go.dataset.go); return; }
    const complete = event.target.closest('[data-complete-quest]');
    if (complete) { completeQuest(complete.dataset.completeQuest); return; }
    const select = event.target.closest('[data-select-cat]');
    if (select) { selectCat(select.dataset.selectCat); return; }
    const preview = event.target.closest('[data-preview-evolution]');
    if (preview) {
      const id = preview.dataset.previewEvolution;
      const def = CAT_DEFS[id];
      $('#evolution-title').textContent = state.cats[id].evolved ? def.evolvedName : `${def.name}'s evolution preview`;
      $('#evolution-art').innerHTML = catSvg(id, true);
      $('#evolution-copy').textContent = `${def.evolvedName} appears when both Brain and Energy reach 12.`;
      $('#evolution-dialog').showModal();
      return;
    }
    const buy = event.target.closest('[data-buy-decor]');
    if (buy) { buyDecor(buy.dataset.buyDecor); return; }
    const adjust = event.target.closest('[data-points]');
    if (adjust) { applyPointAdjustment(Number(adjust.dataset.points), adjust.dataset.reason); return; }
    const remove = event.target.closest('[data-delete-quest]');
    if (remove) deleteQuest(remove.dataset.deleteQuest);
  });

  $('#open-parent').addEventListener('click', () => openParentGate('unlock'));
  $('#lock-parent').addEventListener('click', () => navigate('home'));
  $('#pin-form').addEventListener('submit', event => { event.preventDefault(); processPin(); });
  $('#custom-adjust-form').addEventListener('submit', event => {
    event.preventDefault();
    const amount = Number($('#custom-points').value) || 0;
    const reason = $('#custom-reason').value.trim() || 'Custom adjustment';
    applyPointAdjustment(amount, reason, { giveBond: amount > 0 });
    $('#custom-reason').value = '';
  });
  $('#undo-action').addEventListener('click', undoLastAction);
  $('#add-quest-form').addEventListener('submit', addQuestFromForm);
  $('#allow-negative').addEventListener('change', event => {
    state.settings.allowNegative = event.target.checked;
    if (!state.settings.allowNegative) state.points = Math.max(0, state.points);
    saveAndRender();
    showToast(state.settings.allowNegative ? 'Points may now go below zero.' : 'Point balance will stop at zero.');
  });
  $('#new-day').addEventListener('click', startNewDay);
  $('#change-pin').addEventListener('click', () => openParentGate('change'));
  $('#export-data').addEventListener('click', exportBackup);
  $('#close-evolution').addEventListener('click', () => $('#evolution-dialog').close());
  $('.cafe-peek').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') navigate('cafe');
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(error => console.warn('Service worker registration failed.', error));
  }
}

bindEvents();
renderAll();
registerServiceWorker();
