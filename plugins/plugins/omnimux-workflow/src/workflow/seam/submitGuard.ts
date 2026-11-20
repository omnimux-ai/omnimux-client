import type { CapabilityCatalog } from '../../shared/api.ts';
import { buildContractView, buildUpstreamFingerprint, matchOperationInputs, operationAcceptsText, resolveModelView } from '../../shared/validation/compatKernel.ts';
import { buildEffectiveOpsUiState } from '../../shared/validation/operationUi.ts';
import { narrowCatalogByRouting, requiredEffectiveVideoParameter, resolveEffectiveVideoGroup, resolveEffectiveVideoOperation } from '../../shared/validation/lineConstraints.ts';
import type { GenerationGateway, ReferenceAssetPayload, SubmitRequest, WorkflowSubmission } from './gateway.ts';
import { SeamGatewayError } from './SeamGatewayError.ts';
import { submissionFingerprint, submissionReferences } from './submissionInputs.ts';

interface SubmissionValidationOptions {
  deferVisualPrompt?: boolean;
}

function submissionModel(req: SubmitRequest, catalog: CapabilityCatalog) {
  if (req.model !== undefined && typeof req.model !== 'string') {
    throw new SeamGatewayError('model-not-allowed', '模型标识无效，请重新选择模型');
  }
  const id = req.model?.trim() || catalog.defaults?.[req.capability] || '';
  const model = resolveModelView(buildContractView(catalog), id);
  const row = catalog[req.capability]?.find((candidate) => candidate.id === model?.id);
  if (!model || !row) {
    throw new SeamGatewayError('model-not-allowed', '请选择当前目录中的可用模型');
  }
  if (row.executionStatus === 'unsupported' || row.executionStatus === 'unverified') {
    throw new SeamGatewayError('model-unsupported', row.executionStatus === 'unverified'
      ? '该自定义模型服务尚未验证，请先在设置中完成配置'
      : '该网关模型缺少本地执行适配，暂时无法生成');
  }
  if (model.synthesized) {
    throw new SeamGatewayError('contract_missing', '模型目录缺少生成方式合同，请刷新目录后重试');
  }
  if (!model.operations.some((op) => op.listed && op.output.type === req.capability)) {
    throw new SeamGatewayError('model-not-allowed', '当前模型没有此类节点可用的生成方式');
  }
  return model;
}

/** Only the executor may resolve an omitted operation using the shared canvas policy. */
export function resolveExecutorSubmission(req: SubmitRequest, catalog: CapabilityCatalog, options: SubmissionValidationOptions = {}): SubmitRequest {
  if (req.operation !== undefined) return resolveCanvasSubmission(req, catalog, options);
  const requestedModel = typeof req.model === 'string' ? req.model.trim() : '';
  if (req.capability === 'video' && resolveEffectiveVideoGroup(catalog, requestedModel || catalog.defaults?.video, req)) {
    throw new SeamGatewayError('operation-required', '请选择生成方式后再提交');
  }
  const model = submissionModel(req, catalog);
  const state = buildEffectiveOpsUiState({
    catalog, modelId: model.id, outputType: req.capability, fingerprint: submissionFingerprint(req),
    deferVisualPrompt: options.deferVisualPrompt,
  });
  if (state.blockGenerate || !state.selectedOperationId) {
    throw new SeamGatewayError(state.reasonCode ?? 'operation-required', state.reasonMessage ?? '请选择生成方式');
  }
  return resolveCanvasSubmission({ ...req, model: model.id, operation: state.selectedOperationId }, catalog, options);
}

/** SubmitGuard: accepting connections is not sufficient to submit a new task. */
export function resolveCanvasSubmission(req: SubmitRequest, inputCatalog: CapabilityCatalog, options: SubmissionValidationOptions = {}): SubmitRequest {
  const requestedModel = typeof req.model === 'string' ? req.model.trim() : '';
  const modelId = requestedModel || inputCatalog.defaults?.[req.capability];
  const managed = req.capability === 'video' ? resolveEffectiveVideoGroup(inputCatalog, modelId, req) : null;
  if (managed && !managed.group) throw new SeamGatewayError('line_selection_required', '请选择当前可用的生成线路');
  if (req.effectiveVideoVersion !== undefined && req.effectiveVideoVersion !== managed?.model.effectiveVideoVersion) {
    throw new SeamGatewayError('line_capability_changed', '线路规则或价格已更新，请确认后重新生成');
  }
  const params = { ...req };
  const variant = managed?.group ? resolveEffectiveVideoOperation(managed.group, req.operation, params) : undefined;
  if (managed && !variant) throw new SeamGatewayError('operation-not-allowed', '当前线路不支持所选生成方式或参数，请重新选择');
  const required = variant && requiredEffectiveVideoParameter(variant, params);
  if (required) throw new SeamGatewayError('parameter_required', `请选择参数“${required}”`);
  const catalog = managed ? narrowCatalogByRouting(inputCatalog, modelId, req, { ...params, operation: variant?.id }) ?? inputCatalog : inputCatalog;
  const model = submissionModel(req, catalog);
  if (typeof req.operation !== 'string' || !req.operation.trim()) throw new SeamGatewayError('operation-required', '请选择生成方式后再提交');
  const operation = model.operations.find((op) => op.id === (variant?.id ?? req.operation));
  if (!operation?.listed || operation.output.type !== req.capability) {
    throw new SeamGatewayError('operation-not-allowed', '当前模型不支持所选生成方式，请重新选择');
  }
  const submitted = submissionFingerprint(req);
  if (req.textInputs !== undefined && (!Array.isArray(req.textInputs) || req.textInputs.some(input => !input
    || typeof input.sourceNodeId !== 'string' || typeof input.edgeId !== 'string' || typeof input.targetSlot !== 'string'
    || typeof input.textContent !== 'string'))) throw new SeamGatewayError('input_unavailable', '文本输入无效，请替换或停用');
  const fingerprint = buildUpstreamFingerprint({ ...submitted, localText: req.localText,
    assets: [...submitted.assets, ...(req.textInputs ?? []).map(input => ({ ...input, type: 'text', availability: 'ready' as const }))] });
  // Limit the matcher to the requested operation; never replace an explicit creative choice.
  const match = matchOperationInputs(operation, fingerprint, options);
  const failure = !match.accepts ? match.rejections[0] : !match.ready ? match.pending[0] : undefined;
  if (!match.accepts || !match.ready) {
    throw new SeamGatewayError(failure?.code ?? 'operation_incompatible', failure?.message ?? '当前输入尚不满足生成要求');
  }
  const bindings = [...match.bindings];
  const normalized = new Map<ReferenceAssetPayload, ReferenceAssetPayload>();
  const references = submissionReferences(req);
  for (const [index, asset] of fingerprint.mediaAssets.entries()) {
    const bindingIndex = bindings.findIndex((binding) => binding.sourceNodeId === asset.sourceNodeId
      && binding.edgeId === asset.edgeId && binding.type === asset.type
      && (!asset.targetSlot || binding.slot === asset.targetSlot) && (!asset.role || binding.role === asset.role));
    if (bindingIndex < 0) throw new SeamGatewayError('role_conflict', `来源 ${asset.sourceNodeId} 的用途与目标槽位不一致`);
    const [binding] = bindings.splice(bindingIndex, 1);
    const slot = operation.inputs.find((input) => input.slot === binding!.slot)!;
    const durationRequired = [slot.minDurationSec, slot.maxDurationSec, slot.totalMinDurationSec,
      slot.totalMaxDurationSec, slot.combinedOutputMaxDurationSec].some(Number.isFinite);
    if ((slot.allowedMimes?.length && !asset.mimeType) || (Number.isFinite(slot.maxSizeMb) && asset.sizeBytes === undefined)
      || (durationRequired && asset.durationSec === undefined)) {
      throw new SeamGatewayError('metadata_required', `来源 ${asset.sourceNodeId} 缺少槽位 ${slot.slot} 校验所需的素材信息，请重新读取素材`);
    }
    normalized.set(references[index]!, { ...references[index]!, pathOrUrl: asset.url!, role: binding!.role as ReferenceAssetPayload['role'],
      ...(references[index]!.targetSlot ? {} : { targetSlot: binding!.slot }),
      ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
      ...(asset.sizeBytes !== undefined ? { sizeBytes: asset.sizeBytes } : {}),
      ...(asset.durationSec !== undefined ? { durationSec: asset.durationSec } : {}) });
  }
  const trackReference = req.audioTrack && references.find((ref) => ref.pathOrUrl === req.audioTrack!.pathOrUrl
    && ref.role === req.audioTrack!.role && ref.targetSlot === req.audioTrack!.targetSlot);
  const resolved = { ...req, model: model.id,
    ...(managed?.group && variant ? {
      operation: variant.id,
      allowedGroups: [managed.group.wireGroup ?? managed.group.id],
    } : {}),
    ...(req.references ? { references: req.references.map((ref) => normalized.get(ref)!) } : {}),
    ...(trackReference ? { audioTrack: normalized.get(trackReference)! } : {}) };
  if (model.hasGatewayInputContract && !operationAcceptsText(model, operation)) {
    delete resolved.prompt;
    delete resolved.localText;
    delete resolved.textInputs;
    delete resolved.interleavedParts;
  }
  return resolved;
}

/** Keep the authoritative snapshot private. Preparation code receives its own working copy. */
export function createWorkflowSubmission(
  catalog: CapabilityCatalog, submitResolved: GenerationGateway['submit'], options: SubmissionValidationOptions = {},
): WorkflowSubmission {
  const snapshot = structuredClone(catalog);
  return {
    catalog: structuredClone(snapshot),
    async submit(request) {
      const resolved = resolveExecutorSubmission(request, snapshot, options);
      // Record what this backend actually accepted; a working catalog can be
      // replaced between UI admission and dispatch. Older tasks have no proof.
      const omittedNodePrompt = resolved.model === 'minimax-h3-video' && resolved.operation === 'digital_human'
        && typeof request.prompt === 'string' && !Object.hasOwn(resolved, 'prompt');
      return { task: await submitResolved(resolved), model: resolved.model, ...(omittedNodePrompt ? { omittedNodePrompt: true } : {}) };
    },
  };
}

/** Embedders that supply the original gateway interface still get guarded executor submissions. */
export async function openWorkflowSubmission(gateway: GenerationGateway, catalog?: CapabilityCatalog): Promise<WorkflowSubmission> {
  if (gateway.submit.openWorkflowSubmission) return gateway.submit.openWorkflowSubmission();
  return createWorkflowSubmission(catalog ?? await gateway.capabilities(), request => gateway.submit(request));
}
