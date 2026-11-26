/**
 * SlotWells — 模式驱动的媒体卡槽区（Feed-Slot 阶段二 / T03 / Issue #737 还原视觉）.
 *
 * 按 deriveSlotLayout 的 preset 渲染：
 *   - none  → 不渲染（文生视频等纯文本输入不占高度）；
 *   - pair  → [首帧] ⇆ [尾帧]，ArrowLeftRight 对调（swapNamedSlots，保持边不变）；
 *   - strip → 已填缩略图顺序排列，未满足的必填参考槽保留独立空槽，其余多格式参考共用一个通用添加入口；
 *   - named → 各具名卡槽并列（角色图 / 音频驱动等）。
 *
 * 视觉规格（对齐图 2）：
 *   - 空态与添加卡槽为 44px × 44px 大方圆角虚线加号框，圆角 10px，居中清爽 Plus(size=20) 图标；
 *   - 有独立用途的卡槽显示角色；
 *   - 填入素材后展示完整圆角大方块预览，悬浮显示小叉号 ✕ 卸装填。
 */

import React, { memo, useCallback, useRef, useState } from 'react';
import SlotHoverPreview from './SlotHoverPreview.tsx';
import { ArrowLeftRight, FileJson, FileText, Image as ImageIcon, Loader2, Music, Play, Plus, X } from 'lucide-react';
import type { MaterialType } from '../../../../../../shared/canvasTypes.ts';
import { remainingSlotCapacity, remainingTypeCapacity, totalSlotGroupCapacity } from '../../../../../../shared/graph/feedSlot/autoFillSlots.ts';
import type { SlotOccupant, SlotSpec } from '../../../../../../shared/graph/feedSlot/index.ts';
import { isOrderedImageReferenceSlot, isPromptInput, isVisualGeneration } from '../../../../../../shared/validation/compatKernel.ts';
import { useT } from '../../../../../i18n';
import type { UpstreamMediaItem } from '../../../../hooks/useUpstreamMedia.ts';
import type { SlotPickRequest, SlotWellsProps } from './types.ts';

const isPromptReferenceSlot = (spec: SlotSpec): boolean => isPromptInput(spec) || Boolean(spec.composition);

const isTextLikeMaterial = (materialType: string): boolean => materialType === 'text' || materialType === 'table';

function isNamedAssetTile(model: WellModel): boolean {
  const { occupant, upstream } = model;
  if (!occupant || !upstream || upstream.availability !== 'ready' || !upstream.hasMedia) return false;
  return isTextLikeMaterial(upstream.materialType) || upstream.materialType === 'audio';
}

/** labelKey 未入典时回退到 slot 原名，绝不渲染裸 key。 */
function useSlotLabel() {
  const t = useT();
  return (spec: SlotSpec): string => {
    if (spec.role === 'first_frame') return t('panel.slot.first_frame');
    if (spec.role === 'last_frame') return t('panel.slot.last_frame');
    const label = t(spec.labelKey);
    return label === spec.labelKey ? spec.slot : label;
  };
}

interface WellModel {
  spec: SlotSpec;
  positionLabel?: string;
  occupant?: SlotOccupant;
  upstream?: UpstreamMediaItem;
  /** 必需槽位空着 → 强调空态（自解释缺素材）。 */
  requiredEmpty: boolean;
  state?: 'ready' | 'inactive' | 'pending' | 'invalid';
  reasonCode?: string;
  onUseAsStart?: () => void;
}

function WellThumb({ model }: { model: WellModel }) {
  const { upstream } = model;

  if (!model.occupant) {
    return (
      <span className="wf-slot-well__placeholder">
        <Plus size={20} aria-hidden="true" />
      </span>
    );
  }
  if (!upstream || upstream.availability === 'unavailable') {
    return (
      <span className="wf-slot-well__placeholder wf-slot-well__placeholder--broken">
        <ImageIcon size={18} aria-hidden="true" />
      </span>
    );
  }
  if (upstream.availability === 'waiting' || !upstream.hasMedia) {
    return (
      <span className="wf-slot-well__placeholder wf-slot-well__placeholder--loading">
        <Loader2 size={18} className="wf-slot-well__spin" aria-hidden="true" />
      </span>
    );
  }
  if (upstream.url && upstream.materialType === 'image') {
    return (
      <img
        className="wf-slot-well__media"
        src={upstream.url}
        alt=""
      />
    );
  }
  if (upstream.url && upstream.materialType === 'video') {
    return (
      <span className="wf-slot-well__video-box">
        <video className="wf-slot-well__media" src={upstream.url} muted />
        <Play size={12} className="wf-slot-well__overlay-icon" aria-hidden="true" />
      </span>
    );
  }
  if (isTextLikeMaterial(upstream.materialType)) {
    const displayName = upstream.label || upstream.nodeId;
    return (
      <span className="wf-slot-well__tile wf-slot-well__tile--text">
        <FileText size={16} strokeWidth={1.85} aria-hidden="true" />
        <span className="wf-slot-well__tile-name">{displayName}</span>
      </span>
    );
  }
  if (upstream.materialType === 'audio') {
    const displayName = upstream.label || upstream.nodeId;
    return (
      <span className="wf-slot-well__tile wf-slot-well__tile--audio">
        <Music size={16} strokeWidth={1.85} aria-hidden="true" />
        <span className="wf-slot-well__tile-name">{displayName}</span>
      </span>
    );
  }
  if (upstream.materialType === 'document') {
    return (
      <span className="wf-slot-well__placeholder wf-slot-well__placeholder--document" title={upstream.label}>
        <FileJson size={18} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="wf-slot-well__placeholder">
      <ImageIcon size={18} aria-hidden="true" />
    </span>
  );
}

const SlotWells: React.FC<SlotWellsProps> = (props) => {
  const { layout, onPickSlot, onSwapSlots, onClearOccupant, onInsertToken } = props;
  const t = useT();
  const [hover, setHover] = useState<{ anchor: HTMLElement; model: WellModel } | null>(null);
  const suppressFocus = useRef<HTMLElement | null>(null);
  const closeHover = useCallback(() => setHover(null), []);
  const returnPreviewFocus = useCallback((anchor: HTMLElement) => {
    suppressFocus.current = anchor;
    anchor.focus();
    setTimeout(() => {
      if (suppressFocus.current === anchor) suppressFocus.current = null;
    }, 300);
  }, []);
  const slotLabel = useSlotLabel();
  const upstreamByEdge = new Map(
    props.upstreams.filter((item) => item.edgeId).map((item) => [item.edgeId as string, item]),
  );
  const conflictedEdges = new Set((props.conflicts ?? []).map((conflict) => conflict.occupant.edgeId));

  if (layout.slots.length === 0 && !props.records?.length) return null;

  const pickerEnabled = !layout.displayOnlyFromOperation || layout.outputType === 'image';
  const pickRequest = (spec: SlotSpec, anchor?: HTMLElement): SlotPickRequest => ({
    targetSlot: spec.slot,
    operationId: layout.operationId,
    slotRole: spec.role,
    acceptedTypes: [spec.type],
    max: spec.composition ? null : spec.max,
    openerAnchor: anchor,
  });

  const renderWell = (model: WellModel, index: number) => {
    const { spec, occupant } = model;
    const isPromptSlot = isPromptReferenceSlot(spec);
    const label = model.positionLabel ?? slotLabel(spec);
    const conflicted = occupant ? conflictedEdges.has(occupant.edgeId) : false;
    const className = [
      'wf-slot-well',
      occupant ? 'wf-slot-well--filled' : 'wf-slot-well--empty',
      model.requiredEmpty ? 'wf-slot-well--required' : '',
      conflicted ? 'wf-slot-well--conflict' : '',
    ].filter(Boolean).join(' ');

    const handleWellClick = (anchor?: HTMLElement) => {
      if (props.records && occupant) {
        if (anchor) setHover({ anchor, model });
        return;
      }
      if (occupant) {
        if (onInsertToken && model.upstream) {
          onInsertToken({
            sourceNodeId: model.upstream.nodeId,
            slotIndex: Object.values(props.bindings).flat().findIndex((item) => item === occupant),
            label: model.upstream?.label ?? label,
            materialType: (model.upstream?.materialType ?? (spec.type as MaterialType) ?? 'image') as MaterialType,
            mediaUrl: model.upstream?.url,
          });
        } else if (anchor) {
          setHover({ anchor, model });
        }
      } else if (pickerEnabled) {
        onPickSlot(pickRequest(spec, anchor));
      }
    };

    return (
      <div
        key={`${spec.slot}:${occupant?.edgeId ?? `empty-${index}`}`}
        className={className}
        role="button"
        tabIndex={0}
        data-slot={spec.slot}
        data-slot-role={spec.role}
        data-slot-edge={occupant?.edgeId}
        data-slot-state={model.state ?? (occupant ? (conflicted ? 'conflict' : 'filled') : 'empty')}
        aria-label={occupant && model.upstream?.label && model.positionLabel
          ? `${label} · ${model.upstream.label}`
          : occupant ? (model.upstream?.label ?? label)
            : spec.role === 'first_frame' || spec.role === 'last_frame'
              ? t(spec.role === 'first_frame' ? 'input.first' : 'input.last')
              : t('panel.slotPick').replace('{slot}', label)}
        onMouseEnter={(event) => { if (occupant) setHover({ anchor: event.currentTarget, model }); }}
        onFocus={(event) => { if (suppressFocus.current === event.currentTarget) return;
          if (occupant && event.target === event.currentTarget) setHover({ anchor: event.currentTarget, model }); }}
        onClick={event => handleWellClick(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            handleWellClick(event.currentTarget);
          }
        }}
      >
        <WellThumb model={model} />
        {model.positionLabel && !isNamedAssetTile(model)
          ? <span className="wf-slot-well__position">{model.positionLabel}</span>
          : null}
        {hover?.anchor.dataset.slot === spec.slot && hover.model.occupant?.edgeId === occupant?.edgeId && occupant ? (
          <SlotHoverPreview anchor={hover.anchor} upstream={model.upstream} state={model.state} reasonCode={model.reasonCode}
            onReturnFocus={returnPreviewFocus} onReplace={pickerEnabled ? () => onPickSlot({
              ...pickRequest(spec, hover.anchor), replaceEdgeId: occupant.edgeId, onReturnFocus: returnPreviewFocus,
            }) : undefined}
            onUseAsStart={model.onUseAsStart}
            onClear={(model.positionLabel || isPromptSlot) && !props.onSetUse ? () => onClearOccupant(spec.slot, occupant.edgeId) : undefined}
            use={model.state === 'inactive' ? 'inactive' : 'active'} onSetUse={props.onSetUse ? use => props.onSetUse!(spec.slot, occupant.edgeId, use) : undefined} onClose={closeHover} />
        ) : null}
        {occupant && !props.records ? (
          <button
            type="button"
            className="wf-slot-well__clear nodrag"
            aria-label={t('panel.slotClear')}
            onClick={(event) => {
              event.stopPropagation();
              onClearOccupant(spec.slot, occupant.edgeId);
            }}
          >
            <X size={10} />
          </button>
        ) : null}
      </div>
    );
  };

  const hideInactive = isVisualGeneration(layout.outputType);
  const occupiedByType = new Map<string, number>();
  const slots = layout.slots.map(spec => {
    const records = props.records?.filter(record => record.slot.slot === spec.slot
      && (record.state !== 'inactive' || !hideInactive));
    const models: WellModel[] = records ? records.map(record => ({
      spec, occupant: record.occupant, upstream: upstreamByEdge.get(record.occupant.edgeId),
      requiredEmpty: false, state: record.state, reasonCode: record.reasonCode,
    })) : (props.bindings[spec.slot] ?? []).filter(occupant => occupant.use !== 'inactive').map(occupant => ({
      spec, occupant, upstream: upstreamByEdge.get(occupant.edgeId), requiredEmpty: false,
    }));
    const occupied = models.filter(model => model.state !== 'inactive').length;
    occupiedByType.set(spec.type, (occupiedByType.get(spec.type) ?? 0) + occupied);
    return { spec, models, occupied };
  });
  const slotModels = slots.map(slot => ({ ...slot, remaining: remainingSlotCapacity(
    layout, slot.spec, slot.occupied, occupiedByType.get(slot.spec.type) ?? 0,
  ) }));
  const mediaSlotModels = slotModels.filter(({ spec }) => !isPromptReferenceSlot(spec));
  const promptWellModels = slotModels
    .filter(({ spec }) => isPromptReferenceSlot(spec))
    .flatMap(({ models }) => models);

  if (mediaSlotModels.length === 0 && promptWellModels.length === 0) return null;

  const renderNamedSlot = ({ spec, models, occupied, remaining }: typeof slotModels[number]) => {
    const positionLabel = slotLabel(spec);
    return [
      ...models.map((model, index) => renderWell({ ...model, positionLabel }, index)),
      ...(pickerEnabled && remaining > 0
        ? [renderWell({ spec, positionLabel, requiredEmpty: occupied < spec.min }, models.length)]
        : []),
    ];
  };

  const [firstSlot, lastSlot] = mediaSlotModels;
  if (layout.preset === 'pair' && mediaSlotModels.length === 2 && firstSlot && lastSlot) {
    return (
      <div className="wf-slot-wells wf-slot-wells--pair" data-testid="wf-slot-wells" data-preset="pair">
        {renderNamedSlot(firstSlot)}
        <button
          type="button"
          className="wf-slot-wells__swap nodrag"
          title={t('panel.slotSwap')}
          aria-label={t('panel.slotSwap')}
          disabled={!layout.swap || !firstSlot.models.some(model => !model.state || model.state === 'ready')
            || !lastSlot.models.some(model => !model.state || model.state === 'ready')}
          onClick={event => {
            event.stopPropagation();
            onSwapSlots?.(firstSlot.spec, lastSlot.spec);
          }}
        >
          <ArrowLeftRight size={14} aria-hidden="true" />
        </button>
        {renderNamedSlot(lastSlot)}
        {promptWellModels.map(renderWell)}
      </div>
    );
  }

  if ((layout.preset === 'named' || layout.preset === 'pair') && mediaSlotModels.length > 0) {
    return (
      <div className="wf-slot-wells wf-slot-wells--named" data-testid="wf-slot-wells" data-preset="named">
        {mediaSlotModels.flatMap(renderNamedSlot)}
        {promptWellModels.map(renderWell)}
      </div>
    );
  }

  const references = mediaSlotModels.filter(({ spec }) => spec.role === 'reference' && spec.type !== 'text');
  const named = mediaSlotModels.filter(slot => !references.includes(slot));
  const available = layout.addButton && pickerEnabled ? references.filter(({ remaining }) => remaining > 0) : [];
  const requiredAvailable = available.filter(({ spec, occupied }) => spec.min > 0 && occupied < spec.min);
  const optionalAvailable = available.filter(({ spec, occupied }) => !(spec.min > 0 && occupied < spec.min));
  const displayOrder = new Map(props.records?.map(({ slot, occupant }, index) => [slot.slot + ':' + occupant.edgeId, index]));
  const upstreamOrder = new Map(props.upstreams.map(({ edgeId }, index) => [edgeId, index]));
  const orderOf = ({ spec, occupant }: WellModel) => displayOrder.get(spec.slot + ':' + occupant?.edgeId)
    ?? occupant?.ordinal ?? upstreamOrder.get(occupant?.edgeId) ?? 0;
  const mediaReferenceCards = references.flatMap(({ spec, models }) => {
    if (!isOrderedImageReferenceSlot(spec)) return models;
    const first = models[0];
    return models.map((model, index) => ({
      ...model,
      positionLabel: t(index === 0 ? 'panel.slot.startImage' : 'panel.slot.referenceImage'),
      onUseAsStart: index > 0 && spec.max !== 2 && first?.state === 'ready' && model.state === 'ready'
        ? () => props.onSwapOrderedSlot?.(spec.slot, first.occupant!.edgeId, model.occupant!.edgeId)
        : undefined,
    }));
  });
  const referenceCards = [...mediaReferenceCards, ...promptWellModels]
    .sort((first, second) => orderOf(first) - orderOf(second));
  return (
    <div className="wf-slot-wells wf-slot-wells--strip" data-testid="wf-slot-wells" data-preset="strip">
      {referenceCards.map(renderWell)}
      {references.map(({ spec, models }) => {
        const [first, second] = models;
        if (!isOrderedImageReferenceSlot(spec) || models.length !== 2 || first?.state !== 'ready' || second?.state !== 'ready') return null;
        return <button key={spec.slot + ':swap'} type="button" className="wf-slot-wells__swap nodrag"
          aria-label={t('panel.slotSwapImages')} title={t('panel.slotSwapImages')}
          onClick={event => {
            event.stopPropagation();
            props.onSwapOrderedSlot?.(spec.slot, first.occupant!.edgeId, second.occupant!.edgeId);
          }}>
          <ArrowLeftRight size={14} aria-hidden="true" />
        </button>;
      })}
      {named.flatMap(renderNamedSlot)}
      {available.length === 1 ? (() => {
        const { spec, occupied } = available[0]!;
        const isRequiredEmpty = spec.min > 0 && occupied < spec.min;
        const showLabel = references.length > 1 && isRequiredEmpty;
        const label = slotLabel(spec);
        const addLabel = showLabel ? t('panel.slotPick').replace('{slot}', label) : t('panel.slotAddAsset');
        return <button key={spec.slot} type="button"
          className={`wf-slot-well wf-slot-well--append nodrag${showLabel ? ' wf-slot-well--empty' : ''}${isRequiredEmpty ? ' wf-slot-well--required' : ''}`}
          data-testid="wf-add-reference" data-slot={spec.slot} data-slot-role={spec.role}
          aria-label={addLabel} title={addLabel}
          onClick={event => onPickSlot(pickRequest(spec, event.currentTarget))}>
          <Plus size={20} aria-hidden="true" />
          {showLabel ? <span className="wf-slot-well__position">{label}</span> : null}
        </button>;
      })() : (
        <>
          {requiredAvailable.map(({ spec }) => {
            const label = slotLabel(spec);
            const addLabel = t('panel.slotPick').replace('{slot}', label);
            return <button key={spec.slot} type="button"
              className="wf-slot-well wf-slot-well--append wf-slot-well--empty wf-slot-well--required nodrag"
              data-testid="wf-add-reference" data-slot={spec.slot} data-slot-role={spec.role}
              aria-label={addLabel} title={addLabel}
              onClick={event => onPickSlot(pickRequest(spec, event.currentTarget))}>
              <Plus size={20} aria-hidden="true" />
              <span className="wf-slot-well__position">{label}</span>
            </button>;
          })}
          {optionalAvailable.length > 0 ? (() => {
            const typeRemaining = new Map<string, number>();
            for (const { spec } of available) {
              if (!typeRemaining.has(spec.type)) {
                typeRemaining.set(spec.type, remainingTypeCapacity(layout, spec.type, occupiedByType.get(spec.type) ?? 0));
              }
            }
            const maximum = totalSlotGroupCapacity(available, typeRemaining);
            const addLabel = t('panel.slotAddAsset');
            return <button key="wf-add-reference:unified" type="button"
              className="wf-slot-well wf-slot-well--append nodrag"
              data-testid="wf-add-reference" data-slot-role="reference"
              aria-label={addLabel} title={addLabel}
              onClick={event => onPickSlot({
                operationId: layout.operationId,
                referenceSlots: available.map(({ spec }) => spec.slot),
                acceptedTypes: [...new Set(available.map(({ spec }) => spec.type))],
                max: Number.isFinite(maximum) ? maximum : null,
                openerAnchor: event.currentTarget,
              })}>
              <Plus size={20} aria-hidden="true" />
            </button>;
          })() : null}
        </>
      )}
    </div>
  );
};

export default memo(SlotWells);
