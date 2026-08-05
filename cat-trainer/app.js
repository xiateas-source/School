'use strict';

(function loadCatTrainerApplication() {
  const spriteStyles = document.createElement('style');
  spriteStyles.textContent = `
    .raster-sprite {
      display:inline-block;
      background-image:var(--sprite);
      background-size:var(--ss);
      background-position:var(--sx) var(--sy);
      background-repeat:no-repeat;
      aspect-ratio:1 / 1;
      flex:0 0 auto;
    }
  `;
  document.head.appendChild(spriteStyles);

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
