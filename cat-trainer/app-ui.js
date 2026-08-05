function rewardChips(quest) {
  const chips = [];
  if (Number(quest.points)) chips.push(`<span class="reward-chip">+${quest.points}m</span>`);
  if (Number(quest.brain)) chips.push(`<span class="reward-chip">★${quest.brain}</span>`);
  if (Number(quest.energy)) chips.push(`<span class="reward-chip">⚡${quest.energy}</span>`);
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

function renderHome() {
  const cat = activeCatState();
  const def = activeCatDef();
  $('#points-total').textContent = state.points;
  $('#active-cat-name').textContent = cat.evolved ? def.evolvedName : def.name;
  $('#active-cat-stage').innerHTML = catArtwork(state.activeCat, cat.evolved);
  $('#peek-cat-art').innerHTML = catArtwork(state.activeCat, cat.evolved);
  $('#brain-value').textContent = `${cat.brain} / 12`;
  $('#energy-value').textContent = `${cat.energy} / 12`;
  $('#bond-value').textContent = `${cat.bond} / 20`;
  $('#brain-meter').style.width = `${(cat.brain / 12) * 100}%`;
  $('#energy-meter').style.width = `${(cat.energy / 12) * 100}%`;
  $('#bond-meter').style.width = `${(cat.bond / 20) * 100}%`;
  $('#coin-total-home').textContent = state.coins;
  const next = state.quests.filter(quest => !state.completed[quest.id]).slice(0,3);
  $('#next-quests').innerHTML = next.length ? next.map(quest => `<div class="quest-mini"><span class="quest-symbol">${sectionMeta[quest.section]?.icon || '•'}</span><div><strong>${escapeHtml(quest.title)}</strong><small>${escapeHtml(quest.section)}</small></div><div class="reward-chips">${rewardChips(quest)}</div></div>`).join('') : '<div class="empty-state">Every quest is complete. Your cats are ready to relax.</div>';
}

function renderQuests() {
  const done = Object.keys(state.completed).filter(id => state.completed[id] && state.quests.some(q => q.id === id)).length;
  $('#quest-done-count').textContent = done;
  $('#quest-left-count').textContent = Math.max(0, state.quests.length - done);
  $('#coin-total-quests').textContent = state.coins;
  $('#quest-sections').innerHTML = Object.keys(sectionMeta).map(section => {
    const quests = state.quests.filter(quest => quest.section === section);
    if (!quests.length) return '';
    return `<section class="quest-group"><div class="quest-group-title"><span>${sectionMeta[section].icon}</span><h3>${section}</h3></div><div class="quest-list">${quests.map(quest => {
      const completed = Boolean(state.completed[quest.id]);
      return `<article class="quest-card ${completed ? 'done' : ''}"><span class="quest-symbol">${sectionMeta[section].icon}</span><div><span class="quest-title">${escapeHtml(quest.title)}</span><div class="quest-reward-line">${escapeHtml(rewardLine(quest))}</div></div><button class="quest-complete" data-complete-quest="${escapeHtml(quest.id)}" ${completed ? 'disabled' : ''} aria-label="${completed ? 'Completed' : `Complete ${escapeHtml(quest.title)}`}">${completed ? '✓' : '+'}</button></article>`;
    }).join('')}</div></section>`;
  }).join('');
}

function renderCats() {
  $('#cat-collection').innerHTML = Object.entries(CAT_DEFS).map(([id, def]) => {
    const cat = state.cats[id];
    const active = id === state.activeCat;
    return `<article class="cat-card ${active ? 'active-cat' : ''}">${cat.evolved ? '<span class="evolved-badge">HERO FORM</span>' : ''}<div class="cat-art">${catArtwork(id, cat.evolved)}</div><h3>${escapeHtml(cat.evolved ? def.evolvedName : def.name)}</h3><p class="cat-subtitle">${escapeHtml(cat.evolved ? def.evolvedTitle : def.title)} · ★${cat.brain}/12 · ⚡${cat.energy}/12</p><div class="cat-card-footer"><button data-select-cat="${id}" ${active ? 'disabled' : ''}>${active ? 'Training' : 'Train'}</button><button class="secondary" data-preview-evolution="${id}">${cat.evolved ? 'View form' : 'Preview hero form'}</button></div></article>`;
  }).join('');
}

function renderCafe() {
  $('#coin-total-cafe').textContent = state.coins;
  $('#cafe-cat').innerHTML = catArtwork(state.activeCat, activeCatState().evolved);
  $('#placed-decor').innerHTML = state.decorOwned.map(id => {
    const decor = DECOR_DEFS[id];
    return decor ? artImage(decor.art, decor.name, `placed-decor-item ${decor.className}`) : '';
  }).join('');
  $('#decor-shop').innerHTML = Object.entries(DECOR_DEFS).map(([id, decor]) => {
    const owned = state.decorOwned.includes(id);
    const affordable = state.coins >= decor.price;
    return `<article class="shop-item"><div class="shop-art">${artImage(decor.art, decor.name)}</div><div><strong>${escapeHtml(decor.name)}</strong><small>● ${decor.price}</small><button data-buy-decor="${id}" ${owned || !affordable ? 'disabled' : ''}>${owned ? 'Placed' : affordable ? 'Buy & place' : 'Need more coins'}</button></div></article>`;
  }).join('');
}

function renderParent() {
  $('#parent-points').textContent = state.points;
  $('#allow-negative').checked = state.settings.allowNegative;
  $('#parent-quest-list').innerHTML = state.quests.map(quest => `<div class="parent-quest-row"><div><strong>${escapeHtml(quest.title)}</strong><small>${escapeHtml(quest.section)} · ${escapeHtml(rewardLine(quest))}</small></div><button class="delete-quest" data-delete-quest="${escapeHtml(quest.id)}" aria-label="Delete ${escapeHtml(quest.title)}">×</button></div>`).join('');
  $('#history-list').innerHTML = state.history.length ? state.history.map(entry => `<div class="history-item"><span class="history-delta ${entry.points < 0 ? 'minus' : 'plus'}">${entry.points >= 0 ? '+' : ''}${entry.points}</span><p>${escapeHtml(entry.reason)}</p><time>${escapeHtml(entry.time)}</time></div>`).join('') : '<div class="empty-state">No point changes yet today.</div>';
}

function renderAll() { renderHome(); renderQuests(); renderCats(); renderCafe(); renderParent(); }

function navigate(screenName) {
  $$('.screen').forEach(screen => screen.classList.toggle('active', screen.dataset.screen === screenName));
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.go === screenName));
  $('.bottom-nav').hidden = screenName === 'parent';
  window.scrollTo({ top:0, behavior:'smooth' });
}

function openParentGate(mode = 'unlock') {
  pendingParentMode = mode;
  $('#pin-input').value = '';
  $('#pin-error').textContent = '';
  $('#pin-title').textContent = mode === 'change' ? 'Change parent PIN' : "Mom's grown-up gate";
  $('#pin-copy').textContent = mode === 'change' ? 'Enter the current PIN first.' : 'Enter your 4-digit PIN.';
  $('#pin-dialog').showModal();
  setTimeout(() => $('#pin-input').focus(), 80);
}

function processPin() {
  const value = $('#pin-input').value.trim();
  if (value !== state.settings.pin) { $('#pin-error').textContent = 'That PIN does not match.'; return false; }
  $('#pin-dialog').close();
  if (pendingParentMode === 'change') {
    const nextPin = window.prompt('Choose a new 4-digit parent PIN:', '');
    if (nextPin && /^\d{4}$/.test(nextPin)) { state.settings.pin = nextPin; saveAndRender(); showToast('Parent PIN changed.'); }
    else if (nextPin !== null) showToast('PIN must be exactly 4 digits.');
  } else navigate('parent');
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
  state.quests.push({ id:`q-${Date.now()}`, title, section:$('#quest-section-input').value, points:Number($('#quest-points-input').value)||0, brain:Math.max(0,Number($('#quest-brain-input').value)||0), energy:Math.max(0,Number($('#quest-energy-input').value)||0), coins:Math.max(0,Number($('#quest-coins-input').value)||0) });
  event.currentTarget.reset();
  $('#quest-points-input').value = 1; $('#quest-energy-input').value = 1; $('#quest-coins-input').value = 1;
  saveAndRender();
  showToast('Recurring quest added.');
}

function deleteQuest(id) {
  const quest = state.quests.find(item => item.id === id);
  if (!quest || !window.confirm(`Delete “${quest.title}” from the daily quest list?`)) return;
  state.quests = state.quests.filter(item => item.id !== id);
  delete state.completed[id];
  saveAndRender();
  showToast('Quest removed.');
}

function startNewDay() {
  if (!window.confirm('Start a fresh day? Today’s point total, completions, and history will reset. Cats, coins, quests, and café decorations will stay.')) return;
  state.date = TODAY(); state.points = 0; state.completed = {}; state.history = [];
  saveAndRender(); navigate('home'); showToast('A fresh day has begun.');
}

function exportBackup() {
  const payload = JSON.stringify({ exportedAt:new Date().toISOString(), app:'Cat Trainer', data:state }, null, 2);
  const blob = new Blob([payload], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `cat-trainer-backup-${TODAY()}.json`; link.click(); URL.revokeObjectURL(url);
  showToast('Backup downloaded to this device.');
}

function bindEvents() {
  document.addEventListener('click', event => {
    const go = event.target.closest('[data-go]'); if (go) return navigate(go.dataset.go);
    const complete = event.target.closest('[data-complete-quest]'); if (complete) return completeQuest(complete.dataset.completeQuest);
    const select = event.target.closest('[data-select-cat]'); if (select) return selectCat(select.dataset.selectCat);
    const preview = event.target.closest('[data-preview-evolution]');
    if (preview) {
      const id = preview.dataset.previewEvolution; const def = CAT_DEFS[id];
      $('#evolution-title').textContent = state.cats[id].evolved ? def.evolvedName : `${def.name}'s Hero Form`;
      $('#evolution-art').innerHTML = catArtwork(id, true);
      $('#evolution-copy').textContent = `${def.evolvedName} appears when both Brain and Energy reach 12.`;
      $('#evolution-dialog').showModal(); return;
    }
    const buy = event.target.closest('[data-buy-decor]'); if (buy) return buyDecor(buy.dataset.buyDecor);
    const adjust = event.target.closest('[data-points]'); if (adjust) return applyPointAdjustment(Number(adjust.dataset.points), adjust.dataset.reason);
    const remove = event.target.closest('[data-delete-quest]'); if (remove) deleteQuest(remove.dataset.deleteQuest);
  });
  $('#open-parent').addEventListener('click', () => openParentGate('unlock'));
  $('#lock-parent').addEventListener('click', () => navigate('home'));
  $('#pin-form').addEventListener('submit', event => { event.preventDefault(); processPin(); });
  $('#custom-adjust-form').addEventListener('submit', event => { event.preventDefault(); const amount=Number($('#custom-points').value)||0; const reason=$('#custom-reason').value.trim()||'Custom adjustment'; applyPointAdjustment(amount,reason,{giveBond:amount>0}); $('#custom-reason').value=''; });
  $('#undo-action').addEventListener('click', undoLastAction);
  $('#add-quest-form').addEventListener('submit', addQuestFromForm);
  $('#allow-negative').addEventListener('change', event => { state.settings.allowNegative=event.target.checked; if(!state.settings.allowNegative) state.points=Math.max(0,state.points); saveAndRender(); showToast(state.settings.allowNegative?'Points may now go below zero.':'Point balance will stop at zero.'); });
  $('#new-day').addEventListener('click', startNewDay);
  $('#change-pin').addEventListener('click', () => openParentGate('change'));
  $('#export-data').addEventListener('click', exportBackup);
  $('#close-evolution').addEventListener('click', () => $('#evolution-dialog').close());
  $('.cafe-peek').addEventListener('keydown', event => { if(event.key==='Enter'||event.key===' ') navigate('cafe'); });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch(error => console.warn('Service worker registration failed.', error));
}

hydrateStaticArt();
bindEvents();
renderAll();
registerServiceWorker();
