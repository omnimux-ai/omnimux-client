/**
 * Coverage auditor (H2): runtime catalog universe vs YAML contract ids,
 * driven by the dispositions machine truth.
 *
 * H2 changes vs H1:
 * - Runtime ids derive from the contract universe (model.id + declared wire
 *   aliases) — the old hardcoded JS tables were strangled into facades, so the
 *   45-row dispositions.json pins the known runtime set (D1/D5 mirror lock).
 * - coverage_missing only fires for runtime ids whose disposition requires a
 *   contract (canonical/draft or absent row); alias/unavailable/quarantine/
 *   deprecated ids legitimately lack a model.id row.
 * - coverage_extra upgrades to a strict-mode error (ghost YAML ids).
 */

import { loadAll, DEFAULT_SPECS_DIR } from './load.js';

/** Dispositions that legitimately lack a YAML model.id row. */
const MISSING_YAML_OK_DISPOSITIONS = new Set(['alias', 'unavailable', 'quarantine', 'deprecated']);

/**
 * Runtime model id universe: every contract model.id plus its declared wire
 * aliases. Sorted unique.
 * @param {import('./index.js').ContractIndex} [index] defaults to the on-disk specs
 * @returns {string[]}
 */
export function collectRuntimeModelIds(index) {
  const idx = index ?? loadAll(DEFAULT_SPECS_DIR);
  const ids = new Set();
  for (const model of idx.all()) {
    if (model?.id) ids.add(String(model.id));
    for (const alias of model?.aliases ?? []) {
      if (typeof alias === 'string' && alias) ids.add(alias);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/**
 * Collect listedOperations from index (authoritative).
 * @param {import('./index.js').ContractIndex} index
 * @returns {string[]}
 */
export function collectListedOperations(index) {
  if (Array.isArray(index.listedOperations)) {
    return [...index.listedOperations].sort((a, b) => a.localeCompare(b));
  }
  const keys = [];
  for (const model of index.all()) {
    for (const op of model.operations ?? []) {
      if (op.listed) keys.push(`${model.id}#${op.id}`);
    }
  }
  return keys.sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string[]} runtimeIds
 * @param {import('./index.js').ContractIndex} index
 * @returns {object}
 */
export function diffCoverage(runtimeIds, index) {
  const runtime = [...new Set(runtimeIds.map(String))].sort((a, b) => a.localeCompare(b));
  const contractIds = index.all().map((m) => m.id).sort((a, b) => a.localeCompare(b));
  const contractSet = new Set(contractIds);
  const runtimeSet = new Set(runtime);

  const missingInYaml = runtime.filter((id) => !contractSet.has(id));
  const extraInYaml = contractIds.filter((id) => !runtimeSet.has(id));

  const listedOperations = collectListedOperations(index);
  // listedIds / listedModelIds: any-op summary only (may be empty when listedOperations=[])
  const listedModelIds = index
    .all()
    .filter((m) => m.listed || (m.listedOperations && m.listedOperations.length > 0))
    .map((m) => m.id)
    .sort((a, b) => a.localeCompare(b));
  /** @deprecated use listedOperations; listedIds is any-op model summary */
  const listedIds = listedModelIds;

  const rows = runtime.map((id) => {
    const model = index.get(id);
    const opRows = (model?.operations ?? []).map((op) => ({
      operationId: op.id,
      listed: Boolean(op.listed),
      researchStatus: op.research?.status ?? null,
      executionStatus: op.execution?.status ?? null,
      profileId: op.execution?.profileId ?? null,
    }));
    return {
      id,
      inYaml: Boolean(model),
      listed: Boolean(model?.listed),
      listedOperations: model?.listedOperations ?? [],
      researchStatus: model?.research?.status ?? null,
      executionStatus: model?.execution?.status ?? null,
      profileId: model?.execution?.profileId ?? null,
      operations: opRows,
    };
  });

  for (const id of extraInYaml) {
    const model = index.get(id);
    rows.push({
      id,
      inYaml: true,
      listed: Boolean(model?.listed),
      listedOperations: model?.listedOperations ?? [],
      researchStatus: model?.research?.status ?? null,
      executionStatus: model?.execution?.status ?? null,
      profileId: model?.execution?.profileId ?? null,
      operations: (model?.operations ?? []).map((op) => ({
        operationId: op.id,
        listed: Boolean(op.listed),
        researchStatus: op.research?.status ?? null,
        executionStatus: op.execution?.status ?? null,
        profileId: op.execution?.profileId ?? null,
      })),
      extra: true,
    });
  }

  return {
    runtimeIds: runtime,
    contractIds,
    missingInYaml,
    extraInYaml,
    listedOperations,
    listedModelIds,
    /** @deprecated any-op summary only; prefer listedOperations */
    listedIds,
    rows,
    runtimeCount: runtime.length,
    contractCount: contractIds.length,
    missingCount: missingInYaml.length,
    extraCount: extraInYaml.length,
    listedOperationCount: listedOperations.length,
  };
}

/**
 * Build coverage issues for the report.
 *
 * H2 dispositions-driven: a missing-in-YAML id whose disposition legitimately
 * lacks a contract row (alias/unavailable/quarantine/deprecated) is expected
 * and produces no issue; canonical/draft/absent rows produce coverage_missing
 * (error under --strict, warning under --audit). coverage_extra upgrades to
 * error under --strict (D6).
 *
 * @param {object} coverage
 * @param {{ strict?: boolean, dispositions?: object }} [opts]
 * @returns {object[]}
 */
export function coverageIssues(coverage, opts = {}) {
  const strict = Boolean(opts.strict);
  const dispositions = opts.dispositions;
  const dispositionOf = (id) => {
    const rows = Array.isArray(dispositions?.dispositions) ? dispositions.dispositions : [];
    return rows.find((r) => r && r.id === id)?.disposition;
  };
  /** @type {object[]} */
  const issues = [];
  for (const id of coverage.missingInYaml ?? []) {
    const disp = dispositionOf(id);
    if (disp && MISSING_YAML_OK_DISPOSITIONS.has(disp)) continue;
    issues.push({
      level: strict ? 'error' : 'warning',
      code: 'coverage_missing',
      modelId: id,
      message: `runtime model "${id}" has no YAML contract (disposition: ${disp ?? 'none'})`,
    });
  }
  for (const id of coverage.extraInYaml ?? []) {
    issues.push({
      level: strict ? 'error' : 'warning',
      code: 'coverage_extra',
      modelId: id,
      message: `YAML contract "${id}" is not in runtime catalog`,
    });
  }
  return issues;
}
