import * as vscode from 'vscode';

export interface ReferencePage {name: string; html: string;}
export interface Reference {
  at(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<ReferencePage | null>;
  search(show: (page: ReferencePage) => Promise<void>, query?: string): Promise<void>;
  complete(): void;
  rebuild(): Promise<unknown>;
  reset(): Promise<unknown>;
  dispose(): void;
}
export function createReference(context: vscode.ExtensionContext, changed: () => void): Reference;
