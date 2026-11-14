# Comic Production Studio — Stage 1 foundation

This is a new integration workspace. The supplied application sources are preserved verbatim in the source archive under `original-source/`; do not develop directly in those snapshots.

## Run on Windows

1. Extract the delivered ZIP completely to a writable folder. Do not run the BAT from inside the ZIP preview.
2. Install Node.js 22 LTS or newer if it is not already installed.
3. Double-click `CHAY-COMIC-PRODUCTION-STUDIO.bat`.

The launcher installs dependencies when needed (Internet is required for the first installation), builds the desktop shell, then opens it. Project data is processed locally. The AI Analysis module does not call AI APIs.

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

Project Manager owns only project lifecycle, `project.json`, and backup/restore. Module folders are reserved by contract: `panels/` (PanelCutter), `analysis/` (AI import; originals preserved), `adapter/`, `audio/`, `subtitles/`, `video/`, `logs/`, and `backups/`. Modules must not mutate another module's files. Initialization refuses non-empty folders and existing project markers. Backups use copy-to-staging and atomic rename; restore never overwrites a non-empty destination.

## Stage gates

No legacy application has been modified. Stage 2 starts only after Stage 1 tests/build pass. Stage 3 includes Windows runtime, TTS, FFmpeg, end-to-end, backup/restore and packaging validation.
