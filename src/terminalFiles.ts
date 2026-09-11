export const terminalPathsMime = "application/x-ronin-paths";

export function quoteTerminalPaths(paths: string[]): string {
  if (paths.some((path) => /[\x00-\x1f\x7f]/.test(path))) throw new Error("File paths with control characters cannot be pasted safely.");
  return paths.map((path) => "'" + path.replace(/'/g, "'\\''") + "'").join(" ") + " ";
}

export function terminalFileTarget(text: string, cwd: string): { path: string; line?: number } {
  const match = /^(.*?)(?::(\d+))?(?::\d+)?$/.exec(text)!;
  let path = match[1];
  if (path.startsWith("file://")) path = decodeURIComponent(new URL(path).pathname);
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path) && cwd) path = `${cwd.replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`;
  return { path, ...(match[2] ? { line: Number(match[2]) } : {}) };
}
