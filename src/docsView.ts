import * as vscode from 'vscode';
import { Renderer } from './renderer';
import type { Reference, ReferencePage } from '../reference/service';
import { settingEnabled } from '../reference/service';

import { EditorTargets, EditorTarget } from './editorTarget';

type Tab = 'cursor' | 'search';

interface Card {
	body: string;
	page?: ReferencePage;
	hover?: string;
	back?: Card;
}

export class DocsViewViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'pythonSyntaxShelf.documentation';

	private static readonly pinnedContext = 'pythonSyntaxShelf.documentationView.isPinned';

	private readonly _disposables: vscode.Disposable[] = [];

	private readonly _renderer = new Renderer();

	private _view?: vscode.WebviewView;
	private _currentCacheKey: CacheKey = cacheKeyNone;
	private _loading?: { cts: vscode.CancellationTokenSource };

	private readonly _cards: Partial<Record<Tab, Card>> = {};
	private _tab: Tab = 'cursor';
	private _autoOpen = true;
	private _revealing = false;
	private _pinned = false;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _reference: Reference,
		private readonly _targets: EditorTargets,
	) {
		const moved = () => {
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
			if (e.affectsConfiguration('pythonSyntaxShelf') || e.affectsConfiguration('docsView')) {
				this.revealAutomatically();
				this.refresh();
			}
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
				this.sendCard();
				this.update(/* force */ true);
			}
		});

		webviewView.onDidDispose(() => {
			if (this._view === webviewView) { this._view = undefined; }
		});

		webviewView.webview.onDidReceiveMessage(message => {
			if (this._view !== webviewView) { return; }
			if (message?.type === 'parent') { this.showParent().catch(e => vscode.window.showErrorMessage('Python Syntax Shelf: ' + e.message)); }
			if (message?.type === 'back') {
				const back = this.visibleCard()?.back;
				if (back) {
					this.cancel();
					this._cards[this._tab] = back;
					this.sendCard();
				}
			}
			if (message?.type === 'tab' && (message.tab === 'cursor' || message.tab === 'search')) {
				this.selectTab(message.tab);
			}
			if (message?.type === 'search') { vscode.commands.executeCommand('pythonSyntaxShelf.searchPythonReference', ''); }
			if (message?.type === 'ready') { this.sendCard(); }
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
		if (value) { this.cancel(); } else { this._currentCacheKey = cacheKeyNone; }
		this.updateTitle();
		vscode.commands.executeCommand('setContext', DocsViewViewProvider.pinnedContext, value);

		this.update();
	}

	private updateTitle() {
		if (!this._view) {
			return;
		}
		this._view.description = this._pinned && this._tab === 'cursor' ? "(pinned)" : undefined;
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
				<div class="shelf-nav">
					<div role="tablist" aria-label="Documentation source">
						<button type="button" id="cursor-tab" role="tab" data-tab="cursor" aria-selected="true" aria-controls="main">Cursor</button>
						<button type="button" id="search-tab" role="tab" data-tab="search" aria-selected="false" aria-controls="main" tabindex="-1">Search</button>
					</div>
					<button type="button" id="new-search" hidden>New search…</button>
				</div>
				<article id="main" role="tabpanel" aria-labelledby="cursor-tab" tabindex="0"></article>

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

	private visibleCard(): Card | undefined {
		return this._cards[this._tab] ?? this._cards.search;
	}

	private sendCard() {
		const card = this.visibleCard();
		this._view?.webview.postMessage(card ? {
			type: 'update', tab: this._tab, body: card.body, hover: card.hover,
			reference: card.page?.name, parameter: card.page?.parameter, back: !!card.back,
		} : {type: 'noContent', tab: this._tab});
	}

	private selectTab(tab: Tab) {
		if (tab === 'search' && !this._cards.search) {
			vscode.commands.executeCommand('pythonSyntaxShelf.searchPythonReference', '');
			return;
		}
		if (this._tab !== tab) {
			this.cancel();
			this._tab = tab;
			this.updateTitle();
			vscode.commands.executeCommand('setContext', 'pythonSyntaxShelf.showingSearch', tab === 'search');
		}
		this.sendCard();
		if (tab === 'cursor') { this.update(true); }
	}

	public refresh() { this.update(true); }

	public revealAutomatically() {
		if (!this._autoOpen || this._view?.visible || this._revealing) { return; }
		this._revealing = true;
		Promise.resolve(vscode.commands.executeCommand(DocsViewViewProvider.viewType + '.focus', {preserveFocus: true}))
			.catch(e => console.warn('Python Syntax Shelf could not open', e))
			.finally(() => { this._revealing = false; });
	}

	private async showParent() {
		const tab = this._tab;
		const from = this.visibleCard();
		if (!from?.page?.owner) { return; }
		const page = await this._reference.named(from.page.owner);
		if (!page || this._tab !== tab || this.visibleCard()?.page !== from.page) { return; }
		this.cancel();
		this._cards[tab] = {body: page.html, page, back: from};
		this.sendCard();
	}

	public async showReference(page: ReferencePage) {
		this._cards.search = {body: page.html, page};
		this.selectTab('search');
		if (!this._view?.visible) {
			await vscode.commands.executeCommand(DocsViewViewProvider.viewType + '.focus', {preserveFocus: true});
		}
	}

	private async update(ignoreCache = false) {
		if (!this._view?.visible || this._pinned || this._tab !== 'cursor') { return; }
		const editor = this._targets.current();
		const key = createCacheKey(editor);
		if (!ignoreCache && cacheKeyEquals(this._currentCacheKey, key)) { return; }
		this._currentCacheKey = key;
		this.cancel();
		if (!editor) { return; }

		const current = {cts: new vscode.CancellationTokenSource()};
		this._loading = current;
		const token = current.cts.token;
		const doc = editor.document;
		const pos = editor.selection.active;
		let page: ReferencePage | null = null;
		let hover = '';
		const paint = () => {
			if (this._loading !== current || token.isCancellationRequested) { return; }
			const body = page?.html || hover;
			if (body) {
				this._cards.cursor = {body, page: page ?? undefined, hover};
				this.sendCard();
			}
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
		if (this._loading === current) {
			this._loading = undefined;
			current.cts.dispose();
		}
	}

	private updateConfiguration() {
		this._autoOpen = settingEnabled('documentationView.autoOpen');
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
