/* global acquireVsCodeApi, DOMPurify */
(() => {
  const api = acquireVsCodeApi();
  const main = document.getElementById('main');
  const tabs = [...document.querySelectorAll('.shelf-nav [role="tab"]')];
  const newSearch = document.getElementById('new-search');
  newSearch.addEventListener('click', () => api.postMessage({ type: 'search' }));
  for (const tab of tabs) {
    tab.addEventListener('click', () => api.postMessage({ type: 'tab', tab: tab.dataset.tab }));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'Home') next = tabs[0];
      else if (event.key === 'End') next = tabs[tabs.length - 1];
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = tabs.find((other) => other !== tab);
      if (next) {
        event.preventDefault();
        next.focus();
        next.click();
      }
    });
  }
  let currentName, lastBody, lastHover, lastParameter;
  const clean = (html) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });

  function button(label, action) {
    const control = document.createElement('button');
    control.textContent = label;
    control.dataset.refAction = action;
    return control;
  }

  function clearHighlight() {
    main.querySelector('.ref-active-param')?.classList.remove('ref-active-param');
  }

  function reveal(element, focus) {
    const section = element?.closest('details');
    if (section) section.open = true;
    element?.scrollIntoView({ block: 'nearest' });
    if (focus) element?.focus({ preventScroll: true });
  }

  function jumpToParameter(name, focus) {
    clearHighlight();
    const row = [...main.querySelectorAll('.ref-definition')].find((el) =>
      el.dataset.params.split(' ').includes(name)
    );
    if (row) {
      row.classList.add('ref-active-param');
      reveal(row, focus);
    }
  }

  main.addEventListener('click', (event) => {
    const control = event.target.closest('button');
    if (!control || control.closest('#native-hover') || !main.contains(control)) return;
    if (control.dataset.paramJump) jumpToParameter(control.dataset.paramJump, true);
    else if (control.dataset.sectionJump) {
      const section = [...main.querySelectorAll('.ref-section')].find(
        (s) => s.dataset.section === control.dataset.sectionJump
      );
      if (section) {
        section.open = true;
        reveal(section.querySelector('summary'), true);
      }
    } else if (['parent', 'back', 'search'].includes(control.dataset.refAction)) {
      api.postMessage({ type: control.dataset.refAction });
    }
  });

  window.addEventListener('message', ({ data }) => {
    if (data.type !== 'noContent' && data.type !== 'update') return;
    for (const tab of tabs) {
      const active = tab.dataset.tab === data.tab;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active) main.setAttribute('aria-labelledby', tab.id);
    }
    newSearch.hidden = data.tab !== 'search';
    if (data.type === 'noContent') {
      if (lastBody === null) return;
      const empty = document.createElement('div'),
        title = document.createElement('strong'),
        hint = document.createElement('p');
      empty.className = 'ref-empty';
      title.textContent = 'Documentation';
      hint.textContent = 'Place the cursor on a symbol in a file or notebook cell.';
      empty.append(title, hint, button('Search Python Reference', 'search'));
      main.replaceChildren(empty);
      lastBody = null;
      currentName = lastHover = lastParameter = undefined;
      return;
    }
    if (currentName !== data.reference || lastBody !== data.body) {
      main.innerHTML = clean(data.body);
      currentName = data.reference;
      lastBody = data.body;
      lastHover = lastParameter = undefined;
      window.scrollTo(0, 0);
    }
    // Late language-server updates must preserve the reader's scroll and expanded sections.
    const back = main.querySelector('.ref-back');
    if (data.back && !back) {
      const control = button('← Back to member', 'back');
      control.className = 'ref-back';
      main.prepend(control);
    } else if (!data.back && back) back.remove();
    if (data.parameter !== lastParameter) {
      lastParameter = data.parameter;
      if (data.parameter) jumpToParameter(data.parameter, false);
      else {
        clearHighlight();
        window.scrollTo(0, 0);
      }
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
