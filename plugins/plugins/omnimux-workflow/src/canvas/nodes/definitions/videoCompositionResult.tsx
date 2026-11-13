/**
 * VideoCompositionResult — 视频合成节点产物态（result 分支）纯展示组件（T3）。
 *
 * Props 驱动，无任何节点/存储依赖：
 * - 预览区：内联播放视频（isPlayingInline 切换）/ 缩略图 + 播放 Chip / 图标兜底；
 * - Meta 胶囊：时长与分辨率（Mono 等宽数字）；
 * - 操作按钮行：重新编辑（Primary）/ 下载（Secondary，无产物时禁用）。
 *
 * 样式 100% 消费 DSH 原生 --dsw-alias-* Token（.wf-vc-result* 见
 * canvas/theme/components.css），32px 控件高 / 8px 圆角，0 裸色、0 内联 style。
 */

import { memo, useCallback, useState } from 'react';
import { Download, Film, Pencil, Play } from 'lucide-react';
import { useT } from '../../i18n';
import { formatDuration, formatResolution } from './videoCompositionStatus';

export interface VideoCompositionResultProps {
  /** 合成视频地址（内联播放与下载启用） */
  outputVideoUrl?: string;
  /** 缩略图地址（无视频内联播放时的封面） */
  thumbnailUrl?: string;
  /** 成片时长（毫秒） */
  durationMs?: number;
  /** 成片宽度 */
  width?: number;
  /** 成片高度 */
  height?: number;
  /** 节点标题（缩略图 alt） */
  title?: string;
  /** 重新编辑回调（接 openEditor） */
  onReEdit?: () => void;
  /** 下载回调（接父节点处理器） */
  onDownload?: () => void;
}

const VideoCompositionResult: React.FC<VideoCompositionResultProps> = ({
  outputVideoUrl,
  thumbnailUrl,
  durationMs,
  width,
  height,
  title = '',
  onReEdit,
  onDownload,
}) => {
  const t = useT();
  const [isPlayingInline, setIsPlayingInline] = useState(false);

  const toggleInlinePlay = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setIsPlayingInline((playing) => !playing);
  }, []);

  const endInlinePlay = useCallback(() => {
    setIsPlayingInline(false);
  }, []);

  // 内联播放 → <video controls>（交互内容不能嵌进 <button>，换普通容器）。
  // 点按容器回到缩略图态（与旧节点"点按切换"一致）；播完自动收起。
  const preview = isPlayingInline && outputVideoUrl ? (
    <div className="wf-vc-result__preview nodrag nopan" onClick={toggleInlinePlay}>
      <video
        src={outputVideoUrl}
        controls
        autoPlay
        className="wf-vc-result__video"
        title={title}
        onEnded={endInlinePlay}
      />
    </div>
  ) : (
    <button
      type="button"
      className="wf-vc-result__preview nodrag nopan"
      onClick={toggleInlinePlay}
      aria-label={t('clip.openEditorTitle')}
    >
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt={title} className="wf-vc-result__thumb" />
      ) : (
        <span className="wf-vc-result__fallback">
          <Film size={36} strokeWidth={1.5} />
        </span>
      )}
      <span className="wf-vc-result__play">
        <span className="wf-vc-result__play-chip">
          <Play size={22} fill="currentColor" />
        </span>
      </span>
    </button>
  );

  return (
    <div className="wf-vc-result">
      {preview}

      <dl className="wf-vc-result__meta">
        <div className="wf-vc-result__meta-item">
          <dt>{t('clip.duration')}</dt>
          <dd className="wf-vc-result__mono">{formatDuration(durationMs)}</dd>
        </div>
        <div className="wf-vc-result__meta-item">
          <dt>{t('clip.resolution')}</dt>
          <dd className="wf-vc-result__mono">{formatResolution(width, height)}</dd>
        </div>
      </dl>

      <div className="wf-vc-result__actions nodrag nopan">
        <button
          type="button"
          className="wf-vc-result__btn wf-vc-result__btn--primary"
          onClick={(event) => {
            event.stopPropagation();
            onReEdit?.();
          }}
        >
          <Pencil size={14} />
          <span>{t('clip.reEdit')}</span>
        </button>
        <button
          type="button"
          className="wf-vc-result__btn"
          onClick={(event) => {
            event.stopPropagation();
            onDownload?.();
          }}
          disabled={!outputVideoUrl}
          title={outputVideoUrl ? t('clip.downloadTitle') : undefined}
        >
          <Download size={14} />
          <span>{t('clip.download')}</span>
        </button>
      </div>
    </div>
  );
};

export default memo(VideoCompositionResult);