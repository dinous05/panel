import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { exportPackageToDirectory } from '../src/main/export-package';
import { createLogicalPages } from '../src/shared/logical-pages';
import type { MappingResult, PanelReferenceMapping } from '../src/shared/types';

const panelVidRoot = process.env.PANELVID_V8_SOURCE;
const roots: string[] = [];
const makeTemp = async () => { const dir = await mkdtemp(path.join(os.tmpdir(), 'panelvid-v8-integration-')); roots.push(dir); return dir; };
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

const integrationSuite = panelVidRoot ? describe : describe.skip;
integrationSuite('PanelVid v8 source integration (set PANELVID_V8_SOURCE)', () => {
  it('imports exported Pages/SRT with PanelVid v8, detects page cues and chains voice from actual audio durations', async () => {
    const voiceModule = await import(pathToFileURL(path.join(panelVidRoot!, 'src/voice.js')).href) as {
      parseSRT: (text: string) => Array<{ start: number; end: number; text: string; page: number | null }>;
      buildVoiceTimeline: (starts: number[], durations: number[]) => { starts: number[]; duration: number };
      markerSegmentsFromCues: (cues: Array<{ start: number; end: number; page: number | null }>) => Record<number, [number, number]>;
      analyzeMarkers: (segments: Record<number, [number, number]>, pageCount: number) => { mode: string; covered: number };
    };
    const folderModule = await import(pathToFileURL(path.join(panelVidRoot!, 'src/panel-folders.js')).href) as {
      groupPanelItemsByPage: (items: Array<{ name: string; path: string }>, options?: { baseFolder?: string }) => { groups: Array<{ name: string; items: Array<{ name: string; path: string }> }>; pageCount: number };
    };
    const root = await makeTemp();
    const imageRoot = path.join(root, 'images'); await mkdir(imageRoot);
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
    const files = ['page-a/a.jpg', 'page-a/b.jpg', 'page-b/c.jpg'];
    const refs: PanelReferenceMapping[] = [];
    for (const [index, file] of files.entries()) {
      const full = path.join(imageRoot, file); await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, Buffer.from([0xff, 0xd8, 0xff, index, 0xd9]));
      refs.push({ referenceUuid: ids[index], panelId: ids[index], manifestFile: file, resolvedPath: full, imageStatus: 'found', status: 'mapped', sourceRegionsCount: 0, sourceFileIsNull: false });
    }
    const beat = (id: string, narration: string, panels: PanelReferenceMapping[]) => ({ beatId: id, order: 1, narration, metadata: {}, panels });
    const chapter = { chapterKey: 'chapter', fileName: 'analysis.json', series: 'Series', chapterNumber: 1, chapterTitle: null, beats: [beat('b1', 'A long narration that takes a real eight seconds to speak, but its length is not guessed in the SRT.', refs.slice(0, 2)), beat('b2', 'Second beat follows after actual audio.', refs.slice(2))] };
    const mapping: MappingResult = {
      projectName: 'v8-test', projectId: 'id-1', imageRoot, chapters: [chapter],
      manifestPanels: refs.map((ref, index) => ({ entryKey: ids[index], panelId: ids[index], uuid: ids[index], uuidStatus: 'valid', manifestFile: ref.manifestFile, resolvedPath: ref.resolvedPath, imageStatus: 'found', sourceRegionsCount: 0, sourceFileIsNull: false, used: true })),
      statistics: { totalPanels: 3, distinctUuidsUsed: 3, imagesFound: 3, imagesMissing: 0, imagesInvalid: 0, imagePathErrors: 0, invalidUuidReferences: 0, unknownUuidReferences: 0, invalidManifestUuids: 0, duplicateManifestUuidGroups: 0, unusedPanels: 0 }
    };
    const parent = path.join(root, 'out'); await mkdir(parent);
    const result = await exportPackageToDirectory(mapping, createLogicalPages(mapping), parent);
    const srt = await readFile(path.join(result.outputPath, 'Chapter_001', 'Chapter 001.srt'), 'utf8');
    const cues = voiceModule.parseSRT(srt);
    expect(cues.map(cue => cue.start)).toEqual([0, 0]);
    expect(cues.map(cue => cue.end)).toEqual([0.001, 0.001]);
    expect(cues.map(cue => cue.page)).toEqual([1, 2]);
    expect(cues.map(cue => cue.text)).toEqual([
      'A long narration that takes a real eight seconds to speak, but its length is not guessed in the SRT.',
      'Second beat follows after actual audio.'
    ]);
    const parsedMarkerSegments = voiceModule.markerSegmentsFromCues(cues);
    expect(Object.keys(parsedMarkerSegments).sort()).toEqual(['0', '1']);
    expect(voiceModule.analyzeMarkers(parsedMarkerSegments, 2)).toMatchObject({ mode: 'full', covered: 2 });
    const voiceTimeline = voiceModule.buildVoiceTimeline(cues.map(cue => cue.start), [2.75, 8.25]);
    expect(voiceTimeline).toEqual({ starts: [0, 2.75], duration: 11 });
    const segments = { 0: [voiceTimeline.starts[0], voiceTimeline.starts[1]] as [number, number], 1: [voiceTimeline.starts[1], voiceTimeline.duration] as [number, number] };
    expect(voiceModule.analyzeMarkers(segments, 2)).toMatchObject({ mode: 'full', covered: 2 });

    const chapterDir = path.join(result.outputPath, 'Chapter_001');
    const pageDirs = (await readdir(chapterDir, { withFileTypes: true })).filter(entry => entry.isDirectory());
    const items: Array<{ name: string; path: string }> = [];
    for (const pageDir of pageDirs) for (const name of await readdir(path.join(chapterDir, pageDir.name))) items.push({ name, path: `Chapter_001/${pageDir.name}/${name}` });
    const grouped = folderModule.groupPanelItemsByPage(items, { baseFolder: 'Chapter_001' });
    expect(grouped.pageCount).toBe(2);
    expect(grouped.groups.map(group => group.items.length)).toEqual([2, 1]);
    expect(grouped.groups.map(group => group.name)).toEqual(['Page 001', 'Page 002']);
    const electronSource = await readFile(path.join(panelVidRoot!, 'electron/main.js'), 'utf8');
    expect(electronSource).toContain('Math.max(srtStarts[i], cursor)');
    expect(electronSource).toContain('cueDurations.push(dur)');
    expect(electronSource).toContain('pageSegments[pg - 1] = [seg.start, seg.end]');
  });
});
