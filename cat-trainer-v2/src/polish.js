// Cat Trainer — presentation-only semantic polish.
// Keep this file free of store writes and game-state changes.

function syncNavCurrent() {
  document.querySelectorAll('.bottom-nav').forEach((nav) => {
    nav.querySelectorAll('.nav-item').forEach((item) => {
      if (item.classList.contains('active')) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
  });
}

function syncIconButtonLabels() {
  document.querySelectorAll('[data-edit-quest]').forEach((button) => {
    const title = button.closest('.parent-quest-row')?.querySelector('.q-body strong')?.textContent?.trim();
    button.setAttribute('aria-label', title ? `Edit ${title}` : 'Edit quest');
  });

  document.querySelectorAll('[data-del-quest]').forEach((button) => {
    const title = button.closest('.parent-quest-row')?.querySelector('.q-body strong')?.textContent?.trim();
    button.setAttribute('aria-label', title ? `Delete ${title}` : 'Delete quest');
  });
}

function syncCareChargeHelp() {
  const pill = document.querySelector('.care-charge-pill');
  if (!pill) return;
  pill.setAttribute('aria-label', 'Care Charges. Complete a quest to earn one.');
}

function syncCafeCopy() {
  // Keep the two room-storage surfaces on the same concrete child-friendly verb.
  document.querySelectorAll('[data-store]').forEach((button) => {
    if (button.textContent !== 'Put away') button.textContent = 'Put away';
  });

  const done = document.getElementById('c-done-btn');
  if (done && done.textContent !== 'Done decorating') done.textContent = 'Done decorating';

  // Clarify that Home-screen Energy is training progress, not the daily Rest need.
  const energy = document.querySelector('.meter-row #c-energy-bar')?.closest('.meter-row');
  if (energy) energy.setAttribute('aria-label', 'Energy — training progress toward Hero Form');
  const rest = document.getElementById('c-rest-need');
  if (rest) rest.setAttribute('aria-label', 'Rest — how rested your cat feels today');
}

function syncPolishSemantics() {
  syncNavCurrent();
  syncIconButtonLabels();
  syncCareChargeHelp();
  syncCafeCopy();
}

// Presentation-only busy feedback. The original app handler receives the first
// click. This layer marks the control busy after that event, then blocks only
// repeated clicks at capture-time until the app's existing toast reports a result.
// It never toggles the app's own native disabled state or wraps a store write.
//
// Only actions that already have their own try/catch + toast in app.js are listed
// here. Legacy dialog saves remain untouched until their handler-level catches are
// addressed in their owning slice; this polish layer does not pretend to own them.
const asyncActionSelector = [
  '[data-quick]',
  '[data-train]',
  '[data-complete]',
  '[data-buy]',
  '[data-putaway]',
  '[data-place]',
  '[data-place-tray]',
  '[data-store]',
  '[data-toggle-quest]',
  '[data-approve]',
  '#undo-btn',
  '#make-code-btn',
  '#make-coparent-code-btn'
].join(',');

const busyButtons = new Set();
const busyTimers = new WeakMap();

function releaseBusy(button) {
  if (!button) return;
  const timer = busyTimers.get(button);
  if (timer) clearTimeout(timer);
  busyTimers.delete(button);
  busyButtons.delete(button);
  if (!button.isConnected) return;
  delete button.dataset.polishBusy;
  button.removeAttribute('aria-busy');
  button.removeAttribute('aria-disabled');
}

function releaseAllBusy() {
  [...busyButtons].forEach(releaseBusy);
}

function markBusy(button) {
  if (!button || button.disabled || button.dataset.polishBusy === 'true') return;
  button.dataset.polishBusy = 'true';
  button.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-disabled', 'true');
  busyButtons.add(button);
  // Safety valve only: normal actions release as soon as their existing toast
  // appears. This prevents a lost response from leaving a control stuck forever.
  busyTimers.set(button, setTimeout(() => releaseBusy(button), 8000));
}

// Block only repeated activation of a control already marked busy. Capture phase
// ensures the second click never reaches app.js; the first click is unaffected.
document.addEventListener('click', (event) => {
  const busy = event.target.closest('[data-polish-busy="true"]');
  if (!busy) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

document.addEventListener('click', (event) => {
  const button = event.target.closest(asyncActionSelector);
  if (!button || button.disabled) return;
  // Deferring one microtask is intentional: the original app handler gets the
  // click first, so this layer can never block the action it is decorating.
  queueMicrotask(() => {
    if (button.isConnected && !button.disabled) markBusy(button);
  });
});

// The app already reports the result of these operations through one shared
// toast. Treat that as the presentation-level completion signal.
const toast = document.getElementById('toast');
if (toast) {
  const toastObserver = new MutationObserver(() => {
    if (toast.classList.contains('show')) releaseAllBusy();
  });
  toastObserver.observe(toast, { attributes: true, attributeFilter: ['class'], childList: true });
}

syncPolishSemantics();

const observer = new MutationObserver(() => syncPolishSemantics());
observer.observe(document.getElementById('app') || document.body, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['class']
});
