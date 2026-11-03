import * as vscode from 'vscode';
import { DocsViewViewProvider } from './docsView';

import { createReference } from '../reference/service';

export function activate(context: vscode.ExtensionContext) {

	const reference = createReference(context, () => provider.refresh());
	const provider = new DocsViewViewProvider(context.extensionUri, reference);
	const report = (e: Error) => { vscode.window.showErrorMessage('Docs View: ' + e.message); };
	const search = (query?: string) => reference.search(page => provider.showReference(page), query).catch(report);
	context.subscriptions.push(reference,
		vscode.commands.registerCommand('docsView.searchPythonReference', search),
		vscode.commands.registerCommand('docsView.completeSearch', () => reference.complete()),
		vscode.commands.registerCommand('docsView.indexEnvironment', () => reference.rebuild().catch(report)),
		vscode.commands.registerCommand('docsView.useBundledReference', () => reference.reset().catch(report)),
		vscode.window.registerUriHandler({handleUri(uri) {
			if (uri.path === '/search') { return search(new URLSearchParams(uri.query).get('q') ?? ''); }
		}}));
	context.subscriptions.push(provider);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(DocsViewViewProvider.viewType, provider));

	context.subscriptions.push(
		vscode.commands.registerCommand('docsView.documentationView.pin', () => {
			provider.pin();
		}));

	context.subscriptions.push(
		vscode.commands.registerCommand('docsView.documentationView.unpin', () => {
			provider.unpin();
		}));
}
