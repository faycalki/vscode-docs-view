'use strict';
const vscode = require('vscode');
const { createEnvironment } = require('./environment');
const {
  analyze,
  resolve,
  symbolAt,
  fromDefinition,
  keywordCall,
  cellStart
} = require('./python-symbols');
const { seedAt } = require('./catalog');

const { formatEntry } = require('./format');

function settingEnabled(key, resource) {
  const config = vscode.workspace.getConfiguration('pythonSyntaxShelf', resource);
  const setting = config.inspect(key);
  if (setting && [setting.globalValue, setting.workspaceValue, setting.workspaceFolderValue]
    .some((value) => value !== undefined)) return config.get(key);
  // Honor settings saved by the earlier VSIX until the new setting is configured.
  return vscode.workspace.getConfiguration('docsView', resource).get(key, config.get(key, true));
}

function previousCells(doc) {
  if (doc.uri.scheme !== 'vscode-notebook-cell') return [];
  const editor = vscode.window.activeNotebookEditor;
  let notebook = editor?.notebook;
  let index = editor?.selection.start ?? -1;
  if (!notebook || index < 0 || index >= notebook.cellCount || notebook.cellAt(index).document !== doc) {
    notebook = vscode.workspace.notebookDocuments.find((nb) =>
      nb.getCells().some((cell) => cell.document === doc)
    );
    if (!notebook) return [];
    index = notebook.getCells().findIndex((cell) => cell.document === doc);
  }
  return notebook
    .getCells(new vscode.NotebookRange(0, index))
    .filter(
      (cell) => cell.kind === vscode.NotebookCellKind.Code && cell.document.languageId === 'python'
    )
    .map((cell) => cell.document);
}
function createReference(context, changed, targetEditor) {
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
        .then((body) => formatEntry(e, body, c))
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
      !settingEnabled('pythonReference.enabled', doc.uri)
    )
      return null;
    const lines = analyze(doc).lines;
    const call = keywordCall(lines, pos);
    const lookup = call ? new vscode.Position(call.position.line, call.position.character) : pos;
    const target = symbolAt(lines[lookup.line] || '', lookup.character);
    if (!target || token.isCancellationRequested) return null;
    const c = await env.catalog();
    if (token.isCancellationRequested) return null;
    let entry = resolve(doc, lookup, c, previousCells(doc));
    if (!entry) {
      const locations = await vscode.commands.executeCommand(
        'vscode.executeDefinitionProvider',
        doc.uri,
        lookup
      );
      if (token.isCancellationRequested || locations?.length !== 1) return null;
      const uri = locations[0].targetUri || locations[0].uri;
      if (uri) entry = fromDefinition(uri.path, target.leaf, c);
    }
    if (!entry || token.isCancellationRequested) return null;
    const page = await render(c, entry);
    return call ? { ...page, parameter: call.parameter } : page;
  }
  async function search(show, explicit) {
    const editor = targetEditor();
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
    qp.value = String(typeof explicit === 'string' ? explicit : fromCursor)
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
      // Assign focus to the ranked match as soon as the query results change.
      qp.activeItems = qp.items.slice(0, 1);
    };
    let accepting = false;
    const subscriptions = [
      qp.onDidChangeValue(setItems),
      qp.onDidAccept(async () => {
        const item = qp.selectedItems[0] || qp.activeItems[0];
        if (!item || !c || accepting) return;
        accepting = true;
        qp.busy = true;
        try {
          const page = await render(c, item.entry);
          if (picker !== qp) return;
          qp.hide();
          await show(page);
          await context.workspaceState.update(
            'reference.recent',
            [item.entry.name, ...recent.filter((n) => n !== item.entry.name)].slice(0, 8)
          );
        } catch (err) {
          if (picker === qp) qp.hide();
          vscode.window.showErrorMessage('Python Syntax Shelf: ' + err.message);
        }
      }),
      qp.onDidHide(() => {
        if (picker === qp) {
          picker = undefined;
          vscode.commands.executeCommand('setContext', 'pythonSyntaxShelf.referencePicker', false);
        }
        for (const sub of subscriptions) sub.dispose();
        qp.dispose();
      })
    ];
    vscode.commands.executeCommand('setContext', 'pythonSyntaxShelf.referencePicker', true);
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
    async named(name) {
      const c = await env.catalog();
      const entry = c.names.get(name);
      return entry ? render(c, entry) : null;
    },
    search,
    complete,
    rebuild: env.rebuild,
    reset: env.reset,
    dispose: () => picker?.dispose()
  };
}
module.exports = { createReference, cellStart, settingEnabled };
