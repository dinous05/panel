import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustVoiceTimeline, normalizeVoiceTiming, voiceTimingAudioFilter } from '../src/voice-timing.js';

test('normalizes anchor and clamps correction to safe range', () => {
  assert.deepEqual(normalizeVoiceTiming('end', 35), { anchor: 'end', offsetSeconds: 30 });
  assert.deepEqual(normalizeVoiceTiming('unknown', -2.25), { anchor: 'start', offsetSeconds: -2.25 });
});

test('start anchor trims leading silence when late but leaves early voice unchanged for visual lead-in', () => {
  assert.equal(voiceTimingAudioFilter({ anchor: 'start', offsetSeconds: 0.5 }), 'atrim=start=0.500,asetpts=PTS-STARTPTS');
  assert.equal(voiceTimingAudioFilter({ anchor: 'start', offsetSeconds: -0.25 }), null);
  assert.equal(voiceTimingAudioFilter({ anchor: 'start', offsetSeconds: 0 }), null);
  assert.deepEqual(adjustVoiceTimeline({ cueStarts: [0, 2], durationSeconds: 5, anchor: 'start', offsetSeconds: -10 }), {
    cueStarts: [0, 2], durationSeconds: 5,
  });
});

test('end anchor speeds up late audio and slows early audio', () => {
  assert.equal(voiceTimingAudioFilter({ anchor: 'end', offsetSeconds: 1, audioDurationSeconds: 101 }), 'atempo=1.01000000');
  assert.equal(voiceTimingAudioFilter({ anchor: 'end', offsetSeconds: -2, audioDurationSeconds: 98 }), 'atempo=0.98000000');
});

test('subtitle cue times follow the adjusted voice timeline', () => {
  assert.deepEqual(adjustVoiceTimeline({ cueStarts: [0, 2, 5], durationSeconds: 6, anchor: 'start', offsetSeconds: 0.5 }), {
    cueStarts: [0, 1.5, 4.5], durationSeconds: 5.5,
  });
  const endAligned = adjustVoiceTimeline({ cueStarts: [0, 50, 100], durationSeconds: 101, anchor: 'end', offsetSeconds: 1 });
  assert.equal(endAligned.durationSeconds, 100);
  assert.equal(endAligned.cueStarts[1], 50 * 100 / 101);
});
