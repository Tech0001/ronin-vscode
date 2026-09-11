# Ronin Canvas for VS Code

A separate, experimental VS Code extension for Ronin's terminal canvas. The standalone Ronin app is not needed or modified.

This extension contains the terminal canvas and workspace sidebar, with no pipeline editor or automation runtime. Updating preserves existing terminal state and background processes. Previously saved workflow data is left untouched, but is no longer used by Ronin.

# Try it

Install the VSIX from `release/` using **Extensions: Install from VSIX**, open a trusted folder, and run **Ronin: Open Canvas** from the Command Palette. Use **+ Terminal** or **+ Agent** to define a lane, then press **Start**. Agent commands use the CLI tools and authentication already installed on your machine. Commands never auto-start when restoring a workspace.

**Sharing:** use `release/ronin-canvas-0.5.1-terminals-only-linux-x64.vsix` for Linux x64. The package includes the extension and its runtime libraries, not your projects, lane definitions, saved commands, terminal sessions, notes, or credentials. Each recipient sets up their own workspace and optional agent CLIs. After updating an existing installation, use **Developer: Reload Window** to load the new version.

Drag headers to reposition terminals. Substantial overlap reorders neighbors; minor overlap nudges the dragged terminal clear. **Arrange** keeps custom sizes. **Reset sizes** sets uniform sizes. The lower-right corner resizes a pane. Maximize does not restart a terminal. Ordinary scrolling stays inside terminals; scroll the canvas background to navigate the workspace.

Hold **Shift while dropping files from VS Code's Explorer onto a running terminal** to insert quoted file paths without submitting. VS Code intercepts ordinary drops and opens an editor tab; extensions cannot override that host behavior through the public webview API. Multiple selected files and images are inserted as paths, not uploaded or automatically submitted. File-manager drops work when they provide file URIs; browser-only File objects do not expose absolute paths. File links open VS Code's editor beside the canvas. Use VS Code's usual Explorer, Git, language extensions, and editor rather than a second file browser.

**Linux/Wayland limitation:** Shift-drop itself can fail before reaching Ronin,
opening an editor tab or split instead. See [VS Code issue #246418](https://github.com/microsoft/vscode/issues/246418).
The built-in VS Code terminal uses a different drop target and can work despite
this webview limitation. Until the host delivers the drop, use Explorer's
**Copy Path**, then paste into the Ronin terminal. The 0.4.5 parser correction
does not fix this host-level Wayland issue; do not describe it as a complete fix.

Lane definitions, geometry, and column count are stored per VS Code workspace. Reopening that same workspace restores the canvas and reattaches to its live interactive shells and agents. Starting with 0.3.0 on Linux, processes survive closing the canvas, reloading the extension host, and closing VS Code. If no service/session remains (for example, after a reboot), Ronin opens fresh shells, not saved agent commands. Native-terminal-specific VS Code extensions do not automatically apply to custom canvas terminals.

## Background terminals and installation requirements

For the **Linux x64 VSIX**, install VS Code and the extension. No standalone Ronin app, separate Node.js/npm installation, tmux, Python, systemd unit, or manually configured server is needed. The helper uses VS Code's own runtime and the included node-pty binary. It also uses your normal shell and `/usr/bin/flock` from util-linux (normally already present on Arch and Ubuntu).

**macOS and Windows are not supported yet.** The UI has platform-aware keyboard shortcuts, but the background-terminal service currently rejects non-Linux hosts. A native binary rebuild alone will not enable those platforms. A macOS port needs a compatible service-startup/locking mechanism, a macOS node-pty binary (and its spawn helper), platform-specific packaging, and real terminal/reconnect testing. See `src/terminalService/client.ts` and `scripts/build.mjs` as starting points. Other Linux architectures also need their own native build and testing.

Terminal persistence uses the bundled `@xterm/headless` and `@xterm/addon-serialize` libraries. There are seven direct runtime libraries in total, packaged in the VSIX; end users do not install them individually. Third-party notices are included in `dist/licenses`.

Claude, Codex, or other agent CLIs and their authentication are needed only if you want to run those agents. Docker is not needed to run Ronin.

One detached helper starts on demand per workspace and owns its PTYs. It communicates through a user-private, authenticated Unix socket, not a network port. The helper maintains terminal colors, cursor/alternate-screen state and up to 2,000 scrollback lines per lane in memory. This is a bounded recent screen, not a permanent transcript or disk session archive. The helper exits when no clients or live terminals remain.

Closing VS Code now leaves agents running and consuming resources. Use **Ronin: Stop Background Terminals** to stop this workspace's shells and agents without removing their lane definitions. Removing a lane or entering `exit` also stops its shell. Reopening a known exited session does not automatically restart it; use Start. Shells do not survive reboot, helper failure, or an OS logout policy that terminates user processes. Opening the same workspace with a different VS Code profile/workspace identity creates a separate service.

If the connection drops, Ronin shows a reconnecting notice and pauses input. It reattaches without restarting the agent or replaying keystrokes that may have failed. Clipboard shortcuts, file drops, terminal links, Ctrl+C, and resizing still use the same canvas terminal UI.

**Upgrading from 0.2.x:** existing terminals still belong to the old extension host. Finish or save those sessions before the first reload; newly started 0.3.0 terminals use the background helper. An already-running helper is not killed/replaced on subsequent extension updates, preserving its shells.

Agent lanes are interactive shells too: when an agent exits, its shell prompt remains. Ctrl+C interrupts the foreground program; only removing the lane or exiting the shell closes its terminal. **Run command** runs the configured command again (use it at an idle shell prompt). Mouse-clicked pane buttons return focus to the terminal. On Linux and Windows use Ctrl+C to interrupt, Ctrl+Shift+C to copy, and Ctrl+Shift+V to paste. On macOS use Cmd+C/Cmd+V for the clipboard and Ctrl+C to interrupt. These bindings are scoped to a focused Ronin terminal and do not replace VS Code's editor shortcuts.

The live badge follows recognized foreground agent CLIs (Claude, Codex, Gemini, Aider, OpenCode, Goose, Cursor) and returns to Terminal at the shell. Linux detection also handles supported Node-based launchers, without inspecting terminal output or storing process arguments. Other platforms currently use the foreground process name. Pane colors and all 16 terminal ANSI colors follow the active VS Code theme and update without restarting terminals. The outer frame is not scrollable, so resizing cannot push headers or controls out of view.

## Auto-fit and Ronin sidebar

Auto-fit is enabled by default: a single row fills the canvas height, and adding enough panes for another row splits the available height evenly. Removing a row expands the remainder. Minimum pane sizes are 300×220; larger layouts scroll instead of becoming unusably small. Auto-fit also responds to VS Code panel/sidebar resizing. Dragging reorders lanes in auto-fit mode; manually resizing switches to custom mode. Arrange preserves custom sizes, while Reset sizes returns to auto-fit.

Ronin has its own Activity Bar icon and a native, dockable Workspace view. The canvas sidebar icon opens that view; there is no duplicate internal sidebar. Use VS Code's Move View / Move View Container controls to place it in the secondary sidebar and keep Explorer on the left. It includes live agent/terminal groups, lane navigation and command controls, workspace notes, and checkable tasks. Existing notes and tasks are preserved. Notes, tasks, and auto-fit preference are saved per workspace; VS Code manages sidebar placement. This is not yet the full standalone feature set: agent messaging, shared handoffs, and MCP/CLI access are not implemented here.

## Development commands

`npm install`, `npm run build`, `npm test`, `npm run test:terminals`, then `npm run package`. `test:terminals` tests actual background PTYs in a temporary workspace, including client process exit, reconnect/replay, Ctrl+C, resize, authentication and concurrent starts. `tests/terminal-reload.cjs` additionally tests two separate VS Code test-window launches using `RONIN_SERVICE_PHASE=1` then `2` and the same isolated test profile.

Maintainer packaging uses Docker to build node-pty against a pinned Debian Bullseye image, avoiding accidental dependencies on this Arch machine's newer glibc. The build runs without container network access and writes only a disposable build output; it does not change the host's system libraries or Python/Node defaults. Docker/compiler tooling is **not** needed to install or run the resulting extension. Full desktop testing on Ubuntu remains a release-validation step, not something this Arch test run proves.

This VSIX targets **Linux x64**, with node-pty's native binary included. Other operating systems need the service adaptations described above, as well as platform-specific packaging and testing. Linux tests cover real PTYs in the VS Code extension host, frontend layouts, shell quoting, and file reference parsing.

Open a development window with `code --extensionDevelopmentPath="$PWD" .`.

The layout and file-path helpers were adapted from the sibling Ronin repository. Their original MIT license is retained in LICENSE. This repository contains no personal project data, terminal output, credentials, or remote repository configuration.

Use the pencil on any pane to edit its name and launch command, including lanes originally created as plain terminals. Edits are saved for the workspace but never execute immediately. **Start** only opens an interactive shell. **Run command** executes the saved command, opening a shell first if necessary (use it at an idle prompt). Clearing the saved command removes Run command.
