'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(require.resolve('../src/docsView.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const settle = () => new Promise((resolve) => setImmediate(resolve));
const page = (name, owner) => ({ name, html: '<p>' + name + '</p>', owner });

function setup() {
  const events = {};
  const listen = (name) => (callback) => { events[name] = callback; };
  const ignore = () => {};
  const window = {
    onDidChangeActiveTextEditor: listen('editor'),
    onDidChangeTextEditorSelection: ignore,
    onDidChangeActiveNotebookEditor: ignore,
    onDidChangeNotebookEditorSelection: listen('cell')
  };
  const vscode = {
    window,
    workspace: { onDidChangeTextDocument: ignore, onDidChangeNotebookDocument: ignore, onDidChangeConfiguration: ignore },
    commands: { executeCommand: async (id) => id === 'vscode.executeHoverProvider' ? window.hover : undefined },
    Uri: { joinPath: (...segments) => segments.join('/') },
    CancellationTokenSource: class {
      token = { isCancellationRequested: false };
      cancel() { this.token.isCancellationRequested = true; }
      dispose() {}
    }
  };
  const modules = {
    vscode,
    './renderer': { Renderer: class { needsRender() {} render(_doc, hovers) { return hovers[0]; } } },
    '../reference/service': { settingEnabled: () => false }
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (name) => modules[name] });
  const provider = new exports.DocsViewViewProvider('extension', {
    at: async () => window.activeTextEditor?.result ?? null, named: async (name) => page(name)
  }, { current: () => window.activeTextEditor });
  const messages = [];
  provider.resolveWebviewView({
    visible: true, onDidChangeVisibility: listen('visible'), onDidDispose: ignore,
    webview: { asWebviewUri: String, onDidReceiveMessage: listen('message'), postMessage: (data) => messages.push(data) }
  });
  events.message({ type: 'ready' });
  let version = 0;
  return {
    provider, events, last: () => messages.at(-1),
    move(result, hover = []) {
      window.hover = hover;
      window.activeTextEditor = {
        document: { uri: 'file.py', version: ++version, getWordRangeAtPosition: ignore },
        selection: { active: {} }, result
      };
      events.editor(window.activeTextEditor);
    },
    leaveEditor() { window.activeTextEditor = undefined; events.editor(undefined); },
    changeCell() { window.activeNotebookEditor = {}; events.cell({ notebookEditor: window.activeNotebookEditor }); }
  };
}

test('the first page replaces the hint, and empty file, notebook and hover results retain it', async () => {
  const view = setup();
  assert.equal(view.last().type, 'noContent');
  view.move(page('numpy.where'));
  await settle();
  view.move(null);
  await settle();
  view.leaveEditor();
  view.changeCell();
  view.events.message({ type: 'ready' });
  assert.equal(view.last().reference, 'numpy.where');
  view.move(null, ['<p>Native editor documentation</p>']);
  await settle();
  view.move(null);
  await settle();
  assert.equal(view.last().body, '<p>Native editor documentation</p>');
});

test('search survives focus, late lookups, cell changes and reopening, with independent tab navigation', async () => {
  const view = setup();
  let finish;
  view.move(new Promise((resolve) => { finish = resolve; }));
  await view.provider.showReference(page('pandas.DataFrame.groupby', 'pandas.DataFrame'));
  finish(page('obsolete'));
  view.changeCell();
  view.move(page('numpy.where'));
  view.events.visible();
  view.events.message({ type: 'ready' });
  await settle();
  assert.equal(view.last().tab, 'search');
  assert.equal(view.last().reference, 'pandas.DataFrame.groupby');
  view.events.message({ type: 'parent' });
  await settle();
  assert.equal(view.last().reference, 'pandas.DataFrame');
  view.leaveEditor(); // Focusing the sidebar can clear the active notebook editor.
  view.events.message({ type: 'tab', tab: 'cursor' });
  await settle();
  assert.equal(view.last().reference, 'numpy.where');
  view.events.message({ type: 'tab', tab: 'search' });
  assert.equal(view.last().reference, 'pandas.DataFrame');
  view.events.message({ type: 'back' });
  assert.equal(view.last().reference, 'pandas.DataFrame.groupby');
});
