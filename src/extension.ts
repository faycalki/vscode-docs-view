import * as vscode from 'vscode';
import { DocsViewViewProvider } from './docsView';

import { EditorTargets } from './editorTarget';
import { createReference } from '../reference/service';

export function activate(context: vscode.ExtensionContext) {

	const targets = new EditorTargets();
	const reference = createReference(context, () => provider.refresh(), () => targets.current());
	const provider = new DocsViewViewProvider(context.extensionUri, reference, targets);
	const report = (e: Error) => { vscode.window.showErrorMessage('Python Syntax Shelf: ' + e.message); };
	const search = (query?: string) => reference.search(page => provider.showReference(page), query).catch(report);
	context.subscriptions.push(reference,
		vscode.commands.registerCommand('pythonSyntaxShelf.searchPythonReference', search),
		vscode.commands.registerCommand('pythonSyntaxShelf.completeSearch', () => reference.complete()),
		vscode.commands.registerCommand('pythonSyntaxShelf.indexEnvironment', () => reference.rebuild().catch(report)),
		vscode.commands.registerCommand('pythonSyntaxShelf.useBundledReference', () => reference.reset().catch(report)),
		vscode.window.registerUriHandler({handleUri(uri) {
			if (uri.path === '/search') { return search(new URLSearchParams(uri.query).get('q') ?? ''); }
		}}));
	context.subscriptions.push(provider);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(DocsViewViewProvider.viewType, provider));

	context.subscriptions.push(
		vscode.commands.registerCommand('pythonSyntaxShelf.documentationView.pin', () => {
			provider.pin();
		}));

	context.subscriptions.push(
		vscode.commands.registerCommand('pythonSyntaxShelf.documentationView.unpin', () => {
			provider.unpin();
		}));
	provider.revealAutomatically();
}
