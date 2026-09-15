import * as vscode from 'vscode';
import { FilePreviewData } from './shared';

export async function readFilePreview(uri: vscode.Uri, location: { line?: number; column?: number }): Promise<FilePreviewData> {
  const result: FilePreviewData = { path: uri.fsPath, ...location };
  try {
    const info = await vscode.workspace.fs.stat(uri);
    if (info.type & vscode.FileType.Directory) return { ...result, error: 'This link points to a folder.' };
    if (info.size > 2_000_000) return { ...result, note: 'This file is too large for a quick preview. Open it in a background tab to review it.' };
    // Use the document model so unsaved edits and the user's file encoding are respected.
    const document = await vscode.workspace.openTextDocument(uri);
    const line = location.line ? Math.min(location.line, document.lineCount) : undefined;
    const start = Math.max(0, (line ?? 1) - 101);
    const end = Math.min(document.lineCount, start + 1200);
    const text = document.getText(new vscode.Range(start, 0, end, 0));
    if (text.includes('\0')) return { ...result, note: 'A text preview is unavailable for this file. Open it in a background tab to review it.' };
    const content = text.slice(0, 200_000);
    return { ...result, line, content, startLine: start + 1,
      ...(start > 0 || end < document.lineCount || content.length < text.length ? { note: 'Showing an excerpt. Open in a background tab to review the full file.' } : {}) };
  } catch (error) {
    return { ...result, error: error instanceof Error ? error.message : String(error) };
  }
}
