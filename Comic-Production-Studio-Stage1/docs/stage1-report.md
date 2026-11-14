# Stage 1 hardening report

## Changes in this review

- `packages/project-manager/src/project-manager.mjs`: validates canonical paths and Windows reserved names; rejects symlink/reparse-point components and special files in copied backup/restore trees; checks expected module output folders for write access; refuses recursive self-backup except in the dedicated `Project/backups` folder; generates unique backup names; restores through a validated staging directory and refuses existing destinations/source-nested restores. Failed Project initialization only removes empty directories (non-recursive) rather than deleting an arbitrary tree.
- `packages/project-manager/test/project-manager.test.mjs`: expanded regression coverage for Project creation/open/list, invalid names/paths, reserved Windows names, data preservation/no-overwrite, open in a fresh process, write-access detection, POSIX read-only folders, symlink roots/parents/module folders and backup trees, backup uniqueness, data bytes, identity mismatch, collision refusal, and cleanup after a malformed restore.
- `apps/desktop/src/main/main.ts`, `preload.ts`, `legacy-js.d.ts`, `packages/project-manager/src/project-manager.d.mts`, and `apps/desktop/src/renderer/App.tsx`: exposed folder access diagnostics through the narrow IPC boundary, show read-only module warnings, and log renderer load/failure/crash events to the launcher console.
- `CHAY-COMIC-PRODUCTION-STUDIO.bat`: checks required manifests and Node.js 22.12.0+, detects missing/inconsistent npm dependencies, runs a clean install, builds, explicitly invokes the local Electron CLI to download/verify its OS runtime, and retries one dependency reinstall/build/runtime attempt after an error.
- `README.md`: updated Windows launch requirements and current safety behavior.

The agreed Modular Monolith architecture is unchanged. No module business logic was integrated and no original source was modified.

## Results actually run in this environment

The available environment is Linux (Ubuntu), not Windows.

| Command / check | Result |
|---|---|
| `npm ci --no-audit --no-fund` | Passed; 122 packages installed from the lockfile. |
| `node --check packages/project-manager/src/project-manager.mjs` | Passed. |
| `npm test` | **12 passed, 0 failed, 0 skipped.** This included the POSIX read-only permission test and symlink tests on Linux. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; Vite renderer plus Electron main/preload bundles built on Linux. |
| Electron `--version` | Passed; Electron 45.3.2 Linux runtime downloaded and reported. |
| Xvfb Electron lifecycle smoke | Passed twice: renderer loaded from the local `file://` bundle, window closed via DevTools, process exited, and a second fresh launch loaded successfully. |
| Project reopen persistence | Passed: a child Node process opened the Project created by the test process and read the same Project ID. |

The Electron lifecycle smoke is a Linux headless test, not a Windows GUI test. The BAT flow itself was inspected but not executed by `cmd.exe` in this environment.

## Still outstanding — do not declare Stage 1 complete yet

- Windows `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` have **not** been run on Windows.
- Windows ACL behavior, junction/reparse-point handling, launcher `cmd.exe` control flow, Electron window lifecycle on Windows, and Windows packaging remain unverified.
- The Project Manager restart test is automated at the filesystem/API level; the GUI open-close-reopen smoke above ran on Linux only.

Stage 1 must remain **pending Windows validation** until those Windows results are actually available.
