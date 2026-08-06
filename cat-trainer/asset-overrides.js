'use strict';

/* Clean individual PNG artwork installed from the Cat Trainer Drive art set. */
window.CAT_PNG_ASSETS = Object.freeze({
  sirus: 'assets/sirus.png',
  mom: 'assets/mom.png',
  abba: 'assets/abba.png',
  arlo: 'assets/arlo.png',
  wesley: 'assets/wesley.png',
  nova: 'assets/nova.png',
  'nova-hero': 'assets/nova-hero.png',
  ember: 'assets/ember.png',
  'ember-hero': 'assets/ember-hero.png',
  moss: 'assets/moss.png',
  'moss-hero': 'assets/moss-hero.png',
  'bed-blue-stars': 'assets/bed-blue-stars.png',
  'bed-pink-hearts': 'assets/bed-pink-hearts.png',
  'food-bowl-purple': 'assets/food-bowl-purple.png',
  'water-bowl-teal': 'assets/water-bowl-teal.png',
  'yarn-blue': 'assets/yarn-blue.png',
  'yarn-pink': 'assets/yarn-pink.png',
  'cat-tree': 'assets/cat-tree.png',
  bookshelf: 'assets/bookshelf.png',
  'toy-basket': 'assets/toy-basket.png',
  plant: 'assets/plant.png',
  'collar-moon': 'assets/collar-moon.png',
  'morning-icon': 'assets/morning-icon.png',
  'brain-icon': 'assets/brain-icon.png',
  'move-icon': 'assets/move-icon.png',
  'cafe-room': 'assets/cafe-room.png'
});

function pngAssetPath(key) {
  return window.CAT_PNG_ASSETS[key] || `assets/${key}.png`;
}

function pngMarkup(key, alt = '', className = '', id = '') {
  const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
  const classes = ['asset-image', className].filter(Boolean).join(' ');
  return `<img${idAttr} class="${escapeHtml(classes)}" src="${escapeHtml(pngAssetPath(key))}" alt="${escapeHtml(alt)}" draggable="false">`;
}

CAT_DEFS.nova.art = 'nova';
CAT_DEFS.nova.heroArt = 'nova-hero';
CAT_DEFS.ember.art = 'ember';
CAT_DEFS.ember.heroArt = 'ember-hero';
CAT_DEFS.moss.art = 'moss';
CAT_DEFS.moss.heroArt = 'moss-hero';

/* Keep the original four IDs so existing purchases remain owned after the art update. */
Object.keys(DECOR_DEFS).forEach(key => delete DECOR_DEFS[key]);
Object.assign(DECOR_DEFS, {
  rug: { name: 'Blue Yarn', price: 4, art: 'yarn-blue', className: 'decor-yarn-blue' },
  bed: { name: 'Blue Star Bed', price: 6, art: 'bed-blue-stars', className: 'decor-bed-blue' },
  plant: { name: 'Paw-Print Plant', price: 8, art: 'plant', className: 'decor-plant-png' },
  tower: { name: 'Cat Tree', price: 12, art: 'cat-tree', className: 'decor-cat-tree' },
  pinkBed: { name: 'Pink Heart Bed', price: 7, art: 'bed-pink-hearts', className: 'decor-bed-pink' },
  foodBowl: { name: 'Purple Food Bowl', price: 5, art: 'food-bowl-purple', className: 'decor-food-bowl' },
  waterBowl: { name: 'Teal Water Bowl', price: 5, art: 'water-bowl-teal', className: 'decor-water-bowl' },
  pinkYarn: { name: 'Pink Yarn', price: 4, art: 'yarn-pink', className: 'decor-yarn-pink' },
  bookshelf: { name: 'Cat Bookshelf', price: 14, art: 'bookshelf', className: 'decor-bookshelf' },
  toyBasket: { name: 'Toy Basket', price: 9, art: 'toy-basket', className: 'decor-toy-basket' },
  moonCollar: { name: 'Moon Collar', price: 10, art: 'collar-moon', className: 'decor-moon-collar' }
});

sectionMeta.Morning.icon = '<img src="assets/morning-icon.png" alt="" aria-hidden="true">';
sectionMeta.Brain.icon = '<img src="assets/brain-icon.png" alt="" aria-hidden="true">';
sectionMeta.Move.icon = '<img src="assets/move-icon.png" alt="" aria-hidden="true">';

artImage = function artImagePng(key, alt = '', className = '') {
  return pngMarkup(key, alt, className);
};

catArtwork = function catArtworkPng(catId, evolved = false) {
  const def = CAT_DEFS[catId];
  const name = evolved ? def.evolvedName : def.name;
  const artKey = evolved ? def.heroArt : def.art;
  return `<div class="cat-figure ${evolved ? 'evolved' : ''}">${pngMarkup(artKey, name, 'cat-raster')}</div>`;
};

hydrateStaticArt = function hydrateStaticPngArt() {
  const assignments = {
    '#trainer-art': 'sirus',
    '#mom-menu-art': 'mom',
    '#family-mom-art': 'mom',
    '#family-abba-art': 'abba',
    '#family-arlo-art': 'arlo',
    '#parent-mom-art': 'mom',
    '#pin-mom-art': 'mom',
    '#peek-bed-art': 'bed-blue-stars'
  };

  Object.entries(assignments).forEach(([selector, key]) => {
    const node = $(selector);
    if (!node) return;
    node.src = pngAssetPath(key);
    node.classList.add('asset-image');
    node.draggable = false;
  });

  const portraits = $('.family-portraits');
  if (portraits && !$('#family-wesley-art')) {
    const wesley = document.createElement('img');
    wesley.id = 'family-wesley-art';
    wesley.className = 'asset-image';
    wesley.src = pngAssetPath('wesley');
    wesley.alt = 'Wesley';
    wesley.draggable = false;
    portraits.appendChild(wesley);
  }

  const teamHeading = $('.family-strip h2');
  if (teamHeading) teamHeading.textContent = 'Mom, Abba, Arlo, and Wesley';

  const cafeRoom = $('#cafe-room');
  if (cafeRoom) cafeRoom.style.setProperty('--cat-cafe-room', `url("${pngAssetPath('cafe-room')}")`);
};
