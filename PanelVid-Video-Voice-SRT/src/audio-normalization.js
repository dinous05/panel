export const VOICE_TARGET_LUFS = -18;
export const VOICE_TRUE_PEAK_DBTP = -2;
export const VOICE_LOUDNESS_RANGE = 11;

function lastJsonObject(text) {
  const matches = String(text || '').match(/\{\s*"input_i"\s*:[\s\S]*?\}/g);
  if (!matches?.length) return null;
  try { return JSON.parse(matches.at(-1)); } catch { return null; }
}

export function parseLoudnormMeasurement(stderr) {
  const raw = lastJsonObject(stderr);
  if (!raw) return null;
  const fields = {
    inputI: raw.input_i,
    inputTp: raw.input_tp,
    inputLra: raw.input_lra,
    inputThresh: raw.input_thresh,
    targetOffset: raw.target_offset ?? 0,
  };
  const result = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Number(value)]));
  return Object.values(result).every(Number.isFinite) ? result : null;
}

export function cueLoudnormFilter(measurement = null) {
  const prefix = `loudnorm=I=${VOICE_TARGET_LUFS}:TP=${VOICE_TRUE_PEAK_DBTP}:LRA=${VOICE_LOUDNESS_RANGE}`;
  if (!measurement || !Object.values(measurement).every(value => Number.isFinite(Number(value)))) {
    return `${prefix}:print_format=none`;
  }
  const fixed = value => Number(value).toFixed(2);
  return `${prefix}:measured_I=${fixed(measurement.inputI)}:measured_TP=${fixed(measurement.inputTp)}:measured_LRA=${fixed(measurement.inputLra)}:measured_thresh=${fixed(measurement.inputThresh)}:offset=${fixed(measurement.targetOffset)}:linear=true:print_format=none`;
}
