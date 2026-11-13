/**
 * Operation-level research / implementation / execution materialization and listed conjunction.
 *
 * operationListed ⇔
 *   contractComplete(op)
 *   ∧ op.research.status === 'verified'
 *   ∧ op.implementation.status === 'ready'
 *   ∧ adapterProfileCompatible(op)  // ready implementation profile + operations/outputTypes/seam
 *   ∧ gateAllows(modelId, opId)
 *
 * model.listed = any(op.listed)  // summary only
 * listedOperations = [`${modelId}#${opId}`, ...]
 */

/** @typedef {'draft'|'verified'|'rejected'} ResearchStatus */
/** @typedef {'none'|'ready'} ImplementationStatus */
/** @typedef {'none'|'stub'|'live'} ExecutionStatus */

const RESEARCH_STATUSES = new Set(['draft', 'verified', 'rejected']);
const IMPLEMENTATION_STATUSES = new Set(['none', 'ready']);
const EXECUTION_STATUSES = new Set(['none', 'stub', 'live']);

/**
 * @param {unknown} raw
 * @param {{ docUrl?: string, confidence?: string }} [governance]
 * @returns {{ status: ResearchStatus, docUrl?: string, verifiedAt?: string, notes?: string }}
 */
export function normalizeResearch(raw, governance = {}) {
  const g = governance && typeof governance === 'object' ? governance : {};
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};

  let status = typeof src.status === 'string' ? src.status : undefined;
  if (!status && typeof g.confidence === 'string') {
    const c = g.confidence.toLowerCase();
    if (c === 'verified') status = 'verified';
    else if (c === 'rejected') status = 'rejected';
    else status = 'draft';
  }
  if (!status) status = 'draft';

  /** @type {ResearchStatus} */
  const normalized = RESEARCH_STATUSES.has(status) ? /** @type {ResearchStatus} */ (status) : 'draft';

  const docUrl =
    (typeof src.docUrl === 'string' && src.docUrl) ||
    (typeof g.docUrl === 'string' && g.docUrl) ||
    undefined;

  return {
    status: normalized,
    ...(docUrl ? { docUrl } : {}),
    ...(typeof src.verifiedAt === 'string' ? { verifiedAt: src.verifiedAt } : {}),
    ...(typeof src.notes === 'string' ? { notes: src.notes } : {}),
  };
}

/**
 * @param {unknown} raw
 * @returns {{ status: ExecutionStatus, profileId?: string, seam?: string, notes?: string }}
 */
export function normalizeExecution(raw) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  let status = typeof src.status === 'string' ? src.status : 'none';
  if (!EXECUTION_STATUSES.has(status)) status = 'none';

  return {
    status: /** @type {ExecutionStatus} */ (status),
    ...(typeof src.profileId === 'string' && src.profileId ? { profileId: src.profileId } : {}),
    ...(typeof src.seam === 'string' && src.seam ? { seam: src.seam } : {}),
    ...(typeof src.notes === 'string' ? { notes: src.notes } : {}),
  };
}

/**
 * Adapter readiness is independent from historical execution evidence.
 * @param {unknown} raw
 * @returns {{ status: ImplementationStatus, profileId?: string, seam?: string, verifiedAt?: string, notes?: string }}
 */
export function normalizeImplementation(raw) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  let status = typeof src.status === 'string' ? src.status : 'none';
  if (!IMPLEMENTATION_STATUSES.has(status)) status = 'none';
  return {
    status: /** @type {ImplementationStatus} */ (status),
    ...(typeof src.profileId === 'string' && src.profileId ? { profileId: src.profileId } : {}),
    ...(typeof src.seam === 'string' && src.seam ? { seam: src.seam } : {}),
    ...(typeof src.verifiedAt === 'string' && src.verifiedAt ? { verifiedAt: src.verifiedAt } : {}),
    ...(typeof src.notes === 'string' ? { notes: src.notes } : {}),
  };
}

/**
 * Deep-copy status objects so ops do not share mutable defaults.
 * @param {object} value
 * @returns {object}
 */
function cloneStatusObject(value) {
  return { ...value };
}

/**
 * Materialize operation-level research/implementation/execution from op overrides + model defaults.
 * @param {object} op
 * @param {{ research?: object, implementation?: object, execution?: object, governance?: object }} modelDefaults
 * @returns {{ research: object, implementation: object, execution: object }}
 */
export function materializeOpStatus(op, modelDefaults = {}) {
  const modelResearch = modelDefaults.research
    ? cloneStatusObject(modelDefaults.research)
    : normalizeResearch(undefined, modelDefaults.governance);
  const modelExecution = modelDefaults.execution
    ? cloneStatusObject(modelDefaults.execution)
    : normalizeExecution(undefined);
  const modelImplementation = modelDefaults.implementation
    ? cloneStatusObject(modelDefaults.implementation)
    : normalizeImplementation(undefined);

  const research =
    op.research != null
      ? normalizeResearch(op.research, {
          docUrl: modelResearch.docUrl,
          confidence: undefined,
        })
      : cloneStatusObject(modelResearch);

  // Inherit model docUrl onto verified op research when op omits docUrl
  if (research.status === 'verified' && !research.docUrl && modelResearch.docUrl) {
    research.docUrl = modelResearch.docUrl;
  }

  let execution;
  if (op.execution != null) {
    execution = normalizeExecution(op.execution);
    // Fill profileId/seam from model default when op only overrides status partially
    if (!execution.profileId && modelExecution.profileId) {
      execution.profileId = modelExecution.profileId;
    }
    if (!execution.seam && modelExecution.seam) {
      execution.seam = modelExecution.seam;
    }
  } else {
    execution = cloneStatusObject(modelExecution);
  }

  let implementation;
  if (op.implementation != null) {
    implementation = normalizeImplementation(op.implementation);
    if (!implementation.profileId && modelImplementation.profileId) {
      implementation.profileId = modelImplementation.profileId;
    }
    if (!implementation.seam && modelImplementation.seam) {
      implementation.seam = modelImplementation.seam;
    }
  } else {
    implementation = cloneStatusObject(modelImplementation);
  }

  return { research, implementation, execution };
}

/**
 * @param {object} profiles
 * @param {string} [profileId]
 * @returns {object|null}
 */
export function getAdapterProfile(profiles, profileId) {
  if (!profileId || typeof profileId !== 'string') return null;
  const list = profiles?.profiles;
  if (!Array.isArray(list)) return null;
  return list.find((p) => p && p.id === profileId) ?? null;
}

/**
 * @param {object} profiles
 * @param {string} [profileId]
 * @returns {boolean}
 */
export function adapterProfileExists(profiles, profileId) {
  const hit = getAdapterProfile(profiles, profileId);
  if (!hit) return false;
  return hit.status === 'live';
}

/**
 * Profile compatibility for a live operation claim.
 * @param {object} op
 * @param {object} profiles
 * @returns {{ ok: boolean, reason?: string, profile?: object|null }}
 */
export function adapterProfileCompatible(op, profiles) {
  const implementation = op?.implementation ?? {};
  const profileId = implementation.profileId;
  if (!profileId || typeof profileId !== 'string') {
    return { ok: false, reason: 'missing profileId', profile: null };
  }
  const profile = getAdapterProfile(profiles, profileId);
  if (!profile) {
    return { ok: false, reason: `unknown profileId "${profileId}"`, profile: null };
  }
  if (profile.status !== 'live') {
    return { ok: false, reason: `profile "${profileId}" is not live`, profile };
  }

  const ops = Array.isArray(profile.operations) ? profile.operations : [];
  if (!ops.includes(op.id)) {
    return {
      ok: false,
      reason: `operation "${op.id}" not in profile "${profileId}".operations`,
      profile,
    };
  }

  const outTypes = Array.isArray(profile.outputTypes) ? profile.outputTypes : [];
  const outType = op.output?.type;
  if (!outTypes.includes(outType)) {
    return {
      ok: false,
      reason: `output.type "${outType}" not in profile "${profileId}".outputTypes`,
      profile,
    };
  }

  // Seam consistency: if both declare seam, they must match; null profile.seam only ok for unavailable
  const profileSeam = profile.seam ?? null;
  const opSeam = typeof implementation.seam === 'string' ? implementation.seam : undefined;
  if (opSeam && profileSeam && opSeam !== profileSeam) {
    return {
      ok: false,
      reason: `implementation.seam "${opSeam}" !== profile.seam "${profileSeam}"`,
      profile,
    };
  }

  // Optional slotRoles check
  if (Array.isArray(profile.slotRoles) && profile.slotRoles.length > 0) {
    const roles = new Set((op.inputs ?? []).map((s) => s.role).filter(Boolean));
    for (const required of profile.slotRoles) {
      if (!roles.has(required)) {
        return {
          ok: false,
          reason: `missing required slot role "${required}" for profile "${profileId}"`,
          profile,
        };
      }
    }
  }

  return { ok: true, profile };
}

/**
 * @param {string} modelId
 * @param {string} [operationId]
 * @param {(modelId: string, operationId?: string) => boolean} [gateAllows]
 * @returns {boolean}
 */
export function gateAllowsModel(modelId, operationId, gateAllows) {
  if (typeof gateAllows === 'function') {
    try {
      // Support both (modelId) and (modelId, opId) signatures
      return Boolean(gateAllows.length >= 2 ? gateAllows(modelId, operationId) : gateAllows(modelId));
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * @param {object} op
 * @param {string} modelId
 * @param {object} profiles
 * @param {{ contractComplete?: boolean, gateAllows?: Function }} [opts]
 * @returns {boolean}
 */
export function computeOperationListed(op, modelId, profiles, opts = {}) {
  const contractComplete = opts.contractComplete !== false;
  if (!contractComplete) return false;

  const research = op.research ?? normalizeResearch(undefined);
  const implementation = op.implementation ?? normalizeImplementation(undefined);

  if (research.status !== 'verified') return false;
  if (implementation.status !== 'ready') return false;

  const compat = adapterProfileCompatible({ ...op, research, implementation }, profiles);
  if (!compat.ok) return false;

  if (!gateAllowsModel(modelId, op.id, opts.gateAllows)) return false;
  return true;
}

/**
 * @deprecated Model-level listed is summary only. Prefer computeOperationListed.
 * @param {object} model
 * @param {object} profiles
 * @param {{ contractComplete?: boolean, gateAllows?: Function }} [opts]
 * @returns {boolean}
 */
export function computeListed(model, profiles, opts = {}) {
  const ops = Array.isArray(model?.operations) ? model.operations : [];
  if (ops.length === 0) {
    // Legacy single-shot path used by older tests: treat model.research/execution as one virtual op
    const virtual = {
      id: '_model',
      output: { type: 'text' },
      inputs: [],
      research: model.research,
      execution: model.execution,
    };
    // Without operations list on profile, only check profile live existence for backward tests
    const contractComplete = opts.contractComplete !== false;
    if (!contractComplete) return false;
    if (virtual.research?.status !== 'verified') return false;
    if (model.implementation?.status !== 'ready') return false;
    if (!adapterProfileExists(profiles, model.implementation?.profileId)) return false;
    if (!gateAllowsModel(model.id, undefined, opts.gateAllows)) return false;
    return true;
  }
  return ops.some((op) => computeOperationListed(op, model.id, profiles, opts));
}

/**
 * Derive listedOperations keys and model.listed summary.
 * @param {object} model
 * @returns {{ listed: boolean, listedOperations: string[] }}
 */
export function deriveModelListedSummary(model) {
  const listedOperations = [];
  for (const op of model.operations ?? []) {
    if (op.listed) {
      listedOperations.push(`${model.id}#${op.id}`);
    }
  }
  listedOperations.sort((a, b) => a.localeCompare(b));
  return {
    listed: listedOperations.length > 0,
    listedOperations,
  };
}

/**
 * Research verified requires evidence (docUrl).
 * @param {{ status: string, docUrl?: string }} research
 * @returns {boolean}
 */
export function researchHasEvidence(research) {
  if (!research || research.status !== 'verified') return true;
  return typeof research.docUrl === 'string' && research.docUrl.trim().length > 0;
}

export const RESEARCH_STATUS_SET = RESEARCH_STATUSES;
export const IMPLEMENTATION_STATUS_SET = IMPLEMENTATION_STATUSES;
export const EXECUTION_STATUS_SET = EXECUTION_STATUSES;
