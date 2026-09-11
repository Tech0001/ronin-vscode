import { terminalPathsMime } from './terminalFiles';

type Transfer = Pick<DataTransfer, 'types' | 'getData'>;
const fileTypes = [terminalPathsMime, 'codefiles', 'application/vnd.code.uri-list', 'resourceurls', 'codeeditors', 'text/uri-list'];

export function hasTerminalFileData(transfer: Transfer): boolean {
  return Array.from(transfer.types).some(type => fileTypes.includes(type.toLowerCase()));
}

function arrayData(transfer: Transfer, type: string): unknown[] {
  try { const data = JSON.parse(transfer.getData(type)); return Array.isArray(data) ? data : []; }
  catch { return []; }
}

function fileUriPath(value: unknown): string | undefined {
  try {
    const uri = typeof value === 'string' ? new URL(value) : value as { scheme?: string; path?: string; authority?: string } | null;
    if (uri instanceof URL) {
      if (uri.protocol !== 'file:') return;
      return normalizeFilePath(decodeURIComponent(uri.pathname), uri.hostname);
    }
    if (uri?.scheme === 'file' && typeof uri.path === 'string') return normalizeFilePath(uri.path, uri.authority ?? '');
  } catch { /* Ignore malformed and non-file resources. */ }
}

function normalizeFilePath(path: string, authority: string): string {
  if (authority && authority !== 'localhost') return `//${authority}${path}`;
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

function safePaths(values: unknown[]): string[] {
  // Fail closed on control characters: never turn a filename into terminal keys.
  if (values.some(value => typeof value === 'string' && /[\x00-\x1f\x7f]/.test(value))) return [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value)))];
}

/** Prefer VS Code's complete selection: text/uri-list can contain only one file. */
export function terminalDropPaths(transfer: Transfer): string[] {
  for (const type of [terminalPathsMime, 'codefiles']) {
    const values = arrayData(transfer, type);
    if (values.length) return safePaths(values);
  }
  const internal = transfer.getData('application/vnd.code.uri-list');
  const resources = arrayData(transfer, 'resourceurls');
  const editors = arrayData(transfer, 'codeeditors');
  const values = internal ? internal.split(/\r?\n/).filter(line => line && !line.startsWith('#'))
    : resources.length ? resources
    : editors.length ? editors.map(editor => (editor as { resource?: unknown } | null)?.resource)
    : transfer.getData('text/uri-list').split(/\r?\n/).filter(line => line && !line.startsWith('#'));
  return safePaths(values.map(fileUriPath));
}
