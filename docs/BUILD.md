# Building Redstone Cowork

This covers building the **desktop app** (the Electron cockpit) into installers on
your own machine. For running the **server**, see the one-line installer in the
[README](../README.md).

> **No C++ toolchain needed.** The app's one native dependency, **`node-pty`**, ships
> **N-API prebuilt binaries** (ABI-stable, one per platform, for macOS and Windows),
> and packaging does **not** recompile them (`npmRebuild: false`). So there's nothing
> to compile — you just need Node + pnpm, and you can even **cross-build** a Windows
> installer from macOS/Linux.

---

## Prerequisites (all platforms)

- **Node.js 22** — https://nodejs.org
- **pnpm 10** — enable it with Corepack (ships with Node):
  ```bash
  corepack enable
  corepack prepare pnpm@10.12.1 --activate
  ```
- **Git**

That's it — no Visual Studio, no Python, no Xcode build tools.

---

## Build the installers

From the repo root:

```bash
pnpm install                     # install all workspace dependencies
pnpm --filter @rcw/desktop dist  # build + package for THIS platform
```

### Cross-building for another OS

Because nothing is compiled, you can target another platform from any host:

```bash
pnpm --filter @rcw/desktop exec electron-vite build
pnpm --filter @rcw/desktop exec electron-builder --win    # Windows .exe from macOS/Linux
pnpm --filter @rcw/desktop exec electron-builder --linux  # AppImage/.deb
```

Two caveats: a **macOS `.dmg` can only be assembled on macOS** (it uses macOS-only
disk tooling), and a cross-built app is only *proven* once run on its target OS —
so smoke-test the Windows `.exe` on an actual Windows machine.

The installers land in **`apps/desktop/dist/`**:

| Platform | Output |
|----------|--------|
| Windows  | `Redstone Cowork-<version>-Setup.exe` (NSIS installer) |
| macOS    | `Redstone Cowork-<version>-arm64.dmg` (+ `.zip`) — arch matches your Mac |
| Linux    | `Redstone Cowork-<version>.AppImage` and `.deb` |

The build is **unsigned** — on first launch, macOS needs right-click → **Open**, and
Windows needs **More info → Run anyway**.

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
