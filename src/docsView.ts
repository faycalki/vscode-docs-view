import * as vscode from 'vscode';
import { Renderer } from './renderer';
import type { Reference, ReferencePage } from '../reference/service';

import { EditorTargets, EditorTarget } from './editorTarget';

enum UpdateMode {
	Live = 'live',
	Sticky = 'sticky',
}

export class DocsViewViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'docsView.documentation';

	private static readonly pinnedContext = 'docsView.documentationView.isPinned';

	private readonly _disposables: vscode.Disposable[] = [];

	private readonly _renderer = new Renderer();

	private _view?: vscode.WebviewView;
	private _currentCacheKey: CacheKey = cacheKeyNone;
	private _loading?: { cts: vscode.CancellationTokenSource };

	private _last?: {type: string; body: string; reference?: string; hover?: string; parameter?: string; back?: boolean};
	private _manual = false;
	private _autoOpen = true;
	private _revealing = false;
	private _back?: ReferencePage;
	private _page?: ReferencePage;

	private _updateMode = UpdateMode.Live;
	private _pinned = false;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _reference: Reference,
		private readonly _targets: EditorTargets,
	) {
		const moved = () => {
			this._manual = false;
			if (!this._pinned) { this._back = undefined; }
			this.revealAutomatically();
			this.update();
		};
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor || vscode.window.activeNotebookEditor) { moved(); }
			else { this.update(); }
		}, null, this._disposables);
		vscode.window.onDidChangeTextEditorSelection(e => {
			this._targets.remember(e.textEditor);
			if (e.textEditor === vscode.window.activeTextEditor) { moved(); }
		}, null, this._disposables);
		vscode.window.onDidChangeActiveNotebookEditor(editor => {
			if (editor) { moved(); } else { this.update(); }
		}, null, this._disposables);
		vscode.window.onDidChangeNotebookEditorSelection(e => {
			if (e.notebookEditor === vscode.window.activeNotebookEditor) { moved(); }
		}, null, this._disposables);
		vscode.workspace.onDidChangeTextDocument(e => {
			if (!e.contentChanges.length) { return; }
			if (e.document === this._targets.current()?.document) { moved(); return; }
			const nb = vscode.window.activeNotebookEditor;
			if (nb && e.document.uri.scheme === 'vscode-notebook-cell' &&
				nb.notebook.getCells(new vscode.NotebookRange(0, nb.selection.start)).some(c => c.document === e.document)) {
				this.refresh();
			}
		}, null, this._disposables);
		vscode.workspace.onDidChangeNotebookDocument(e => {
			if (e.notebook === vscode.window.activeNotebookEditor?.notebook && e.contentChanges.length) { this.refresh(); }
		}, null, this._disposables);
		this._disposables.push(this._renderer);

		this._renderer.needsRender(() => {
			this.update(/* force */ true);
		}, undefined, this._disposables);

		vscode.workspace.onDidChangeConfiguration(e => {
			this.updateConfiguration();
			if (e.affectsConfiguration('docsView.documentationView.autoOpen')) { this.revealAutomatically(); }
			if (e.affectsConfiguration('docsView')) { this.refresh(); }
		}, null, this._disposables);

		this.updateConfiguration();
		this.update();
	}

	dispose() {
		this.cancel();
		let item: vscode.Disposable | undefined;
		while ((item = this._disposables.pop())) {
			item.dispose();
		}
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, 'media')
			]
		};

		webviewView.onDidChangeVisibility(() => {
			if (this._view?.visible) {
				this.update(/* force */ true);
			}
		});

		webviewView.onDidDispose(() => {
			if (this._view === webviewView) { this._view = undefined; }
		});

		webviewView.webview.onDidReceiveMessage(message => {
			if (this._view !== webviewView) { return; }
			if (message?.type === 'parent') { this.showParent().catch(e => vscode.window.showErrorMessage('Docs View: ' + e.message)); }
			if (message?.type === 'back' && this._back) {
				const previous = this._back;
				this._back = undefined;
				this.showReference(previous, false);
			}
			if (message?.type === 'search') { vscode.commands.executeCommand('docsView.searchPythonReference', ''); }
			if (message?.type === 'ready') {
				if (this._last) { webviewView.webview.postMessage(this._last); }
				else { this.update(true); }
			}
		});
		this.updateTitle();
		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		this.update(/* force */ true);
	}

	public pin() {
		this.updatePinned(true);
	}

	public unpin() {
		this.updatePinned(false);
	}

	private updatePinned(value: boolean) {
		if (this._pinned === value) {
			return;
		}

		this._pinned = value;
		if (value) { this.cancel(); } else { this._manual = false; this._currentCacheKey = cacheKeyNone; }
		this.updateTitle();
		vscode.commands.executeCommand('setContext', DocsViewViewProvider.pinnedContext, value);

		this.update();
	}

	private updateTitle() {
		if (!this._view) {
			return;
		}
		this._view.description = this._pinned ? "(pinned)" : undefined;
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
		const purifyUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vendor', 'purify.min.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

		const nonce = getNonce();

		return /* html */`<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<meta http-equiv="Content-Security-Policy" content="
					default-src 'none';
					style-src ${webview.cspSource} 'unsafe-inline';
					script-src 'nonce-${nonce}';
					img-src data: https:;
					">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleUri}" rel="stylesheet">
				
				<title>Documentation View</title>
			</head>
			<body>
				<article id="main"></article>

				<script nonce="${nonce}" src="${purifyUri}"></script>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}

	private cancel() {
		this._loading?.cts.cancel();
		this._loading?.cts.dispose();
		this._loading = undefined;
	}

	private display(body: string, page?: ReferencePage, hover?: string) {
		if (!body && this._updateMode === UpdateMode.Sticky && this._last?.type === 'update') { return; }
		this._page = page;
		this._last = body ? {type: 'update', body, reference: page?.name, parameter: page?.parameter, back: !!this._back, hover} :
			{type: 'noContent', body: 'No documentation found at current cursor position'};
		this._view?.webview.postMessage(this._last);
	}

	public refresh() { this.update(true); }

	public revealAutomatically() {
		if (!this._autoOpen || this._view?.visible || this._revealing) { return; }
		this._revealing = true;
		Promise.resolve(vscode.commands.executeCommand(DocsViewViewProvider.viewType + '.focus', {preserveFocus: true}))
			.catch(e => console.warn('Docs View could not open', e))
			.finally(() => { this._revealing = false; });
	}

	private async showParent() {
		const from = this._page;
		if (!from?.owner) { return; }
		const page = await this._reference.named(from.owner);
		if (this._page !== from || !page) { return; }
		this._back = from;
		await this.showReference(page, false);
	}

	public async showReference(page: ReferencePage, focus = true) {
		this.cancel();
		this._manual = true;
		this._currentCacheKey = cacheKeyNone;
		if (focus) { this._back = undefined; }
		this.display(page.html, page);
		if (focus) { await vscode.commands.executeCommand(DocsViewViewProvider.viewType + '.focus'); }
		this._view?.webview.postMessage(this._last);
	}

	private async update(ignoreCache = false) {
		if (!this._view?.visible || this._pinned || this._manual) { return; }
		const editor = this._targets.current();
		const key = createCacheKey(editor);
		if (!ignoreCache && cacheKeyEquals(this._currentCacheKey, key)) { return; }
		this._currentCacheKey = key;
		this.cancel();
		if (!editor) { this.display(''); return; }

		const current = {cts: new vscode.CancellationTokenSource()};
		this._loading = current;
		const token = current.cts.token;
		const doc = editor.document;
		const pos = editor.selection.active;
		let page: ReferencePage | null = null;
		let hover = '';
		const paint = (finished = false) => {
			if (this._loading !== current || token.isCancellationRequested) { return; }
			if (page) { this.display(page.html, page, hover); }
			else if (hover || finished) { this.display(hover); }
		};
		const local = this._reference.at(doc, pos, token).then(result => {
			page = result;
			if (page) { paint(); }
		});
		const native = (async () => {
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, pos);
			if (hovers?.length && !token.isCancellationRequested) {
				hover = await this._renderer.render(doc, hovers);
				if (hover) { paint(); }
			}
		})();
		await Promise.allSettled([local, native]);
		paint(true);
		if (this._loading === current) {
			this._loading = undefined;
			current.cts.dispose();
		}
	}

	private updateConfiguration() {
		const config = vscode.workspace.getConfiguration('docsView');
		this._autoOpen = config.get<boolean>('documentationView.autoOpen', true);
		this._updateMode = config.get<UpdateMode>('documentationView.updateMode') || UpdateMode.Live;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}


type CacheKey = typeof cacheKeyNone | DocumentCacheKey;


const cacheKeyNone = { type: 'none' } as const;

class DocumentCacheKey {
	readonly type = 'document';

	constructor(
		public readonly url: vscode.Uri,
		public readonly version: number,
		public readonly wordRange: vscode.Range | undefined,
	) { }

	public equals(other: DocumentCacheKey): boolean {
		if (this.url.toString() !== other.url.toString()) {
			return false;
		}

		if (this.version !== other.version) {
			return false;
		}

		if (other.wordRange === this.wordRange) {
			return true;
		}

		if (!other.wordRange || !this.wordRange) {
			return false;
		}

		return this.wordRange.isEqual(other.wordRange);
	}
}

function cacheKeyEquals(a: CacheKey, b: CacheKey): boolean {
	if (a === b) {
		return true;
	}

	if (a.type !== b.type) {
		return false;
	}

	if (a.type === 'none' || b.type === 'none') {
		return false;
	}

	return a.equals(b);
}

function createCacheKey(editor: EditorTarget | undefined): CacheKey {
	if (!editor) {
		return cacheKeyNone;
	}

	return new DocumentCacheKey(
		editor.document.uri,
		editor.document.version,
		editor.document.getWordRangeAtPosition(editor.selection.active));
}
