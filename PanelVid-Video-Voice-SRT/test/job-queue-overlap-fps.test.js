import test from 'node:test';
import assert from 'node:assert/strict';
import { jobDurations, markInterrupted, runJobQueue } from '../src/jobs.js';
import { normalizeUserPreferences } from '../src/user-prefs.js';
import { cueLoudnormFilter, parseLoudnormMeasurement } from '../src/audio-normalization.js';
import { clampWorkers } from '../electron/render.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const makeJob = id => ({ id, name: id, status: 'cho', voice: { kind: 'edge', voiceId: 'voice', cues: [{ text: id }] }, settings: {} });

test('queue creates next chapter voice while current chapter render is still active', async () => {
  const jobs = [makeJob('chapter-1'), makeJob('chapter-2')];
  const renderGate = deferred();
  const events = [];
  const run = runJobQueue(jobs, {
    generateVoice: async job => { events.push(`voice-start:${job.id}`); return { voicePath: `${job.id}.mp3` }; },
    renderJob: async job => {
      events.push(`render-start:${job.id}`);
      if (job.id === 'chapter-1') await renderGate.promise;
      events.push(`render-end:${job.id}`);
      return { outputPath: `${job.id}.mp4` };
    },
  });
  for (let i = 0; i < 25 && !events.includes('voice-start:chapter-2'); i++) await new Promise(r => setTimeout(r, 0));
  assert.ok(events.includes('render-start:chapter-1'));
  assert.ok(events.includes('voice-start:chapter-2'));
  assert.ok(!events.includes('render-end:chapter-1'));
  assert.equal(jobs[1].status, 'voice');
  renderGate.resolve();
  const stats = await run;
  assert.deepEqual(stats, { total: 2, done: 2, error: 0, stopped: false });
  assert.ok(events.indexOf('voice-start:chapter-2') < events.indexOf('render-start:chapter-2'));
});

test('queued total duration quantizes at the selected frame rate', () => {
  const scenes = [{ id: 'scene', pageIndex: 0 }];
  const at30 = jobDurations({ scenes, settings: { durationMode: 'total', totalSeconds: 1.01, fps: 30 }, pageCount: 1 });
  const at60 = jobDurations({ scenes, settings: { durationMode: 'total', totalSeconds: 1.01, fps: 60 }, pageCount: 1 });
  assert.equal(at30.map.get('scene'), 1);
  assert.equal(at60.map.get('scene'), 61 / 60);
});

test('FPS preference accepts 30, 45 and 60 and defaults invalid inputs to 60', () => {
  for (const fps of [30, 45, 60]) assert.equal(normalizeUserPreferences({ fps }).fps, fps);
  assert.equal(normalizeUserPreferences({ fps: 24 }).fps, 60);
});

test('job elapsed time includes both voice creation and rendering', async () => {
  const job = makeJob('timed-chapter');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await runJobQueue([job], {
    generateVoice: async () => { await wait(12); return { voicePath: 'voice.mp3' }; },
    renderJob: async () => { await wait(12); return { outputPath: 'video.mp4' }; },
  });
  assert.ok(job.startedAt > 0);
  assert.ok(job.completedAt >= job.startedAt);
  assert.equal(job.runStartedAt, null);
  assert.ok(job.elapsedMs >= 18, `expected voice + render elapsed, got ${job.elapsedMs}ms`);
});

test('interrupted job preserves elapsed time and clears its active timer', () => {
  const job = { status: 'render', elapsedMs: 250, runStartedAt: Date.now() - 100 };
  assert.equal(markInterrupted([job]), 1);
  assert.equal(job.status, 'loi');
  assert.equal(job.runStartedAt, null);
  assert.ok(job.elapsedMs >= 340);
});

test('render worker pool supports up to four pages and clamps invalid values', () => {
  assert.equal(clampWorkers(4), 4);
  assert.equal(clampWorkers(8), 4);
  assert.equal(clampWorkers(0), 1);
  assert.equal(clampWorkers('invalid'), 2);
});

test('per-cue loudness normalizer uses measured two-pass stats and has safe fallback', () => {
  const measurement = parseLoudnormMeasurement('noise\n{\n"input_i" : "-24.20",\n"input_tp" : "-4.10",\n"input_lra" : "3.20",\n"input_thresh" : "-34.00",\n"target_offset" : "0.10"\n}\n');
  assert.equal(measurement.inputI, -24.2);
  const filter = cueLoudnormFilter(measurement);
  assert.match(filter, /measured_I=-24\.20/);
  assert.match(filter, /TP=-2/);
  assert.match(filter, /linear=true/);
  assert.match(cueLoudnormFilter(null), /loudnorm=I=-18:TP=-2:LRA=11:print_format=none/);
});
