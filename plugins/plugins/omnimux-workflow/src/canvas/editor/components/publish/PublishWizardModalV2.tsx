/**
 * PublishWizardModalV2 — minimal group→AI-app publish flow.
 *
 * Product contract:
 * - the selected Template Group is the publish scope;
 * - inputs and outputs are auto-derived, never selected by the publisher;
 * - publishing is blocked until the whole group has a successful verified run;
 * - metadata.category is an app-center filter only and never locks output.
 *
 * This component intentionally keeps only the labels/actions needed to publish.
 */

import React, { memo, useMemo, useState } from 'react';
import { CustomModal, toast } from '../../../ui';
import { analyzeGroupPublishPlan, buildPublishPlan } from './publishPlanAnalyzer.ts';
import type {
  ApplicationCategory,
  ApplicationManifest,
  FormPropertySchema,
  PublishOutput,
  PublishVerification,
} from './publishTypes.ts';
import type { FlowEdgeLike, FlowNodeLike } from './topologyAnalyzer.ts';
import type { GroupPublishVerification } from '../../../../shared/canvasTypes.ts';
import { resolveProjectIdForWorkspace } from './publishProjectBinding.ts';
import { compactPublishSnapshotEdges, compactPublishSnapshotNodes } from '../../../../shared/publish/publishSnapshot.ts';

export interface PublishWizardModalV2Props {
  isOpen: boolean;
  onClose: () => void;
  nodes: FlowNodeLike[];
  edges: FlowEdgeLike[];
  catalog?: unknown;
  workspaceId?: string | null;
  workflowName?: string;
  groupId?: string | null;
  groupVerification?: GroupPublishVerification | null;
  onRequestGroupRun?: () => void;
  onPublished?: (manifest: ApplicationManifest) => void;
}

const FIELD_STYLE: React.CSSProperties = {
  width: '100%',
  height: 36,
  borderRadius: 7,
  border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.14))',
  background: 'var(--dsw-alias-bg-l2, rgba(255,255,255,.04))',
  color: 'inherit',
  padding: '0 10px',
  fontSize: 12,
  boxSizing: 'border-box',
};

const CATEGORY_OPTIONS: Array<{ value: ApplicationCategory; label: string }> = [
  { value: 'video', label: '视频' },
  { value: 'image', label: '图片' },
  { value: 'audio', label: '音频' },
];

function defaultCategory(outputs: PublishOutput[]): ApplicationCategory {
  const first = outputs[0]?.outputType;
  return first === 'image' || first === 'audio' ? first : 'video';
}

function defaultIconSvg(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>';
}

function verificationError(
  analysis: ReturnType<typeof analyzeGroupPublishPlan>,
  verification: GroupPublishVerification | null | undefined,
  nodeIds: string[],
): string | null {
  if (analysis.errors.length > 0) return analysis.errors[0]!.message;
  if (!verification) return '当前没有跑通，所以不能发布 AI 应用';
  if (verification.graphHash !== analysis.graphHash) return '验证已过期，请重新执行整组流程';
  const allCompleted = nodeIds.every((nodeId) => verification.nodeStatuses[nodeId] === 'completed');
  if (!allCompleted) return '当前没有跑通，所以不能发布 AI 应用';
  if (verification.outputs.length === 0) return '流程执行成功，但没有可展示的输出';
  if (analysis.outputs.some((output) => !verification.outputs.some((item) => item.nodeId === output.nodeId))) {
    return '流程执行成功，但没有可展示的输出';
  }
  return null;
}

function buildFormConfig(analysis: ReturnType<typeof analyzeGroupPublishPlan>): {
  properties: Record<string, FormPropertySchema>;
  required: string[];
  demoSnapshot: Record<string, unknown>;
  fieldMappings: ApplicationManifest['fieldMappings'];
} {
  const properties: Record<string, FormPropertySchema> = {};
  const demoSnapshot: Record<string, unknown> = {};
  const fieldMappings: ApplicationManifest['fieldMappings'] = {};
  const required: string[] = [];
  for (const input of analysis.inputs) {
    properties[input.key] = {
      type: 'string',
      title: input.label,
      widget: input.widget,
    };
    if (input.required) required.push(input.key);
    if (input.sampleValue !== undefined) demoSnapshot[input.key] = input.sampleValue;
    fieldMappings[input.key] = {
      nodeId: input.nodeId,
      targetField: input.slotId,
      mappingType: input.slotId === 'mediaUrl' ? 'media' : 'text',
      widget: input.widget,
      label: input.label,
      required: input.required,
      ...(input.sampleValue !== undefined ? { defaultValue: input.sampleValue } : {}),
    };
  }
  return { properties, required, demoSnapshot, fieldMappings };
}

export const PublishWizardModalV2: React.FC<PublishWizardModalV2Props> = memo(({
  isOpen,
  onClose,
  nodes,
  edges,
  catalog: _catalog,
  workspaceId,
  workflowName = '未命名应用',
  groupId = '',
  groupVerification,
  onRequestGroupRun,
  onPublished,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [appName, setAppName] = useState(workflowName);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ApplicationCategory | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const analysis = useMemo(
    () => analyzeGroupPublishPlan(nodes, edges, groupId || ''),
    [nodes, edges, groupId],
  );
  const effectiveCategory = category ?? defaultCategory(analysis.outputs);
  const blockReason = verificationError(analysis, groupVerification, nodes.map((node) => node.id));
  const formConfig = useMemo(() => buildFormConfig(analysis), [analysis]);

  const close = () => {
    setStep(1);
    setSubmitting(false);
    onClose();
  };

  const runFirst = () => {
    onRequestGroupRun?.();
    close();
  };

  const publish = async () => {
    if (!appName.trim()) {
      toast.warning('请输入应用名称');
      return;
    }
    if (blockReason) {
      toast.warning(blockReason);
      return;
    }
    setSubmitting(true);
    try {
      const plan = buildPublishPlan(groupId || '', analysis);
      const verification: PublishVerification = {
        executionId: groupVerification!.executionId,
        graphHash: groupVerification!.graphHash,
        completedAt: groupVerification!.completedAt,
        nodeStatuses: groupVerification!.nodeStatuses,
        outputs: groupVerification!.outputs.map((output) => ({
          workflowId: plan.workflows[0]?.workflowId ?? '',
          nodeId: output.nodeId,
          capabilityId: plan.outputs.find((candidate) => candidate.nodeId === output.nodeId)?.capabilityId ?? '',
          outputType: output.type as PublishOutput['outputType'],
          artifact: {
            ...(output.url ? { url: output.url } : {}),
            ...(output.text ? { text: output.text } : {}),
          },
        })),
        simulated: false,
      };
      const projectId = await resolveProjectIdForWorkspace(String(workspaceId || ''));
      const cleanSlug = appName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
      const appId = `app_${cleanSlug}_${Date.now().toString(36)}`;
      const showcaseMediaType = (() => {
        const outputType = plan.outputs[0]?.outputType;
        return outputType === 'image' || outputType === 'audio' || outputType === 'video'
          ? outputType
          : effectiveCategory;
      })();
      const manifest: ApplicationManifest = {
        appId,
        version: '1.0.0',
        schemaVersion: '1.1',
        createdAt: new Date().toISOString(),
        metadata: {
          name: appName.trim(),
          category: effectiveCategory,
          ...(description.trim() ? { description: description.trim() } : {}),
          iconSvg: defaultIconSvg(),
        },
        workflowBinding: {
          workspaceId: workspaceId || 'workspace_main',
          workflowHash: analysis.graphHash,
          snapshot: {
            nodes: compactPublishSnapshotNodes(nodes),
            edges: compactPublishSnapshotEdges(edges),
          },
          ...(groupId ? { sourceGroupId: groupId } : {}),
          ...(projectId ? { projectId } : {}),
        },
        publishPlan: {
          ...plan,
          outputs: plan.outputs.map((output) => ({
            ...output,
            artifact: verification.outputs.find((item) => item.nodeId === output.nodeId)?.artifact,
          })),
        },
        verification,
        formSchema: {
          type: 'object',
          properties: formConfig.properties,
          required: formConfig.required,
          additionalProperties: false,
        },
        fieldMappings: formConfig.fieldMappings,
        demoSnapshot: formConfig.demoSnapshot,
        showcase: {
          mode: 'carousel',
          items: verification.outputs
            .filter((output) => output.artifact?.url)
            .map((output) => ({
              id: `showcase_${output.nodeId}`,
              title: appName.trim(),
              mediaType: showcaseMediaType,
              mediaUrl: output.artifact!.url!,
            })),
        },
      };
      const cached = JSON.parse(window.localStorage?.getItem('omnimux_apps_manifests') || '{}');
      cached[manifest.appId] = manifest;
      window.localStorage?.setItem('omnimux_apps_manifests', JSON.stringify(cached));
      window.dispatchEvent(new CustomEvent('omnimux:app-tabs-changed', { detail: { id: manifest.appId, manifest } }));
      if (typeof (window as any).__omnimuxOpenAppTab === 'function') {
        (window as any).__omnimuxOpenAppTab(manifest);
      }
      onPublished?.(manifest);
      toast.success('已发布');
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  if (blockReason) {
    return (
      <CustomModal
        open={isOpen}
        onCancel={close}
        title="发布为 AI 应用"
        width={460}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="wf-btn" onClick={close}>取消</button>
            {onRequestGroupRun && (
              <button type="button" className="wf-btn" onClick={runFirst}
                style={{ background: 'var(--dsw-alias-state-business-primary, #4c8dff)', color: '#fff', border: 'none' }}>
                去整组执行
              </button>
            )}
          </div>
        )}
      >
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>{blockReason}</div>
      </CustomModal>
    );
  }

  return (
    <CustomModal
      open={isOpen}
      onCancel={close}
      title="发布为 AI 应用"
      width={560}
      footer={(
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-secondary, #a1a1aa)' }}>{step} / 2</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="wf-btn" onClick={close}>取消</button>
            {step === 1 ? (
              <button type="button" className="wf-btn" onClick={() => setStep(2)}
                style={{ background: 'var(--dsw-alias-state-business-primary, #4c8dff)', color: '#fff', border: 'none' }}>
                下一步
              </button>
            ) : (
              <>
                <button type="button" className="wf-btn" onClick={() => setStep(1)}>上一步</button>
                <button type="button" className="wf-btn" disabled={submitting} onClick={() => void publish()}
                  style={{ background: 'var(--dsw-alias-state-business-primary, #4c8dff)', color: '#fff', border: 'none', opacity: submitting ? 0.6 : 1 }}>
                  {submitting ? '发布中...' : '发布'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    >
      {step === 1 && (
        <div style={{ display: 'grid', gap: 14 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
            应用名称
            <input style={FIELD_STYLE} value={appName} onChange={(event) => setAppName(event.target.value)} autoFocus />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
            应用分类
            <select style={FIELD_STYLE} value={effectiveCategory}
              onChange={(event) => setCategory(event.target.value as ApplicationCategory)}>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
            描述
            <input style={FIELD_STYLE} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary, #a1a1aa)', marginBottom: 8 }}>输入</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {analysis.inputs.map((input) => (
                <div key={input.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                  <span>{input.label}{input.required ? ' *' : ''}</span>
                  <span style={{ color: 'var(--dsw-alias-label-tertiary, #71717a)' }}>{input.widget}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-secondary, #a1a1aa)', marginBottom: 8 }}>输出</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {analysis.outputs.map((output) => {
                const node = nodes.find((candidate) => candidate.id === output.nodeId);
                const nodeLabel = typeof node?.data?.label === 'string' && node.data.label.trim()
                  ? node.data.label.trim()
                  : output.outputType;
                return (
                  <div key={`${output.workflowId}_${output.nodeId}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                    <span>{nodeLabel}</span>
                    <span style={{ color: 'var(--dsw-alias-label-tertiary, #71717a)' }}>{output.outputType}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </CustomModal>
  );
});

PublishWizardModalV2.displayName = 'PublishWizardModalV2';
export default PublishWizardModalV2;
