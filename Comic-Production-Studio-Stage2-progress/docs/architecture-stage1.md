# Stage 1 architecture decisions

## Runtime and module boundaries

One Electron application owns one main process and one shell renderer. Modules are separate packages with their own UI/logic entry points and tests. The main/preload bridge exposes named Project Manager operations only; renderer code does not receive Node filesystem access. Future module commands must use versioned request/result contracts (`requestId`, module owner, command, payload) and report errors with the responsible module. Do not expose raw `ipcRenderer` or arbitrary filesystem paths as a general-purpose capability.

## Project ownership

- Project Manager: `project.json`, project lifecycle, backups and restore.
- PanelCutter: `panels/` including manifest and panel images. Preserve the existing manifest schema and identity registry semantics.
- AI import: `analysis/`; imported source JSON is immutable by default.
- Adapter: `adapter/`; reads PanelCutter manifest and analysis JSON, writes only its own derived data/exports.
- Video Studio: `audio/`, `subtitles/`, `video/`; may read panel/adapter inputs but must not modify them.
- System: `logs/`, `backups/`.

The Project Manager creates folders and metadata but does not create or rewrite module-owned content. Existing project folders are not adopted automatically. Create only succeeds at a new directory path. Backup excludes nested `backups/` to avoid recursion; restore requires a new destination. No operation overwrites an existing destination.

## Compatibility

Keep legacy project data parsers and serializers in their module adapters. `project.json` is an additive index and does not replace Manifest or AI JSON. Any schema migration must be explicit, backed up, and tested against fixtures before execution.

## Current limitation

Module contracts and shell placeholders establish the boundary, but production logic/UI has not yet been integrated. The supplied legacy source remains read-only reference material under `original-source/`.
