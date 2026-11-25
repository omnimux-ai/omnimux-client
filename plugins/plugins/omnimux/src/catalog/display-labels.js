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
 * group, so a newly published family fails open for display (preferring an
 * explicit gateway `brandName` when present) and never invents a brand name.
 *
 * @param {unknown} family
 * @param {unknown} [brandName]
 * @returns {string | undefined}
 */
export function familyLabelFor(family, brandName) {
  if (typeof family !== 'string') return undefined;
  const trimmed = family.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  const known = Object.hasOwn(FAMILY_LABELS, lower) ? FAMILY_LABELS[lower] : undefined;
  if (known) return known;
  if (typeof brandName === 'string' && brandName.trim()) return brandName.trim();
  return trimmed;
}

export { FAMILY_LABELS };
