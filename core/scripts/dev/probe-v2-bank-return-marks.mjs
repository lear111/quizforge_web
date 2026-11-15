export function markReturnStart(phases) {
  performance.clearResourceTimings();
  delete window.__qfReturnEnd;
  const previous = document.querySelector('.v2-question-frame iframe');
  const listener = () => {
    if (phases) {
      window.__qfBankReturnPhases = [];
    }
    window.__qfReturnStart = performance.now();
    const observer = new MutationObserver(() => {
      if (
        document.querySelector('.v2-question-frame iframe') === previous ||
        document.querySelector('.v2-card')?.getAttribute('aria-busy') !== 'false'
      ) {
        return;
      }
      observer.disconnect();
      requestAnimationFrame(() => {
        window.__qfReturnEnd = performance.now();
      });
    });
    observer.observe(document.querySelector('.v2-main'), {
      attributes: true,
      childList: true,
      subtree: true,
    });
  };
  document
    .querySelector('.v2-library')
    .addEventListener('click', listener, { once: true, capture: true });
}

export function readReturnTiming() {
  const total = window.__qfReturnEnd - window.__qfReturnStart;
  const phases = (window.__qfBankReturnPhases ?? []).map(([name, at]) => [
    name,
    at - performance.timeOrigin - window.__qfReturnStart,
  ]);
  return {
    total,
    phases,
    requests: performance
      .getEntriesByType('resource')
      .filter((entry) => entry.startTime >= window.__qfReturnStart)
      .map((entry) => ({
        sdk: entry.name.includes('/sdk/'),
        kind: entry.name.includes('/assets/')
          ? 'image'
          : entry.name.includes('/extensions/') || entry.name.includes('/sdk/')
            ? 'type/SDK'
            : 'overview/question',
        start: entry.startTime - window.__qfReturnStart,
        duration: entry.duration,
        bytes: entry.transferSize,
        cacheHit: entry.transferSize === 0,
      })),
  };
}
