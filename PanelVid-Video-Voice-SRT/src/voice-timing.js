export function normalizeVoiceTiming(anchor, offsetSeconds) {
  const parsed = Number(offsetSeconds);
  const offset = Number.isFinite(parsed) ? Math.max(-30, Math.min(30, parsed)) : 0;
  return { anchor: anchor === 'end' ? 'end' : 'start', offsetSeconds: offset };
}

function atempoChain(rate) {
  const filters = [];
  let remaining = rate;
  while (remaining > 2) { filters.push('atempo=2'); remaining /= 2; }
  while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5; }
  filters.push(`atempo=${remaining.toFixed(8)}`);
  return filters;
}

// Positive offset means the voice is late relative to the picture; negative means early.
// For start-anchor corrections, positive trims leading audio silence; negative is
// handled by holding the first visual frame while leaving voice untouched. At the
// end anchor the start remains fixed and the complete voice track is time-stretched.
export function voiceTimingAudioFilter({ anchor = 'start', offsetSeconds = 0, audioDurationSeconds = 0, videoDurationSeconds = 0 } = {}) {
  const options = normalizeVoiceTiming(anchor, offsetSeconds);
  const offset = options.offsetSeconds;
  if (!offset) return null;
  if (options.anchor === 'start') {
    if (offset > 0) return `atrim=start=${offset.toFixed(3)},asetpts=PTS-STARTPTS`;
    return null;
  }
  const measuredDuration = Number(audioDurationSeconds);
  const originalDuration = Number.isFinite(measuredDuration) && measuredDuration > 0
    ? measuredDuration : Math.max(0, Number(videoDurationSeconds) + offset);
  const targetDuration = originalDuration - offset;
  if (targetDuration <= 0) return null;
  const rate = originalDuration / targetDuration;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return atempoChain(rate).join(',');
}

export function adjustVoiceTimeline({ cueStarts = [], durationSeconds = 0, anchor = 'start', offsetSeconds = 0 } = {}) {
  const options=normalizeVoiceTiming(anchor,offsetSeconds);
  const duration=Math.max(0,Number(durationSeconds)||0);
  if(options.anchor==='start'&&options.offsetSeconds<0){
    return {cueStarts:[...cueStarts],durationSeconds:duration};
  }
  const correctedDuration=Math.max(0,duration-options.offsetSeconds);
  let starts;
  if(options.anchor==='start'){
    starts=cueStarts.map(value=>Math.max(0,(Number(value)||0)-options.offsetSeconds));
  }else{
    const ratio=duration>0?correctedDuration/duration:1;
    starts=cueStarts.map(value=>Math.max(0,(Number(value)||0)*ratio));
  }
  return {cueStarts:starts,durationSeconds:correctedDuration};
}
