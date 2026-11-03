/* global acquireVsCodeApi, DOMPurify */
(() => {
  const api = acquireVsCodeApi();
  const main = document.getElementById('main');
  let currentName, lastBody, lastHover;
  const clean = (html) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  window.addEventListener('message', ({ data }) => {
    if (data.type === 'noContent') {
      const p = document.createElement('p');
      p.className = 'no-content';
      p.textContent = data.body;
      main.replaceChildren(p);
      currentName = lastBody = lastHover = undefined;
      return;
    }
    if (data.type !== 'update') return;
    // A language server may answer after the reference appeared. Keep its scroll and open sections.
    if (currentName !== data.reference || lastBody !== data.body) {
      main.innerHTML = clean(data.body);
      currentName = data.reference;
      lastBody = data.body;
      lastHover = undefined;
      window.scrollTo(0, 0);
    }
    if (!data.reference || lastHover === data.hover) return;
    main.querySelector('#native-hover')?.remove();
    lastHover = data.hover;
    if (data.hover) {
      const details = document.createElement('details'),
        summary = document.createElement('summary'),
        content = document.createElement('div');
      details.id = 'native-hover';
      summary.textContent = 'Editor hover';
      content.innerHTML = clean(data.hover);
      details.append(summary, content);
      main.append(details);
    }
  });
  api.postMessage({ type: 'ready' });
})();
