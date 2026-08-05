'use strict';

(function loadCatTrainerApplication() {
  const files = ['app-core.js', 'app-ui.js'];

  function loadNext(index) {
    if (index >= files.length) return;
    const script = document.createElement('script');
    script.src = files[index];
    script.onload = () => loadNext(index + 1);
    script.onerror = () => {
      console.error(`Could not load ${files[index]}.`);
      const toast = document.querySelector('#toast');
      if (toast) {
        toast.textContent = 'Cat Trainer could not finish loading. Refresh once while online.';
        toast.classList.add('show');
      }
    };
    document.body.appendChild(script);
  }

  loadNext(0);
})();
