import * as vscode from 'vscode';

export interface ReferencePage {name: string; html: string; owner?: string; parameter?: string;}
export interface Reference {
  at(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<ReferencePage | null>;
  named(name: string): Promise<ReferencePage | null>;
  search(show: (page: ReferencePage) => Promise<void>, query?: string): Promise<void>;
  complete(): void;
  rebuild(): Promise<unknown>;
  reset(): Promise<unknown>;
  dispose(): void;
}
export function cellStart(document: vscode.TextDocument): {line: number; character: number};
export function createReference(context: vscode.ExtensionContext, changed: () => void,
  target: () => {document: vscode.TextDocument; selection: vscode.Selection} | undefined): Reference;
