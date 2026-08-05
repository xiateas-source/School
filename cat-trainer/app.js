'use strict';

(function startCatTrainer(){
  const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${src}?v=44`;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`${src} failed to load`));
    document.head.appendChild(script);
  });

  (async () => {
    try {
      await loadScript('app-core.js');
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
