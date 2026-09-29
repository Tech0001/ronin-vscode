import * as vscode from 'vscode';
import { extname } from 'node:path';
import { FilePreviewData } from './shared';

const imageTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};
const imageLimit = 10_000_000;

export async function readFilePreview(uri: vscode.Uri, location: { line?: number; column?: number }): Promise<FilePreviewData> {
  const result: FilePreviewData = { path: uri.fsPath, ...location };
  try {
    const info = await vscode.workspace.fs.stat(uri);
    if (info.type & vscode.FileType.Directory) return { ...result, error: 'This link points to a folder.' };
    const mime = imageTypes[extname(uri.path).toLowerCase()];
    if (mime) {
      const largeImage = { path: result.path, note: 'This image is too large for a quick preview. Open it in a background tab to review it.' };
      if (info.size > imageLimit) return largeImage;
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > imageLimit) return largeImage;
      return { path: result.path, image: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` };
    }
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
