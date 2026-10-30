(() => {
  'use strict';
  if (globalThis.__xiaoyaBackgroundInstalled === 4) return;
  globalThis.__xiaoyaBackgroundInstalled = 4;
  let enabled = false;
  // Only suppress front-end focus pauses while the user has started the queue.
  // Actual media time and the platform's progress requests remain untouched.
  for (const [key, activeValue] of [['hidden', false], ['visibilityState', 'visible'], ['webkitHidden', false], ['webkitVisibilityState', 'visible']]) {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, key);
    if (!original?.get) continue;
    Object.defineProperty(document, key, {
      configurable: true,
      get() { return enabled ? activeValue : original.get.call(document); }
    });
  }
  const hasFocus = document.hasFocus;
  if (typeof hasFocus === 'function') {
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value() { return enabled || hasFocus.call(document); }
    });
  }
  window.addEventListener('xiaoya-helper-background', event => {
    enabled = event.detail === true;
  });
  for (const type of ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout']) {
    window.addEventListener(type, event => {
      if (enabled && (event.target === window || event.target === document)) {
        event.stopImmediatePropagation();
      }
    }, true);
  }
})();
