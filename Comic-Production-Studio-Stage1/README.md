# Comic Production Studio — Stage 1 foundation

This is a new integration workspace. The supplied application sources are preserved verbatim in the source archive under `original-source/`; do not develop directly in those snapshots.

## Run on Windows

1. Extract the delivered ZIP completely to a writable folder. Do not run the BAT from inside the ZIP preview.
2. Install Node.js 22.12.0 LTS or newer if it is not already installed.
3. Double-click `CHAY-COMIC-PRODUCTION-STUDIO.bat`.

The launcher checks Node.js and the dependency tree, installs/reinstalls packages when needed (Internet is required for installation), builds the desktop shell, verifies/downloads the Electron runtime, then opens it. It retries one clean dependency install/build/runtime check after a failure. Project data is processed locally. The AI Analysis module does not call AI APIs.

## Developer commands

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run dev
npm start
```

## Stage 1 status

The foundation provides a modular Electron/React shell, navigation, typed internal module contracts, module-owned folders, and safe project initialization. Existing production features are not yet connected; module screens are integration placeholders.

## Data ownership

Project Manager owns only project lifecycle, `project.json`, and backup/restore. Module folders are reserved by contract: `panels/` (PanelCutter), `analysis/` (AI import; originals preserved), `adapter/`, `audio/`, `subtitles/`, `video/`, `logs/`, and `backups/`. Modules must not mutate another module's files. Initialization refuses existing destinations and unsafe names. Project paths reject symlink/reparse-point components; backup/restore reject links and special files in the copied tree. Backup uses staging and rename; restore validates staging and never overwrites an existing destination. Project Manager can report write access for each module folder.

## Stage gates

No legacy application has been modified. Linux automated checks and a Linux Electron smoke test pass; Windows-specific validation is still pending, so Stage 1 is not yet declared complete. Stage 2 starts only after the required Windows checks pass. Stage 3 includes full production workflow, TTS, FFmpeg, end-to-end, backup/restore and packaging validation.
