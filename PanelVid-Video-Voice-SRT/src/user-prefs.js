export const USER_PREFERENCES_KEY = 'panelvid.userPreferences.v1';
const DEFAULTS = Object.freeze({
  durationMode: 'scene', seconds: 4, totalSeconds: 60, pageSeconds: 12,
  quality: 'balanced', fps: 60, reading: 'rtl', voiceKind: 'edge',
  edgeVoiceId: 'ja-JP-NanamiNeural', customVoiceId: '', cloneLanguage: 'ja', cloneExaggeration: 0.4,
});
const EDGE_VOICE_IDS = new Set([
  'ja-JP-NanamiNeural', 'ja-JP-KeitaNeural', 'en-US-JennyNeural',
  'en-US-GuyNeural', 'en-US-AriaNeural', 'vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural',
]);
const clamp = (value, low, high, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(low, Math.min(high, n)) : fallback;
};

export function normalizeUserPreferences(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const durationMode = ['scene', 'total', 'page'].includes(source.durationMode) ? source.durationMode : 'scene';
  const selectedEdge = String(source.edgeVoiceId || '');
  return {
    durationMode,
    seconds: clamp(source.seconds, 0.5, 120, DEFAULTS.seconds),
    totalSeconds: clamp(source.totalSeconds, 0.5, 3600, DEFAULTS.totalSeconds),
    pageSeconds: clamp(source.pageSeconds, 0.5, 600, DEFAULTS.pageSeconds),
    quality: source.quality === 'high' ? 'high' : 'balanced',
    fps: [30, 45, 60].includes(Number(source.fps)) ? Number(source.fps) : DEFAULTS.fps,
    reading: source.reading === 'ltr' ? 'ltr' : 'rtl',
    voiceKind: source.voiceKind === 'clone' ? 'clone' : 'edge',
    edgeVoiceId: EDGE_VOICE_IDS.has(selectedEdge) ? selectedEdge : '__custom__',
    customVoiceId: String(source.customVoiceId || '').slice(0, 200),
    cloneLanguage: ['ja', 'en', 'es', 'pt', 'vi'].includes(source.cloneLanguage) ? source.cloneLanguage : 'ja',
    cloneExaggeration: clamp(source.cloneExaggeration, 0, 1, DEFAULTS.cloneExaggeration),
  };
}

export function loadUserPreferences(storage = globalThis.localStorage) {
  try {
    if (!storage) return { ...DEFAULTS };
    return normalizeUserPreferences(JSON.parse(storage.getItem(USER_PREFERENCES_KEY) || '{}'));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveUserPreferences(value, storage = globalThis.localStorage) {
  const normalized = normalizeUserPreferences(value);
  try { storage?.setItem(USER_PREFERENCES_KEY, JSON.stringify(normalized)); } catch {}
  return normalized;
}
