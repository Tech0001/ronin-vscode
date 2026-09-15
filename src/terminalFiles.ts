export const terminalPathsMime = "application/x-ronin-paths";

export function quoteTerminalPaths(paths: string[]): string {
  if (paths.some((path) => /[\x00-\x1f\x7f]/.test(path))) throw new Error("File paths with control characters cannot be pasted safely.");
  return paths.map((path) => "'" + path.replace(/'/g, "'\\''") + "'").join(" ") + " ";
}

export function terminalFileTarget(text: string, cwd: string, home?: string): { path: string; line?: number; column?: number } {
  const match = /^(.*?)(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?)?$/.exec(text)!;
  let path = match[1];
  if (path.startsWith("file://")) path = decodeURIComponent(new URL(path).pathname);
  if (path.startsWith('~/') && home) path = home.replace(/\/$/, '') + path.slice(1);
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path) && cwd) path = `${cwd.replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`;
  const line = Number(match[2] ?? match[4]), column = Number(match[3] ?? match[5]);
  return { path, ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}), ...(Number.isSafeInteger(column) && column > 0 ? { column } : {}) };
}
