import * as vscode from 'vscode';
import { cellStart } from '../reference/service';

export type EditorTarget = {document: vscode.TextDocument; selection: vscode.Selection};

// VS Code can keep an old text editor around while the notebook is in cell navigation mode.
export class EditorTargets {
	private readonly selections = new WeakMap<vscode.TextDocument, vscode.Selection>();

	public remember(editor: vscode.TextEditor) {
		if (editor.document.uri.scheme === 'vscode-notebook-cell') {
			this.selections.set(editor.document, editor.selection);
		}
	}

	public current(): EditorTarget | undefined {
		const notebook = vscode.window.activeNotebookEditor;
		const active = vscode.window.activeTextEditor;
		if (!notebook) {
			return active && {document: active.document, selection: active.selection};
		}
		const index = notebook.selection.start;
		if (index >= notebook.notebook.cellCount) { return; }
		const cell = notebook.notebook.cellAt(index);
		if (cell.kind !== vscode.NotebookCellKind.Code) { return; }
		const doc = cell.document;
		if (active?.document === doc) {
			return {document: doc, selection: active.selection};
		}
		const saved = this.selections.get(doc);
		if (saved) {
			return {document: doc, selection: new vscode.Selection(
				doc.validatePosition(saved.anchor), doc.validatePosition(saved.active))};
		}
		const initial = doc.languageId === 'python' ? cellStart(doc) : {line: 0, character: 0};
		const pos = new vscode.Position(initial.line, initial.character);
		return {document: doc, selection: new vscode.Selection(pos, pos)};
	}
}
