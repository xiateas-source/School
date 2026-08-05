'use strict';

const STORAGE_KEY = 'catTrainerMvpV1';

const MAIN_SPRITES = {
  sirus:[0,0], mom:[50,0], black_cat:[100,0],
  orange_cat:[0,50], calico_cat:[50,50], blue_bed:[100,50],
  green_bed:[0,100], pink_bed:[50,100], mint_pillow:[100,100]
};
const FAMILY_SPRITES = { abba:[0,0], arlo:[100,0] };
const TODAY = () => new Date().toISOString().slice(0, 10);

const sectionMeta = {
  Morning: { icon: '☀', color: 'green' },
  Brain: { icon: '★', color: 'purple' },
  Move: { icon: '⚡', color: 'orange' },
  Tidy: { icon: '◆', color: 'blue' },
  Night: { icon: '☾', color: 'pink' }
};

const CAT_DEFS = {
  nova: { name: 'Nova', evolvedName: 'Nova Hero', title: 'Curious Moon Cat', evolvedTitle: 'Keeper of Bright Ideas', art: 'black_cat' },
  ember: { name: 'Ember', evolvedName: 'Ember Hero', title: 'Brave Orange Cat', evolvedTitle: 'Champion of Big Energy', art: 'orange_cat' },
  moss: { name: 'Moss', evolvedName: 'Moss Hero', title: 'Steady Calico Cat', evolvedTitle: 'Guardian of Home and Heart', art: 'calico_cat' }
};

const DECOR_DEFS = {
  rug: { name: 'Mint Pillow', price: 4, art: 'mint_pillow', className: 'decor-rug' },
  bed: { name: 'Blue Star Bed', price: 6, art: 'blue_bed', className: 'decor-bed' },
  plant: { name: 'Green Paw Bed', price: 8, art: 'green_bed', className: 'decor-plant' },
  tower: { name: 'Pink Heart Bed', price: 12, art: 'pink_bed', className: 'decor-tower' }
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

const clone = value => JSON.parse(JSON.stringify(value));
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
    console.warn('Could not load Cat Trainer data.', error);
    return freshState();
  }
}

let state = loadState();
let pendingParentMode = 'unlock';
let toastTimer;

function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function saveAndRender() { saveState(); renderAll(); }
function activeCatState() { return state.cats[state.activeCat]; }
function activeCatDef() { return CAT_DEFS[state.activeCat]; }
function nowLabel() { return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date()); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char])); }

function spriteMarkup(key, alt = '', className = '', id = '') {
  const family = Object.prototype.hasOwnProperty.call(FAMILY_SPRITES, key);
  const position = family ? FAMILY_SPRITES[key] : MAIN_SPRITES[key];
  if (!position) return '';
  const [x, y] = position;
  const data = family ? window.CAT_FAMILY_DATA : window.CAT_SPRITE_DATA;
  const size = family ? '200% 100%' : '300% 300%';
  const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
  return `<span${idAttr} class="raster-sprite ${escapeHtml(className)}" role="img" aria-label="${escapeHtml(alt)}" style="--sprite:url('${data || ''}');--sx:${x}%;--sy:${y}%;--ss:${size}"></span>`;
}

function artImage(key, alt = '', className = '') {
  return spriteMarkup(key, alt, className);
}

function catArtwork(catId, evolved = false) {
  const def = CAT_DEFS[catId];
  const name = evolved ? def.evolvedName : def.name;
  return `<div class="cat-figure ${evolved ? 'evolved' : ''}">${artImage(def.art, name, 'cat-raster')}</div>`;
}

function hydrateStaticArt() {
  const assignments = {
    '#trainer-art':'sirus', '#mom-menu-art':'mom', '#family-mom-art':'mom', '#family-abba-art':'abba',
    '#family-arlo-art':'arlo', '#parent-mom-art':'mom', '#pin-mom-art':'mom', '#peek-bed-art':'blue_bed'
  };
  Object.entries(assignments).forEach(([selector, key]) => {
    const node = $(selector);
    if (!node) return;
    const classes = node.className || '';
    const alt = node.getAttribute('alt') || key;
    const wrapper = document.createElement('template');
    wrapper.innerHTML = spriteMarkup(key, alt, classes, node.id).trim();
    node.replaceWith(wrapper.content.firstElementChild);
  });
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function addHistory({ points = 0, coins = 0, brain = 0, energy = 0, bond = 0, reason, questId = null, catId = state.activeCat }) {
  state.history.unshift({ id:`h-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, points, coins, brain, energy, bond, reason, questId, catId, time:nowLabel() });
  state.history = state.history.slice(0, 100);
}

function applyPointAdjustment(amount, reason, options = {}) {
  const oldPoints = state.points;
  const requested = Number(amount) || 0;
  state.points = state.settings.allowNegative ? oldPoints + requested : Math.max(0, oldPoints + requested);
  const actual = state.points - oldPoints;
  let bond = 0;
  if (actual > 0 && options.giveBond !== false) {
    bond = options.bond ?? (reason.includes("Yes, ma'am/sir") || reason.includes("Hero's Reset") ? 2 : 1);
    activeCatState().bond = clamp(activeCatState().bond + bond, 0, 20);
  }
  addHistory({ points:actual, bond, reason });
  saveAndRender();
  showToast(`${actual >= 0 ? '+' : ''}${actual} minute${Math.abs(actual) === 1 ? '' : 's'} · ${reason}`);
}

function completeQuest(questId) {
  const quest = state.quests.find(item => item.id === questId);
  if (!quest || state.completed[questId]) return;
  const cat = activeCatState();
  const oldPoints = state.points;
  const points = Number(quest.points) || 0;
  state.points = state.settings.allowNegative ? oldPoints + points : Math.max(0, oldPoints + points);
  const actualPoints = state.points - oldPoints;
  const brain = Math.max(0, Number(quest.brain) || 0);
  const energy = Math.max(0, Number(quest.energy) || 0);
  const coins = Math.max(0, Number(quest.coins) || 0);
  const beforeEvolved = cat.evolved;
  cat.brain = clamp(cat.brain + brain, 0, 12);
  cat.energy = clamp(cat.energy + energy, 0, 12);
  cat.bond = clamp(cat.bond + 1, 0, 20);
  state.coins += coins;
  state.completed[questId] = true;
  if (!cat.evolved && cat.brain >= 12 && cat.energy >= 12) cat.evolved = true;
  addHistory({ points:actualPoints, coins, brain, energy, bond:1, reason:`Quest: ${quest.title}`, questId, catId:state.activeCat });
  saveAndRender();
  showToast(`Quest complete! +${actualPoints} minute${actualPoints === 1 ? '' : 's'} · +${coins} coin${coins === 1 ? '' : 's'}`);
  if (!beforeEvolved && cat.evolved) showEvolution(state.activeCat);
}

function undoLastAction() {
  const entry = state.history[0];
  if (!entry) return showToast('Nothing to undo yet.');
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
  $('#evolution-title').textContent = `${def.evolvedName} unlocked!`;
  $('#evolution-art').innerHTML = catArtwork(catId, true);
  $('#evolution-copy').textContent = `${def.name} balanced Brain and Energy and reached ${def.evolvedTitle}.`;
  $('#evolution-dialog').showModal();
}
