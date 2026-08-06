'use strict';

(function startCatTrainer(){
  const loadStyle = href => {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = `${href}?v=46`;
    document.head.appendChild(style);
  };

  loadStyle('image-fix.css');
  loadStyle('assets.css');

  const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${src}?v=46`;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`${src} failed to load`));
    document.head.appendChild(script);
  });

  (async () => {
    try {
      await loadScript('app-core.js');
      await loadScript('asset-overrides.js');
      await loadScript('app-ui.js');
    } catch (error) {
      console.error('Cat Trainer app failed to start.', error);
      const toast = document.querySelector('#toast');
      if (toast) {
        toast.textContent = 'Cat Trainer could not start. Please reload while online.';
        toast.classList.add('show');
      }
    }
  })();
})();
