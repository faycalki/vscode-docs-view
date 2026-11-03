'use strict';
const vscode = require('vscode');
const { createEnvironment } = require('./environment');
const { analyze, resolve, symbolAt, fromDefinition } = require('./python-symbols');
const { seedAt } = require('./catalog');

function escape(value) {
  return String(value || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
function renderEntry(entry, body) {
  const sections = [{ title: '', lines: [] }],
    lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const title = lines[i].trim();
    if (title && /^[=~^-]{3,}$/.test((lines[i + 1] || '').trim()) && !/^[=~^-]+$/.test(title)) {
      sections.push({ title, lines: [] });
      i++;
    } else if (/^(args|arguments|keyword args|returns|raises|examples?|shape):$/i.test(title)) {
      sections.push({ title: title.slice(0, -1), lines: [] });
    } else sections[sections.length - 1].lines.push(lines[i]);
  }
  const details = sections
    .map((s) => {
      const txt = s.lines.join('\n').trim();
      if (!s.title)
        return txt && txt !== entry.summary ? '<div class="ref-prose">' + escape(txt) + '</div>' : '';
      return (
        '<details class="ref-section"' +
        (/^(parameters|args|examples?|quick example)$/i.test(s.title) ? ' open' : '') +
        '><summary>' +
        escape(s.title) +
        '</summary><pre>' +
        escape(txt) +
        '</pre></details>'
      );
    })
    .join('');
  return (
    '<section class="ref-card"><div class="ref-meta">' +
    escape(entry.pack.label) +
    ' ' +
    escape(entry.pack.version) +
    ' · ' +
    (entry.pack.local
      ? 'Your environment'
      : entry.pack.kind === 'starter'
        ? 'Starter reference'
        : 'Bundled reference') +
    '</div><h2>' +
    escape(entry.name) +
    '</h2>' +
    (entry.sig ? '<pre class="ref-signature"><code>' + escape(entry.sig) + '</code></pre>' : '') +
    '<p>' +
    escape(entry.summary) +
    '</p>' +
    details +
    '</section>'
  );
}
function previousCells(doc) {
  if (doc.uri.scheme !== 'vscode-notebook-cell') return [];
  for (const notebook of vscode.workspace.notebookDocuments) {
    const cells = notebook.getCells();
    const index = cells.findIndex((c) => c.document === doc);
    if (index >= 0)
      return cells
        .slice(0, index)
        .map((c) => c.document)
        .filter((d) => d.languageId === 'python');
  }
  return [];
}
function createReference(context, changed) {
  let rendered = new Map(),
    picker;
  const env = createEnvironment(context, () => {
    rendered = new Map();
    changed();
  });
  async function render(c, e) {
    if (!rendered.has(e)) {
      if (rendered.size >= 48) rendered.delete(rendered.keys().next().value);
      const task = c
        .body(e.name)
        .then((body) => renderEntry(e, body))
        .catch((err) => {
          rendered.delete(e);
          throw err;
        });
      rendered.set(e, task);
    }
    return rendered.get(e);
  }
  async function at(doc, pos, token) {
    if (
      doc.languageId !== 'python' ||
      !vscode.workspace.getConfiguration('docsView', doc.uri).get('pythonReference.enabled', true)
    )
      return null;
    const line = analyze(doc).lines[pos.line] || '',
      target = symbolAt(line, pos.character);
    if (!target || token.isCancellationRequested) return null;
    const c = await env.catalog();
    if (token.isCancellationRequested) return null;
    let entry = resolve(doc, pos, c, previousCells(doc));
    if (!entry) {
      const locations = await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider',
        doc.uri,
        pos
      );
      if (token.isCancellationRequested || locations?.length !== 1) return null;
      const uri = locations[0].targetUri || locations[0].uri;
      if (uri) entry = fromDefinition(uri.path, target.leaf, c);
    }
    return entry ? { name: entry.name, html: await render(c, entry) } : null;
  }
  async function search(show, explicit) {
    const editor = vscode.window.activeTextEditor;
    const fromCursor =
      editor?.document.languageId === 'python'
        ? editor.selection.isEmpty
          ? seedAt(
              editor.document.lineAt(editor.selection.active.line).text,
              editor.selection.active.character
            )
          : editor.document.getText(editor.selection)
        : '';
    picker?.dispose();
    const qp = vscode.window.createQuickPick();
    picker = qp;
    qp.title = 'Search Python Reference';
    qp.placeholder = 'np.where, df.groupby, train_test_split, list comprehension…';
    qp.value = String(explicit ?? fromCursor ?? '')
      .trim()
      .slice(0, 180);
    qp.valueSelection = [0, qp.value.length];
    let c;
    const recent = context.workspaceState.get('reference.recent', []);
    const setItems = () => {
      if (!c) return;
      qp.items = c.search(qp.value, '', recent, 40).entries.map((e) => ({
        label: e.name,
        description: e.pack.label + ' ' + e.pack.version,
        detail: e.sig || e.summary,
        alwaysShow: true,
        entry: e
      }));
    };
    const subscriptions = [
      qp.onDidChangeValue(setItems),
      qp.onDidAccept(async () => {
        const item = qp.selectedItems[0] || qp.activeItems[0];
        if (!item || !c) return;
        qp.hide();
        try {
          await show({ name: item.entry.name, html: await render(c, item.entry) });
          await context.workspaceState.update(
            'reference.recent',
            [item.entry.name, ...recent.filter((n) => n !== item.entry.name)].slice(0, 8)
          );
        } catch (err) {
          vscode.window.showErrorMessage('Docs View: ' + err.message);
        }
      }),
      qp.onDidHide(() => {
        if (picker === qp) {
          picker = undefined;
          vscode.commands.executeCommand('setContext', 'docsView.referencePicker', false);
        }
        for (const sub of subscriptions) sub.dispose();
        qp.dispose();
      })
    ];
    vscode.commands.executeCommand('setContext', 'docsView.referencePicker', true);
    qp.busy = true;
    qp.show();
    try {
      c = await env.catalog();
      if (picker === qp) {
        qp.busy = false;
        setItems();
      }
    } catch (err) {
      qp.hide();
      throw err;
    }
  }
  function complete() {
    if (picker?.activeItems[0]) picker.value = picker.activeItems[0].label;
  }
  return {
    at,
    search,
    complete,
    rebuild: env.rebuild,
    reset: env.reset,
    dispose: () => picker?.dispose()
  };
}
module.exports = { createReference, renderEntry };
