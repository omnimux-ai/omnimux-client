import type {
  CapabilityCatalog,
  CatalogBrandMeta,
  CatalogChannelGroupDto,
  CatalogModelDto,
  CapabilityModelItem,
} from '../../shared/api.ts';
import { isValidBrandId, sanitizeBrandIconPath } from 'dsh-ui-kit/model-brands';
import { projectCanvasCatalog } from '../../shared/generationPolicy.ts';

type Getter = (name: string) => unknown;
interface CatalogSeam { list(): Partial<CapabilityCatalog> }

/**
 * Preserve hub order and routing metadata in every canvas catalog view.
 * An invalid row cannot become a target and a disabled row cannot be a default.
 */
function channelGroups(value: unknown): CatalogChannelGroupDto[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.flatMap((row): CatalogChannelGroupDto[] => {
    if (!row || typeof row !== 'object') return [];
    const group = row as Record<string, unknown>;
    const id = typeof group.id === 'string' ? group.id.trim() : '';
    if (!id) return [];
    const enabled = group.enabled !== false;
    return [{
      id,
      label: typeof group.label === 'string' && group.label.trim() ? group.label : id,
      ...(typeof group.badge === 'string' ? { badge: group.badge } : {}),
      ...(typeof group.wireGroup === 'string' ? { wireGroup: group.wireGroup } : {}),
      ...(typeof group.wireModel === 'string' ? { wireModel: group.wireModel } : {}),
      ...(group.pricing && typeof group.pricing === 'object'
        ? { pricing: group.pricing as CatalogChannelGroupDto['pricing'] }
        : {}),
      ...(group.constraints && typeof group.constraints === 'object'
        ? { constraints: group.constraints as CatalogChannelGroupDto['constraints'] }
        : {}),
      ...(Array.isArray(group.effectiveOperations) ? { effectiveOperations: group.effectiveOperations } : {}),
      ...(typeof group.effectiveVersion === 'string' ? { effectiveVersion: group.effectiveVersion } : {}),
      ...(typeof group.defaultOperationId === 'string' ? { defaultOperationId: group.defaultOperationId } : {}),
      ...(group.sla && typeof group.sla === 'object'
        ? { sla: group.sla as CatalogChannelGroupDto['sla'] }
        : {}),
      enabled,
      ...(enabled && group.default === true ? { default: true } : {}),
    }];
  });
  return rows;
}

function normalizeBrands(value: unknown): Record<string, CatalogBrandMeta> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, CatalogBrandMeta> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const id = entry.id !== undefined ? entry.id : key;
    if (!isValidBrandId(key) || !isValidBrandId(id) || id !== key) continue;
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : '';
    if (!name) continue;
    const iconPath = sanitizeBrandIconPath(entry.iconPath ?? entry.icon_path);
    out[id] = { id, name, ...(iconPath ? { iconPath } : {}) };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function rows(value: unknown): CapabilityModelItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === 'object').map((row) => {
    const lines = channelGroups(row.channelGroups);
    const brandId = isValidBrandId(row.brandId) ? row.brandId : undefined;
    const brandName = typeof row.brandName === 'string' && row.brandName.trim() ? row.brandName.trim() : undefined;
    const brandIconPath = sanitizeBrandIconPath(row.brandIconPath) ?? undefined;
    return {
      id: String(row.id ?? ''),
      ...(typeof row.effectiveVideoVersion === 'string' ? { effectiveVideoVersion: row.effectiveVideoVersion } : {}),
      label: typeof row.label === 'string' && row.label.trim() ? row.label : String(row.id ?? ''),
      ...(row.source === 'gateway' || row.source === 'custom' ? { source: row.source } : {}),
      ...(row.executionStatus === 'ready' || row.executionStatus === 'unsupported' || row.executionStatus === 'unverified'
        ? { executionStatus: row.executionStatus } : {}),
      ...(typeof row.visible === 'boolean' ? { visible: row.visible } : {}),
      ...(typeof row.selectable === 'boolean' ? { selectable: row.selectable } : {}),
      ...(row.availabilityReason === 'gateway_delisted' || row.availabilityReason === 'contract_missing'
        || row.availabilityReason === 'adapter_missing' || row.availabilityReason === 'profile_incomplete'
        ? { availabilityReason: row.availabilityReason } : {}),
      ...(typeof row.providerId === 'string' && row.providerId.trim() ? { providerId: row.providerId.trim() } : {}),
      ...(typeof row.sourceLabel === 'string' && row.sourceLabel.trim() ? { sourceLabel: row.sourceLabel.trim() } : {}),
      ...(typeof row.badge === 'string' ? { badge: row.badge } : {}),
      ...(typeof row.subtitle === 'string' ? { subtitle: row.subtitle } : {}),
      ...(typeof row.family === 'string' ? { family: row.family } : {}),
      ...(typeof row.familyLabel === 'string' && row.familyLabel.trim() ? { familyLabel: row.familyLabel.trim() } : {}),
      ...(brandId ? { brandId } : {}),
      ...(brandName ? { brandName } : {}),
      ...(brandIconPath ? { brandIconPath } : {}),
      ...(Array.isArray(row.aliases) ? { aliases: row.aliases.map(String) } : {}),
      ...(row.inputCapability && typeof row.inputCapability === 'object' ? { inputCapability: row.inputCapability } : {}),
      ...(row.parameters && typeof row.parameters === 'object' ? { parameters: row.parameters } : {}),
      ...(lines && lines.length > 0 ? { channelGroups: lines } : {}),
    };
  }).filter((row) => row.id.length > 0);
}

/** Catalog DTO passthrough; curation never fabricates an executable operation. */
export function readCanvasCatalog(getSeam: Getter): CapabilityCatalog {
  const source = ['videoGenerate', 'imageGenerate', 'audioGenerate', 'textComplete'].some((name) => {
    const seam = getSeam(name) as { execute?: unknown } | undefined;
    return typeof seam?.execute === 'function';
  }) ? 'omnimux' : 'static-stub';
  const seam = getSeam('modelCatalog') as CatalogSeam | undefined;
  if (!seam || typeof seam.list !== 'function') return { source, text: [], image: [], video: [], audio: [] };
  const body = seam.list();
  const models = Array.isArray(body.models) ? body.models.filter((row): row is CatalogModelDto =>
    typeof row === 'object' && row !== null && typeof row.id === 'string').map((row) => {
      const lines = channelGroups(row.channelGroups);
      return lines === undefined ? row : { ...row, channelGroups: lines };
    }) : undefined;
  const defaultsByOperation = body.defaultsByOperation && typeof body.defaultsByOperation === 'object'
    ? Object.fromEntries(Object.entries(body.defaultsByOperation).filter(([, value]) => typeof value === 'string' && value))
    : undefined;
  const brands = normalizeBrands(body.brands);
  return projectCanvasCatalog({
    source: body.source === 'omnimux' || body.source === 'static-stub' ? body.source : source,
    schemaVersion: typeof body.schemaVersion === 'string' ? body.schemaVersion : undefined,
    fingerprint: typeof body.fingerprint === 'string' ? body.fingerprint : undefined,
    ...(typeof body.presentationFingerprint === 'string' ? { presentationFingerprint: body.presentationFingerprint } : {}),
    ...(brands ? { brands } : {}),
    preview_fingerprint: typeof body.preview_fingerprint === 'string' ? body.preview_fingerprint : undefined,
    defaults: body.defaults, models, defaultsByOperation, defaultOperations: body.defaultOperations,
    text: rows(body.text), image: rows(body.image), video: rows(body.video), audio: rows(body.audio),
  });
}
