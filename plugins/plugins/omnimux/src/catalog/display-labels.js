/**
 * Human-facing family labels for catalog rows.
 *
 * A family is a grouping key (openai / seedream / muse ...), not a model label.
 * Keep this map family-level: model names come from local specs, the gateway
 * display_name, or the deterministic id humanizer in gateway-contract.js.
 */
const FAMILY_LABELS = Object.freeze({
  openai: 'OpenAI',
  bytedance: 'Seedance',
  seedance: 'Seedance',
  seedream: 'Seedream',
  minimax: 'MiniMax',
  kling: 'Kling',
  google: 'Google',
  midjourney: 'Midjourney',
  bfl: 'Black Forest Labs',
  anthropic: 'Claude',
  deepseek: 'DeepSeek',
  grok: 'xAI',
  muse: 'Muse',
  alibaba: 'Wan',
  wan: 'Wan',
  suno: 'Suno',
  indextts: 'Index TTS2',
  happyhorse: 'HappyHorse',
  zhipu: 'Zhipu',
  kimi: 'Kimi',
});

/**
 * Resolve a stable display label for a model family.
 * Unknown families remain visible rather than being collapsed into a generic
 * group, so a newly published family fails open for display but never invents
 * a brand name.
 *
 * @param {unknown} family
 * @returns {string | undefined}
 */
export function familyLabelFor(family) {
  if (typeof family !== 'string') return undefined;
  const trimmed = family.trim();
  if (!trimmed) return undefined;
  return FAMILY_LABELS[trimmed.toLowerCase()] || trimmed;
}

export { FAMILY_LABELS };
