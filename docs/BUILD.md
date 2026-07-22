# Building Redstone Cowork

This covers building the **desktop app** (the Electron cockpit) into installers on
your own machine. For running the **server**, see the one-line installer in the
[README](../README.md).

> **Key fact:** the desktop app depends on **`node-pty`, a native C/C++ module**. It
> is compiled for the OS you build on, so **each installer must be built on its own
> platform** — you cannot build a Windows `.exe` on macOS, or vice-versa. Building on
> Windows requires a C++ toolchain (see below).

---

## Prerequisites (all platforms)

- **Node.js 22** — https://nodejs.org
- **pnpm 10** — enable it with Corepack (ships with Node):
  ```bash
  corepack enable
  corepack prepare pnpm@10.12.1 --activate
  ```
- **Git**

### Native toolchain for `node-pty`

Pick your platform:

- **Windows** — install **Visual Studio 2022 Build Tools** with the
  **“Desktop development with C++”** workload, plus **Python 3**.
  - Easiest: `winget install Microsoft.VisualStudio.2022.BuildTools` then, in the
    Visual Studio Installer, check **Desktop development with C++**.
  - Also install Python: `winget install Python.Python.3.12`.
  - Use a fresh terminal afterward so the tools are on `PATH`.
- **macOS** — install the Xcode Command Line Tools: `xcode-select --install`.
- **Linux** — install build essentials, e.g. on Debian/Ubuntu:
  `sudo apt-get install -y build-essential python3`.

---

## Build the installers

From the repo root:

```bash
pnpm install                     # install all workspace dependencies
pnpm --filter @rcw/desktop dist  # build + package the app for THIS platform
```

The installers land in **`apps/desktop/dist/`**:

| Platform | Output |
|----------|--------|
| Windows  | `Redstone Cowork-<version>-Setup.exe` (NSIS installer) |
| macOS    | `Redstone Cowork-<version>-arm64.dmg` (+ `.zip`) — arch matches your Mac |
| Linux    | `Redstone Cowork-<version>.AppImage` and `.deb` |

`electron-builder` rebuilds `node-pty` for the bundled Electron automatically, so
there is no separate rebuild step. The build is **unsigned** — on first launch,
macOS needs right-click → **Open**, and Windows needs **More info → Run anyway**.

### Windows troubleshooting

- **`gyp ERR! find VS ... Could not find any Visual Studio installation`** — the C++
  workload isn't installed or isn't on `PATH`. Install “Desktop development with C++”
  (above) and open a new terminal. If it still can't find it, run the build from the
  **“x64 Native Tools Command Prompt for VS 2022”**.
- **`python not found`** — install Python 3 and reopen the terminal.

---

## Develop (no packaging)

```bash
pnpm install
pnpm --filter @rcw/desktop dev   # hot-reloading dev build
pnpm test                        # run the test suite (all packages)
pnpm --filter @rcw/desktop typecheck
```

---

## Release (maintainers)

Pushing a `v*` tag runs [`.github/workflows/release.yml`](../.github/workflows/release.yml),
which builds macOS (arm64 + Intel), Windows and Linux on native GitHub runners and
attaches every installer to a GitHub Release:

```bash
git tag v0.1.0 && git push origin v0.1.0
```
