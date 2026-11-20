/**
 * Operation display names — the canvas-side resolver for Catalog operation ids (Issue #4103).
 *
 * 目录按网关 modeKind 提供视频模式文案。缺少文案的旧目录使用已审校目录
 * （`plugins/omnimux/src/catalog/contract/operation-registry.json`）的中英名称，
 * 未收录的操作回落到操作 ID。
 *
 * 为什么本仓有一份镜像而不是直接 import 那份 JSON：
 * - 画布是浏览器岛（`lib/canvas.js`），构建产物里没有 Node 文件系统，运行期读不到
 *   `plugins/omnimux` 下的契约文件；两个插件也是各自独立的 npm 包，不得跨包取源码。
 * - 所以本文件是 registry 的**运行期镜像**，并由
 *   `tests/operation-labels-parity.test.mjs` 逐条比对 id/中文/英文 —— 只改一边会立刻变红，
 *   镜像因此不可能悄悄漂移。
 *
 * 展示层只经过 `resolveOperationLabel`：`SegmentControls`（生成方式分段/胶囊）与
 * `summaryFormatter`（底栏摘要）共用它，禁止各自再写一份字典。
 */

export type OperationLabelLocale = 'zh' | 'en';

/** operation id → 中英已审校名；与 operation-registry.json 一一对应。 */
export const OPERATION_LABELS: Readonly<Record<string, { zh: string; en: string }>> = Object.freeze({
  chat: { zh: '纯文本对话', en: 'Text chat' },
  vision_chat: { zh: '图文多模态对话', en: 'Multimodal chat' },
  document_analyze: { zh: '文档解析', en: 'Document analysis' },
  text_to_image: { zh: '文生图', en: 'Text to image' },
  image_to_image: { zh: '图生图', en: 'Image to image' },
  multi_reference: { zh: '多图主体参考', en: 'Multi-image reference' },
  inpaint_outpaint: { zh: '局部重绘', en: 'Inpainting' },
  text_to_video: { zh: '文生视频', en: 'Text to video' },
  first_frame: { zh: '首帧驱动', en: 'First-frame driven' },
  first_last_frame: { zh: '首尾帧过渡', en: 'First-last frame transition' },
  end_frame: { zh: '尾帧参考', en: 'Last-frame reference' },
  video_multi_ref: { zh: '全能参考', en: 'All-reference video' },
  digital_human: { zh: '数字人/对口型', en: 'Digital human / lip sync' },
  video_edit: { zh: '视频编辑/重绘', en: 'Video edit / repaint' },
  video_extend: { zh: '视频延长', en: 'Video extension' },
  document_to_video: { zh: '文档参考', en: 'Document to video' },
  webpage_to_video: { zh: '网页参考', en: 'Webpage to video' },
  text_to_speech: { zh: '语音合成', en: 'Text to speech' },
  voice_clone: { zh: '声音克隆', en: 'Voice clone' },
  text_to_music: { zh: '音乐创作', en: 'Music generation' },
  speech_to_text: { zh: '语音转文字', en: 'Speech to text' },
  webpage_read: { zh: '网页读取', en: 'Webpage read' },
});

/** 解析入参：只需要 id；目录给的 label 作为「更具体」的候选优先。 */
export interface OperationLabelSource {
  id?: string | null;
  label?: string | null;
  labelEn?: string | null;
}

/**
 * 使用当前语言的目录文案，旧目录缺少文案时按已审校目录回退到操作 ID。
 */
export function resolveOperationLabel(
  input: OperationLabelSource | string | null | undefined,
  locale: OperationLabelLocale = 'zh',
): string {
  const source: OperationLabelSource = typeof input === 'string' ? { id: input } : (input ?? {});
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  if (locale === 'en' && typeof source.labelEn === 'string') {
    const labelEn = source.labelEn.trim();
    if (labelEn && labelEn !== id) return labelEn;
  }
  const label = typeof source.label === 'string' ? source.label.trim() : '';
  const entry = id ? OPERATION_LABELS[id] : undefined;
  if (label && label !== id) {
    // 目录镜像可能已经把 catalog label 解析成中文（`matchToOption` 的默认 locale），
    // 切到 en 时同一句文案必须跟着走英文，否则英文界面会混进中文名字。
    if (entry && locale === 'en' && label === entry.zh && entry.en) return entry.en.trim();
    return label;
  }
  if (entry) {
    const localized = locale === 'en' ? entry.en : entry.zh;
    if (localized && localized.trim()) return localized.trim();
    if (entry.zh && entry.zh.trim()) return entry.zh.trim();
  }
  return id;
}
