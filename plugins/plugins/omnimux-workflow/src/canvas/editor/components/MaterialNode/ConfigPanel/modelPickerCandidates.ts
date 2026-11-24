import { canonicalizeLocalBrandId, getCanonicalBrandName, isValidBrandId } from 'dsh-ui-kit/model-brands';
import type { CatalogChannelGroupDto, OperationContractDto } from '../../../../../shared/api.ts';

export interface PickerCandidate {
  id: string;
  effectiveVideoVersion?: string;
  label: string;
  subtitle?: string;
  family?: string;
  familyLabel?: string;
  brandId?: string;
  brandName?: string;
  brandIconPath?: string;
  source?: 'gateway' | 'custom';
  executionStatus?: 'ready' | 'unsupported' | 'unverified';
  executable?: boolean;
  disabledReason?: 'adapter_unsupported' | 'provider_unverified';
  /** Epic #63 R10: cannot consume the connected media; grey only, no copy. */
  inputIncompatible?: boolean;
  /**
   * Gateway lines of this model, straight from the hub catalog row. The channel
   * column renders these and nothing else.
   */
  channelGroups?: CatalogChannelGroupDto[];
  /** Model contract operations; their inputs feed media-capability chips when a line has no variants. */
  operations?: OperationContractDto[];
}

export interface PickerCandidateGroup {
  id: string;
  name: string;
  iconModelId: string;
  brandId?: string;
  brandName?: string;
  brandIconPath?: string;
  rows: PickerCandidate[];
}

// Presentation aliases only: these never contribute model candidates.
// The 4th tuple entry declares the canonical gateway brand_id owner so product
// sub-families (e.g. seedream/seedance under bytedance, wan/happyhorse under
// alibaba) stay intact without allowing a mismatched family to hijack an
// explicit foreign gateway brandId.
const BRANDS: readonly [string, string, readonly string[], string][] = [
  ['openai', 'OpenAI', ['openai', 'gpt', 'o1', 'o3', 'o4'], 'openai'],
  ['seedream', 'Seedream', ['seedream'], 'bytedance'],
  ['bytedance', 'Seedance', ['bytedance', 'seed'], 'bytedance'],
  ['minimax', 'MiniMax', ['minimax', 'hailuo'], 'minimax'],
  ['muse', 'Muse', ['muse'], 'muse'],
  ['kling', 'Kling', ['kling'], 'kling'],
  ['alibaba', 'Wan', ['alibaba', 'wan'], 'alibaba'],
  ['happyhorse', 'HappyHorse', ['happyhorse', 'horse'], 'alibaba'],
  ['anthropic', 'Claude', ['anthropic', 'claude', 'opus', 'sonnet'], 'anthropic'],
  ['deepseek', 'DeepSeek', ['deepseek'], 'deepseek'],
  ['google', 'Google', ['google', 'gemini', 'nano-banana', 'nanobanana', 'imagen', 'veo'], 'google'],
  ['midjourney', 'Midjourney', ['midjourney', 'mj'], 'midjourney'],
  ['xai', 'xAI', ['xai', 'grok'], 'grok'],
  ['indextts', 'Index TTS2', ['gxgenai', 'index-tts', 'indextts', 'indextts-2', 'index'], 'indextts'],
];

function matchKnownGroup(token: string): readonly [string, string, readonly string[], string] | undefined {
  const key = token.trim().toLowerCase();
  if (!key) return undefined;
  return BRANDS.find(([, , aliases]) => aliases.some((alias) => key === alias || key.startsWith(`${alias}-`)));
}

export function isPickerCandidate(options: readonly PickerCandidate[], modelId: string): boolean {
  return Boolean(modelId) && options.some((row) => row.id === modelId);
}

export function groupPickerCandidates(options: readonly PickerCandidate[]): PickerCandidateGroup[] {
  const groups = new Map<string, PickerCandidateGroup>();
  for (const row of options) {
    if (!row.id) continue;
    const explicitBrandId = isValidBrandId(row.brandId) ? row.brandId : '';
    const explicitCanonicalBrand = explicitBrandId
      ? (canonicalizeLocalBrandId(explicitBrandId) ?? explicitBrandId)
      : '';
    const familyIdentity = row.familyLabel?.trim() || row.family?.trim() || '';
    const knownFromFamily = familyIdentity ? matchKnownGroup(familyIdentity) : undefined;
    const familyMatchesExplicitBrand = Boolean(
      knownFromFamily && (
        !explicitCanonicalBrand
        || knownFromFamily[3] === explicitCanonicalBrand
        || knownFromFamily[0] === explicitBrandId
      ),
    );

    let id: string;
    let name: string;
    if (knownFromFamily && familyMatchesExplicitBrand) {
      id = knownFromFamily[0];
      name = knownFromFamily[1];
    } else if (explicitBrandId) {
      const knownFromBrand = matchKnownGroup(explicitBrandId);
      if (knownFromBrand && (knownFromBrand[3] === explicitCanonicalBrand || knownFromBrand[0] === explicitBrandId)) {
        id = knownFromBrand[0];
        name = knownFromBrand[1];
      } else {
        id = explicitBrandId;
        name = row.brandName?.trim()
          || getCanonicalBrandName(explicitBrandId)
          || explicitBrandId;
      }
    } else {
      const identity = familyIdentity || row.id;
      const known = matchKnownGroup(identity);
      id = known?.[0] ?? identity;
      name = known?.[1] ?? identity;
    }

    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        name,
        iconModelId: row.id,
        ...(explicitBrandId ? { brandId: explicitBrandId } : {}),
        ...(row.brandName?.trim() ? { brandName: row.brandName.trim() } : {}),
        ...(row.brandIconPath ? { brandIconPath: row.brandIconPath } : {}),
        rows: [],
      };
      groups.set(id, group);
    } else {
      if (!group.brandId && explicitBrandId) group.brandId = explicitBrandId;
      if (!group.brandName && row.brandName?.trim()) group.brandName = row.brandName.trim();
      if (!group.brandIconPath && row.brandIconPath) group.brandIconPath = row.brandIconPath;
    }
    group.rows.push(row);
  }
  return [...groups.values()];
}

/** 菜单行的可本地化文案（#4113 M2）：纯函数，行为可直接单测，不靠源码字符串断言。 */
export type ModelMenuCopyKey =
  | 'modelMenu.unsupportedTitle'
  | 'modelMenu.unverifiedTitle'
  | 'modelMenu.unsupportedBadge'
  | 'modelMenu.unverifiedBadge';

export function resolveModelMenuItemCopy(
  // ModelExecutionStatus 恰好三值，且 executable===false ⟺ status∈{unsupported,unverified}；
  // 因此 ready 无 badge 与原逻辑等价。若未来新增第 4 种非 ready 状态，需要同步这里的分支。
  item: { executionStatus?: 'ready' | 'unsupported' | 'unverified' },
  t: (key: ModelMenuCopyKey) => string,
): { title?: string; badge?: string } {
  if (item.executionStatus === 'unsupported') {
    return { title: t('modelMenu.unsupportedTitle'), badge: t('modelMenu.unsupportedBadge') };
  }
  if (item.executionStatus === 'unverified') {
    return { title: t('modelMenu.unverifiedTitle'), badge: t('modelMenu.unverifiedBadge') };
  }
  return {};
}
