# Ronin Canvas

**Run multiple terminals and AI coding agents side by side inside VS Code.**

Ronin Canvas puts interactive terminals in movable, resizable panels in the main editor area. Keep an agent writing code, another reviewing it, and your development server visible together—without constantly switching terminal tabs.

Every panel is a normal shell. Use your own CLI tools and agent accounts while keeping VS Code's Explorer, editors, and Git tools available.

![Ronin Canvas in VS Code with three agent terminals and the workspace sidebar](media/ronin-canvas.png)

## What it does

- Move, resize, and arrange terminal panels, or let them automatically fit the available space.
- Save your layout and terminal setup for each workspace.
- Keep terminals running in the background when you reload or close VS Code, then reconnect when you return.
- Save and edit launch commands for individual panels.
- See agents and terminals in a sidebar, alongside workspace notes and tasks.
- Follow your VS Code theme, with visible panel borders and a highlighted active terminal.
- Honor VS Code's terminal contrast and bright-color settings (`terminal.integrated.minimumContrastRatio` and `terminal.integrated.drawBoldTextInBrightColors`), including live changes and text selection.
- Use a solid selection highlight in the theme's color, keeping selected text readable across panes. Set `ronin.selectionStyle` to `theme` to use VS Code's selection transparency and inactive styling instead.
- Ctrl-click a file link for a quick preview over the canvas, including paths wrapped across terminal rows. Press Escape to close it. Ctrl-Shift-click (or the preview's **Open in background tab** button) opens a pinned tab in Ronin's editor group while keeping the canvas visible and its layout intact. Web links require Ctrl-click and open in your browser.

**Start** opens a shell. **Run command** launches its saved command. When an agent exits, the shell stays open.

## Get started

**[Download for Mac (Apple Silicon)](https://github.com/Tech0001/ronin-vscode/releases/download/v0.5.4/ronin-canvas-0.5.4-darwin-arm64.vsix)** · **[Download for Linux (x64)](https://github.com/Tech0001/ronin-vscode/releases/download/v0.5.4/ronin-canvas-0.5.4-linux-x64.vsix)** · [Release notes](https://github.com/Tech0001/ronin-vscode/releases/tag/v0.5.4)

1. Download the `.vsix` installer for your platform above.
2. In VS Code, open the Command Palette, run **Extensions: Install from VSIX…**, and select the downloaded file. Reload VS Code if prompted.
3. Open a trusted workspace, select Ronin in the sidebar, and click **Open Canvas** at the bottom. Add a terminal or agent panel and press Start.

You can also open the canvas with **Ronin: Open Canvas** in the Command Palette. The installer includes the native terminal components; no build tools are needed.

**Build targets: Linux x64 and macOS (Apple Silicon and Intel).** The macOS port has been tested on Apple Silicon; Intel requires validation on an Intel Mac. Windows is not supported. Agent CLIs must be installed and authenticated separately.

Closing VS Code leaves your programs running. Use **Ronin: Stop Background Terminals** to stop them. Live sessions do not survive a reboot.

## Build

On macOS, install Node.js/npm and the Xcode Command Line Tools (`xcode-select --install`). Use an arm64 Node.js installation for Apple Silicon or an x64 installation for Intel. On Linux x64, you also need Python 3, Make, a C++ compiler, and Docker.

```bash
git clone https://github.com/Tech0001/ronin-vscode.git
cd ronin-vscode
npm ci
npm run package
```

The installable `.vsix` is created in `release/`, with the platform and architecture in its filename (for example, `ronin-canvas-0.5.4-darwin-arm64.vsix`). Each build targets the architecture of the Node.js process running it. Docker is only used for Linux packaging; macOS packages use node-pty's native prebuild and compile a small helper with the Xcode tools. End users do not need Node.js, Docker, or compilers.

Run `npm test` for unit tests and `npm run test:terminals` for real terminal tests, including persistence, reconnection, resizing, and interrupt handling. On macOS, the terminal tests also cover zsh and agent detection.

The macOS service uses a private directory under `/tmp` to stay within Unix socket path limits, and a native kernel lock to keep concurrent VS Code windows on the same service. Agent detection reads the foreground process arguments using macOS `sysctl`.

## License

[MIT](LICENSE)
