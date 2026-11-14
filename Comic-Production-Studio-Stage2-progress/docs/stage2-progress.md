# Stage 2 integration progress

## Confirmed scope and user notes

- The user says a sample existing Project may be omitted.
- The user confirms Comic Production Studio has run normally on Windows. No Windows command output was supplied, so detailed Windows test/build/package results remain unverified here.
- The supplied source package includes the Stage 1 app and the original PanelCutter 1.1.1, PanelVid Adapter Phase 4, and PanelVid Voice/Video/SRT v8 archives. The original ZIP archives were not edited.

## Baseline audit and test results

| Component | Result in Linux sandbox |
|---|---|
| Stage 1 shell | `npm ci`, `npm test` (12/12), `npm run typecheck`, and `npm run build` passed before integration changes. |
| PanelCutter original | `npm ci` and `npm test`: 45/45 passed. |
| PanelVid Adapter original | `npm ci`, tests: 29 passed and one optional PanelVid-v8 integration test skipped; typecheck and build passed. |
| PanelVid Voice/Video/SRT original | `npm ci` and tests: 46/46 passed. |
| Stage 1 shell after AI Import | `npm test`: 14/14 (12 Project Manager + 2 import tests); typecheck and build passed. |

These are Linux checks. No actual TTS synthesis, FFmpeg render, or Windows packaging was run.

## Implemented: AI Analysis Import

- Added `packages/modules/ai-import/src/importer.mjs` with a narrow main-process import operation.
- The shell opens the existing Project before import, offers a JSON-only multi-file picker, checks JSON syntax/object root, and copies original bytes to the module-owned `analysis/incoming` folder.
- Existing file names are never overwritten; collisions receive a numbered suffix. Imported files are immutable copies; AI API is not called.
- Added an in-shell AI Import workspace displaying Project location and imported file/Chapter/voice-beat details.
- Exposed only named import/file-selection operations via Electron preload; renderer receives no filesystem access.
- Added regression tests for byte preservation (including BOM/CRLF), duplicate-name preservation, malformed JSON, and non-object input.

## Integration audit notes (not yet implemented)

### PanelCutter

The existing app is Electron + Vite + vanilla DOM UI, with strong pure crop/detector/layout/manifest modules and an identity registry in Electron `userData`. Its renderer expects a dedicated `window.panelCutter` bridge; the production UI is highly coupled to imperative state in a large `src/main.js`. Manifest schema and UUID allocation/registry semantics are covered by legacy tests. Integrate via a shell-owned module and narrow IPC while preserving worker/model/WASM relative assets and identity-registry lifecycle; do not launch a second standalone app or port the UI in one pass.

### PanelVid Adapter

The existing app uses Electron + React + TypeScript and has tested pure UUID mapping, Logical Page editing, validation, preview and staged export. It currently selects arbitrary input image folders and arbitrary export parents. A shell integration must bind inputs to the open Project (panels + analysis) and ensure output is in `adapter/`; simply mounting the original component would not enforce module ownership. Its optional v8 integration test was skipped because its environment variable was not set during baseline testing.

### PanelVid Video/Voice/SRT

The app uses Electron + Vite + vanilla JS and is Windows-first. FFmpeg is bundled for Windows and the render functions depend on native filesystem/temp-file behavior. TTS has different network/offline properties: Edge TTS calls Microsoft services; Chatterbox and VieNeu are local engines but require separately installed Python packages/model setup, with VieNeu downloading/caching a large model initially. A full offline claim would be inaccurate. Integrate renderer/main functionality behind the shell's narrow IPC, store project-owned audio/subtitles/video under their reserved folders, and verify FFmpeg assets/encoders and TTS provider setup on Windows before marking available.

## Remaining Stage 2 work

1. PanelCutter: connect UI and main-process operations to the shell; write images and manifest in the Project-owned panels area; preserve UUID/registry behavior; test export and reopening.
2. Adapter: connect import/mapping/logical-page editing/export; consume Manifest and incoming analysis; export only under `adapter/`; test fixture and duplicate/missing UUID/path cases.
3. Video Studio: connect TTS/SRT/FFmpeg with local project-owned paths; clearly surface online vs local engines and dependencies.
4. Run an end-to-end Project workflow with real PanelCutter output, AI JSON fixture, Adapter package, and Video Studio output; verify no cross-module overwrites and backup/restore.
5. Ask the user to run Windows validation for the resulting build; only then report Windows workflow/package status.

Do not claim Stage 2 complete. Only AI Analysis Import is currently connected; the other three production modules remain pending.
