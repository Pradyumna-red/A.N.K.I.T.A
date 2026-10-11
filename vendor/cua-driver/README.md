# Windows owned-window layering

This is a source change to the external Cua Driver, not a second desktop input engine. The pinned upstream revision and unchanged dependency lockfile retain the installed MCP contract. The reviewed source diff includes an app-independent window-family policy and its Rust regressions.

The driver previously pinned its arrow above only the original window and kept it in the ordinary window band. Native menus can be separately owned, topmost windows, so the arrow was painted behind them. The selector now follows visible windows with the driven window's ultimate native owner, chooses the highest of those surfaces, temporarily matches its band and demotes after dismissal or loss of the driven window family. It checks ownership while resting without repainting the desktop. It keeps the overlay transparent to input and preserves non-activation; distinct main windows in one process remain separate families.

Build from a Windows Rust/MSVC development environment with the required Spectre runtime libraries:

```powershell
node scripts/build-computer-driver.mjs
```

The script clones the official pinned source into ANKITA's configuration directory, applies this source diff, runs the full native overlay test set and builds an optimized executable. Both test and build bind the observed native Windows MSVC target and a dedicated output directory, so inherited Cargo output/target settings cannot publish an old binary. It copies the upstream MIT license and writes a receipt with source, dependency-lock, source-diff and executable hashes. It does not install a compiler, change the official Cua installation or connect a new driver automatically. `--source` accepts an existing checkout of the exact reviewed revision; `--output` selects a separate distribution directory. The Windows pull-request workflow builds the same service as a review artifact.

Select the resulting executable in **Computer Use → Driver location**, then Connect. The saved MCP command points to this external service and survives restarting ANKITA. A future official-driver update must retain the ownership correction before replacing this build; a version number alone is insufficient evidence.

Live verification uses `scripts/verify-computer-menus.mjs`: a unique, disposable Notepad document, real Agent/MCP calls, independent read-only Win32 layer inspection of the exact launched driver process, fresh text readback and disk readback after Save. Generated binaries, logs and screenshots are excluded from Git. Runtime library/package vulnerability scanning was unavailable in this session; source provenance and locked compilation are not a vulnerability scan.

Upstream license: MIT, Copyright (c) 2025 Cua AI, Inc. The complete license is retained beside this source change and in the built external service.
