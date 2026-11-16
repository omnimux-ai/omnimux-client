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

import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  FileText,
  Image as ImageIcon,
  Link2,
  Music,
  Play,
  RefreshCw,
  Sparkles,
  Table2,
  Video,
  X,
} from 'lucide-react';
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

interface CategoryOption {
  value: ApplicationCategory;
  label: string;
  icon: React.ReactNode;
}

const CATEGORY_OPTIONS: CategoryOption[] = [
  { value: 'video', label: '视频', icon: <Video size={15} /> },
  { value: 'image', label: '图片', icon: <ImageIcon size={15} /> },
  { value: 'audio', label: '音频', icon: <Music size={15} /> },
];

const WIDGET_LABELS: Record<string, string> = {
  'media-extractor': '链接输入',
  text: '文本',
  textarea: '多行文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  file: '文件',
  document: '文档',
};

const OUTPUT_TYPE_LABELS: Record<string, string> = {
  video: '视频',
  image: '图片',
  audio: '音频',
  text: '文本',
  table: '表格',
};

function formatWidgetLabel(widget: string): string {
  return WIDGET_LABELS[widget] ?? widget;
}

function formatOutputTypeLabel(outputType: string): string {
  return OUTPUT_TYPE_LABELS[outputType] ?? outputType;
}

function renderInputIcon(widget: string): React.ReactNode {
  if (widget === 'media-extractor') return <Link2 size={13} />;
  if (widget === 'image') return <ImageIcon size={13} />;
  if (widget === 'video') return <Video size={13} />;
  if (widget === 'audio') return <Music size={13} />;
  return <FileText size={13} />;
}

function renderOutputIcon(outputType: string): React.ReactNode {
  if (outputType === 'video') return <Video size={13} />;
  if (outputType === 'image') return <ImageIcon size={13} />;
  if (outputType === 'audio') return <Music size={13} />;
  if (outputType === 'table') return <Table2 size={13} />;
  return <FileText size={13} />;
}

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
  const [nameTouched, setNameTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setAppName(workflowName);
    setDescription('');
    setCategory(null);
    setNameTouched(false);
    setSubmitting(false);
  }, [isOpen, workflowName]);

  const analysis = useMemo(
    () => analyzeGroupPublishPlan(nodes, edges, groupId || ''),
    [nodes, edges, groupId],
  );
  const effectiveCategory = category ?? defaultCategory(analysis.outputs);
  const blockReason = verificationError(analysis, groupVerification, nodes.map((node) => node.id));
  const formConfig = useMemo(() => buildFormConfig(analysis), [analysis]);

  const close = () => {
    setStep(1);
    setNameTouched(false);
    setSubmitting(false);
    onClose();
  };

  const runFirst = () => {
    onRequestGroupRun?.();
    close();
  };

  const goToStep = (target: 1 | 2) => {
    if (submitting) return;
    if (target === 2 && !appName.trim()) {
      setNameTouched(true);
      nameInputRef.current?.focus();
      return;
    }
    setStep(target);
  };

  const publish = async () => {
    if (!appName.trim()) {
      setNameTouched(true);
      setStep(1);
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
    const isStale = blockReason.includes('过期');
    const canRunGroup = Boolean(onRequestGroupRun) && analysis.errors.length === 0;
    return (
      <CustomModal
        open={isOpen}
        onCancel={close}
        className="wf-publish-modal wf-publish-modal--blocked"
        width={440}
        title={(
          <div className="wf-publish-modal__title-wrap">
            <span className="wf-publish-modal__title-icon" aria-hidden="true">
              <Sparkles size={15} />
            </span>
            <span className="wf-publish-modal__title-text">发布为 AI 应用</span>
          </div>
        )}
        footer={(
          <div className="wf-publish-modal__footer wf-publish-modal__footer--end">
            <div className="wf-publish-modal__actions">
              <button type="button" className="wf-publish-modal__btn wf-publish-modal__btn--secondary" onClick={close}>
                取消
              </button>
              {canRunGroup && (
                <button type="button" className="wf-publish-modal__btn wf-publish-modal__btn--primary" onClick={runFirst}>
                  <Play size={13} fill="currentColor" />
                  <span>去整组执行</span>
                </button>
              )}
            </div>
          </div>
        )}
      >
        <div className="wf-publish-modal__blocked-box">
          <div className="wf-publish-modal__blocked-icon" aria-hidden="true">
            {isStale ? <RefreshCw size={18} /> : <AlertCircle size={18} />}
          </div>
          <div className="wf-publish-modal__blocked-text">{blockReason}</div>
        </div>
      </CustomModal>
    );
  }

  const trimmedName = appName.trim();
  const showNameError = nameTouched && !trimmedName;
  const activeCategoryMeta = CATEGORY_OPTIONS.find((opt) => opt.value === effectiveCategory) ?? CATEGORY_OPTIONS[0]!;

  return (
    <CustomModal
      open={isOpen}
      onCancel={close}
      className="wf-publish-modal"
      width={500}
      title={(
        <div className="wf-publish-modal__header-content">
          <div className="wf-publish-modal__title-wrap">
            <span className="wf-publish-modal__title-icon" aria-hidden="true">
              <Sparkles size={15} />
            </span>
            <span className="wf-publish-modal__title-text">发布为 AI 应用</span>
          </div>
          <div className="wf-publish-modal__steps" role="tablist" aria-label="发布步骤">
            <button
              type="button"
              role="tab"
              aria-selected={step === 1}
              className={`wf-publish-modal__step-pill ${step === 1 ? 'wf-publish-modal__step-pill--active' : 'wf-publish-modal__step-pill--done'}`}
              onClick={() => goToStep(1)}
            >
              <span className="wf-publish-modal__step-num">
                {step > 1 ? <Check size={10} strokeWidth={2.75} /> : '1'}
              </span>
              <span>基础信息</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={step === 2}
              className={`wf-publish-modal__step-pill ${step === 2 ? 'wf-publish-modal__step-pill--active' : ''}`}
              onClick={() => goToStep(2)}
            >
              <span className="wf-publish-modal__step-num">2</span>
              <span>确认发布</span>
            </button>
          </div>
        </div>
      )}
      footer={(
        <div className="wf-publish-modal__footer">
          <div className="wf-publish-modal__status-dot">
            <i aria-hidden="true" />
            <span>整组已验证</span>
          </div>
          <div className="wf-publish-modal__actions">
            <button
              type="button"
              className="wf-publish-modal__btn wf-publish-modal__btn--ghost"
              disabled={submitting}
              onClick={close}
            >
              取消
            </button>
            {step === 1 ? (
              <button
                type="button"
                className="wf-publish-modal__btn wf-publish-modal__btn--primary"
                onClick={() => goToStep(2)}
              >
                下一步
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="wf-publish-modal__btn wf-publish-modal__btn--secondary"
                  disabled={submitting}
                  onClick={() => goToStep(1)}
                >
                  上一步
                </button>
                <button
                  type="button"
                  className="wf-publish-modal__btn wf-publish-modal__btn--primary"
                  disabled={submitting}
                  onClick={() => void publish()}
                >
                  {submitting && <span className="wf-publish-modal__spinner" aria-hidden="true" />}
                  <span>{submitting ? '发布中...' : '发布'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    >
      {step === 1 && (
        <>
          <div className="wf-publish-modal__field">
            <div className="wf-publish-modal__label-row">
              <label htmlFor="wf-publish-app-name">
                应用名称<span className="wf-publish-modal__req">*</span>
              </label>
              {showNameError && <span className="wf-publish-modal__error">请输入应用名称</span>}
            </div>
            <div className="wf-publish-modal__input-wrap">
              <input
                id="wf-publish-app-name"
                ref={nameInputRef}
                className={`wf-publish-modal__input ${showNameError ? 'wf-publish-modal__input--invalid' : ''}`}
                value={appName}
                placeholder="例如：视频提取"
                maxLength={60}
                autoFocus
                onChange={(event) => {
                  setAppName(event.target.value);
                  if (nameTouched && event.target.value.trim()) setNameTouched(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    goToStep(2);
                  }
                }}
              />
              {appName && (
                <button
                  type="button"
                  className="wf-publish-modal__clear"
                  aria-label="清空应用名称"
                  onClick={() => {
                    setAppName('');
                    setNameTouched(true);
                    nameInputRef.current?.focus();
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          <div className="wf-publish-modal__field">
            <div className="wf-publish-modal__label-row">
              <span>应用分类</span>
            </div>
            <div className="wf-publish-modal__cat-grid" role="radiogroup" aria-label="应用分类">
              {CATEGORY_OPTIONS.map((option) => {
                const active = effectiveCategory === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`wf-publish-modal__cat-btn ${active ? 'wf-publish-modal__cat-btn--active' : ''}`}
                    onClick={() => setCategory(option.value)}
                  >
                    {option.icon}
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="wf-publish-modal__field">
            <div className="wf-publish-modal__label-row">
              <label htmlFor="wf-publish-app-desc">描述</label>
              <span className="wf-publish-modal__hint">选填</span>
            </div>
            <textarea
              id="wf-publish-app-desc"
              className="wf-publish-modal__textarea"
              value={description}
              placeholder="简短说明应用用途"
              maxLength={160}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="wf-publish-modal__summary-banner">
            <div className="wf-publish-modal__summary-name">{trimmedName || '未命名应用'}</div>
            <div className="wf-publish-modal__cat-tag">
              {activeCategoryMeta.icon}
              <span>{activeCategoryMeta.label}</span>
            </div>
          </div>

          <div className="wf-publish-modal__section">
            <div className="wf-publish-modal__section-head">
              <span>应用输入</span>
              <span className="wf-publish-modal__section-count">{analysis.inputs.length} 项</span>
            </div>
            <div className="wf-publish-modal__io-list">
              {analysis.inputs.map((input) => (
                <div key={input.key} className="wf-publish-modal__io-row">
                  <div className="wf-publish-modal__io-left">
                    <span className="wf-publish-modal__io-icon" aria-hidden="true">
                      {renderInputIcon(input.widget)}
                    </span>
                    <span className="wf-publish-modal__io-title">{input.label}</span>
                  </div>
                  <div className="wf-publish-modal__io-badges">
                    {input.required && <span className="wf-publish-modal__badge wf-publish-modal__badge--req">必填</span>}
                    <span className="wf-publish-modal__badge">{formatWidgetLabel(input.widget)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="wf-publish-modal__section">
            <div className="wf-publish-modal__section-head">
              <span>预期输出</span>
              <span className="wf-publish-modal__section-count">{analysis.outputs.length} 项</span>
            </div>
            <div className="wf-publish-modal__io-list">
              {analysis.outputs.map((output) => {
                const node = nodes.find((candidate) => candidate.id === output.nodeId);
                const nodeLabel = typeof node?.data?.label === 'string' && node.data.label.trim()
                  ? node.data.label.trim()
                  : formatOutputTypeLabel(output.outputType);
                return (
                  <div key={`${output.workflowId}_${output.nodeId}`} className="wf-publish-modal__io-row">
                    <div className="wf-publish-modal__io-left">
                      <span className="wf-publish-modal__io-icon" aria-hidden="true">
                        {renderOutputIcon(output.outputType)}
                      </span>
                      <span className="wf-publish-modal__io-title">{nodeLabel}</span>
                    </div>
                    <div className="wf-publish-modal__io-badges">
                      <span className="wf-publish-modal__badge">{formatOutputTypeLabel(output.outputType)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </CustomModal>
  );
});

PublishWizardModalV2.displayName = 'PublishWizardModalV2';
export default PublishWizardModalV2;
