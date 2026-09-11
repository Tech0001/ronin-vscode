import { describe, it, expect } from "vitest";
import { quoteTerminalPaths, terminalFileTarget } from "./terminalFiles";

describe("terminal file insertion", () => {
  it("quotes spaces, apostrophes, and shell metacharacters without submitting", () => {
    expect(quoteTerminalPaths(["/tmp/my image.png", "/tmp/it's$(id).txt"])).toBe("'/tmp/my image.png' '/tmp/it'\\''s$(id).txt' ");
    expect(() => quoteTerminalPaths(["/tmp/a\nwhoami"])).toThrow();
  });
  it("resolves file references against the terminal directory", () => {
    expect(terminalFileTarget("src/main.rs:42:3", "/project")).toEqual({ path: "/project/src/main.rs", line: 42 });
    expect(terminalFileTarget("/project/README.md", "/elsewhere")).toEqual({ path: "/project/README.md" });
    expect(terminalFileTarget("file:///project/my%20file.txt", "")).toEqual({ path: "/project/my file.txt" });
  });
});
