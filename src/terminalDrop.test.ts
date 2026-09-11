import { describe, it, expect } from 'vitest';
import { hasTerminalFileData, terminalDropPaths } from './terminalDrop';

const transfer = (data: Record<string, string>) => {
  const entries = new Map(Object.entries(data).map(([key, value]) => [key.toLowerCase(), value]));
  return { types: [...entries.keys()], getData: (type: string) => entries.get(type.toLowerCase()) ?? '' };
};

describe('terminal file drops', () => {
  it('detects Explorer data while the drag payload is still protected', () => {
    expect(hasTerminalFileData({ types: ['CodeFiles'], getData: () => { throw Error('not readable until drop'); } })).toBe(true);
    expect(hasTerminalFileData(transfer({ 'text/plain': 'echo hello' }))).toBe(false);
  });
  it('prefers the complete Explorer selection over its single-file standard URI', () => {
    expect(terminalDropPaths(transfer({ CodeFiles: JSON.stringify(['/tmp/one.png', "/tmp/it's two.txt"]), 'text/uri-list': 'file:///tmp/one.png' })))
      .toEqual(['/tmp/one.png', "/tmp/it's two.txt"]);
  });
  it('reads the internal multi-file URI list, including directories', () => {
    expect(terminalDropPaths(transfer({ 'application/vnd.code.uri-list': 'file:///tmp/one\r\nfile:///tmp/a%20folder/', 'text/uri-list': 'file:///tmp/one' })))
      .toEqual(['/tmp/one', '/tmp/a folder/']);
  });
  it('reads ResourceURLs and serialized CodeEditors', () => {
    expect(terminalDropPaths(transfer({ ResourceURLs: '["file:///tmp/a%23b.md#L3"]' }))).toEqual(['/tmp/a#b.md']);
    expect(terminalDropPaths(transfer({ CodeEditors: JSON.stringify([{ resource: { $mid: 1, scheme: 'file', path: '/tmp/100% done.md' } }, { resource: 'file:///tmp/b.png' }]) })))
      .toEqual(['/tmp/100% done.md', '/tmp/b.png']);
  });
  it('decodes URI paths once, ignores comments and deduplicates', () => {
    expect(terminalDropPaths(transfer({ 'text/uri-list': '# comment\r\nfile:///tmp/a%2520b.txt\r\nfile:///tmp/a%2520b.txt\r\n' })))
      .toEqual(['/tmp/a%20b.txt']);
  });
  it('preserves drive and UNC paths', () => {
    expect(terminalDropPaths(transfer({ 'text/uri-list': 'file:///C:/my%20file.txt\nfile://server/share/a.txt' })))
      .toEqual(['C:/my file.txt', '//server/share/a.txt']);
  });
  it('falls back from malformed metadata and ignores non-file resources', () => {
    expect(terminalDropPaths(transfer({ CodeFiles: '{bad', 'text/uri-list': 'https://example.com/a\nfile:///tmp/ok\nfile:///tmp/%ZZ' })))
      .toEqual(['/tmp/ok']);
    expect(terminalDropPaths(transfer({ 'text/plain': 'rm -rf something' }))).toEqual([]);
    expect(terminalDropPaths(transfer({ ResourceURLs: '["vscode-remote://ssh-remote+host/tmp/a"]' }))).toEqual([]);
  });
  it('rejects control characters and relative native paths', () => {
    expect(terminalDropPaths(transfer({ CodeFiles: JSON.stringify(['/tmp/ok', '/tmp/bad\ncommand']) }))).toEqual([]);
    expect(terminalDropPaths(transfer({ 'text/uri-list': 'file:///tmp/bad%1bpath' }))).toEqual([]);
    expect(terminalDropPaths(transfer({ CodeFiles: '["relative.txt"]' }))).toEqual([]);
  });
});
