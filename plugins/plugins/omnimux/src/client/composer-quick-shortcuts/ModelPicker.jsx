import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  getBrandMonogram,
  isValidBrandId,
  resolveBrandVisual,
  resolveModelBrand,
  sanitizeBrandIconPath,
} from 'dsh-ui-kit/model-brands';

export { resolveModelBrand };

function renderSvgElement(el, idx) {
  const { tag, attrs, text } = el;
  if (tag === 'path') return <path key={idx} {...attrs} />;
  if (tag === 'rect') return <rect key={idx} {...attrs} />;
  if (tag === 'circle') return <circle key={idx} {...attrs} />;
  if (tag === 'text') return <text key={idx} {...attrs}>{text}</text>;
  return null;
}

/**
 * 统一发布会话模型持久化状态与全局事件
 */
export function publishSessionModel({ sessionId, auto, model }) {
  if (!sessionId) return;
  const modelPayload = auto ? null : model;
  try {
    window.sessionStorage.setItem(
      `omnimux:model:${sessionId}`,
      JSON.stringify({
        auto,
        selectedModel: modelPayload,
      })
    );
    window.dispatchEvent(
      new CustomEvent('omnimux:model:changed', {
        detail: { sessionId, auto, selectedModel: modelPayload },
      })
    );
  } catch (err) {
    console.error('[omnimux:model-picker] 存储会话模型失败:', err);
  }

  try {
    fetch('/omnimux/session-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        sessionId,
        auto,
        modelId: modelPayload ? (modelPayload.id || '') : '',
        label: modelPayload ? (modelPayload.name || modelPayload.id || '') : '',
      }),
    }).catch((err) => {
      console.error('[omnimux:model-picker] 持久化会话模型至中枢失败:', err);
    });
  } catch (err) {
    console.error('[omnimux:model-picker] 请求持久化会话模型失败:', err);
  }
}

/** 渲染立体三层层级模型图标 */
export function ModelLayersIcon({ size = 16 }) {
  const px = Number.isFinite(size) && size > 0 ? size : 16;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: `${px}px`, height: `${px}px`, flex: 'none', display: 'block' }}
    >
      <path d="m12 2 10 5-10 5L2 7Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  );
}

/** 渲染 PRO 紫色钻石徽标 */
export function PurpleDiamondIcon({ size = 14 }) {
  const px = Number.isFinite(size) && size > 0 ? size : 14;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="sh-model-diamond"
      style={{ width: `${px}px`, height: `${px}px`, flexShrink: 0, display: 'inline-block' }}
    >
      <polygon points="5.5,2 10.5,2 9.2,5.5 6.8,5.5" fill="currentColor" opacity="0.95" />
      <polygon points="2,5.5 5.5,2 6.8,5.5" fill="currentColor" opacity="0.75" />
      <polygon points="10.5,2 14,5.5 9.2,5.5" fill="currentColor" opacity="0.85" />
      <polygon points="6.8,5.5 9.2,5.5 8,14" fill="currentColor" opacity="0.9" />
      <polygon points="2,5.5 6.8,5.5 8,14" fill="currentColor" opacity="0.6" />
      <polygon points="9.2,5.5 14,5.5 8,14" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

/** 渲染品牌 SVG 图标（四级确定性解析，纯 React SVG 节点，无裸 HTML 注入） */
export function BrandIcon({
  iconOrId,
  modelId,
  brandId,
  brandName,
  brandIconPath,
  family,
  label,
  brands,
  variant = 'mono',
  size = 16,
}) {
  const px = Number.isFinite(size) && size > 0 ? size : 16;
  const effectiveModelId = modelId ?? iconOrId ?? '';
  const visual = resolveBrandVisual({
    brandId,
    brandName,
    brandIconPath,
    modelId: effectiveModelId,
    family: family ?? (brandId ? undefined : iconOrId),
    label,
    brands,
    variant,
  });

  let content;
  if (visual.kind === 'svg') {
    content = (
      <svg
        width={px}
        height={px}
        viewBox={visual.vector.viewBox}
        fill={visual.vector.fill}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {visual.vector.elements.map(renderSvgElement)}
      </svg>
    );
  } else if (visual.kind === 'path') {
    content = (
      <svg
        width={px}
        height={px}
        viewBox={visual.viewBox}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d={visual.path} fill="currentColor" />
      </svg>
    );
  } else {
    const letter = visual.letter || getBrandMonogram({
      brandName,
      label,
      brandId,
      modelId: effectiveModelId,
    });
    content = (
      <span
        className="sh-model-brand-monogram"
        style={{ fontSize: `${Math.max(9, Math.round(px * 0.56))}px` }}
        aria-hidden="true"
      >
        {letter}
      </span>
    );
  }

  return (
    <span
      className="sh-model-brand-icon"
      data-brand-id={visual.brandId || ''}
      data-brand-source={visual.source}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${px}px`,
        height: `${px}px`,
        flexShrink: 0,
      }}
    >
      {content}
    </span>
  );
}

function isPickerEn() {
  try {
    const active = typeof window !== 'undefined'
      ? (window.__omnimuxLocale?.active || window.__omnimuxLocale?.getLocale?.()?.active)
      : '';
    if (typeof active === 'string' && active.trim()) {
      return active.trim().toLowerCase().startsWith('en');
    }
    const docLang = typeof document !== 'undefined' ? document.documentElement?.lang : '';
    if (typeof docLang === 'string' && docLang.trim()) {
      return docLang.trim().toLowerCase().startsWith('en');
    }
    const navLang = typeof navigator !== 'undefined' ? navigator.language : '';
    if (typeof navLang === 'string' && navLang.trim()) {
      return navLang.trim().toLowerCase().startsWith('en');
    }
  } catch {}
  return false;
}

/**
 * 方案 B 浮层面板
 */
function ModelPickerPanel({
  open,
  anchorRef,
  auto,
  selectedModel,
  modelsData,
  catalogLoading,
  catalogError,
  onToggleAuto,
  onSelectModel,
  onClose,
}) {
  const en = isPickerEn();
  const labels = en
    ? {
        title: 'Models',
        auto: 'Auto',
        video: 'Video',
        image: 'Image',
        loading: 'Loading models…',
        empty: 'No models available',
      }
    : {
        title: '模型',
        auto: '自动',
        video: '视频',
        image: '图像',
        loading: '正在加载模型…',
        empty: '当前没有可用模型',
      };
  const panelRef = useRef(null);
  const [tab, setTab] = useState('video');
  const [pos, setPos] = useState({ left: 0, top: 0, width: 480 });

  useEffect(() => {
    if (!open) return;
    const curItems = (modelsData && modelsData[tab]) || [];
    if (curItems.length === 0) {
      const alt = tab === 'video' ? 'image' : 'video';
      if (((modelsData && modelsData[alt]) || []).length > 0) {
        setTab(alt);
      }
    }
  }, [open, modelsData, tab]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = anchorRef && anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return;
      const r = anchor.getBoundingClientRect();
      const width = Math.min(520, Math.max(400, Math.min(480, window.innerWidth - 16)));
      const height = panel ? panel.offsetHeight : 460;
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      if (left < 8) left = 8;
      let top = r.top - height - 8;
      if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - height - 8);
      setPos({ left, top: Math.max(8, top), width });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, tab, anchorRef, modelsData]);

  useEffect(() => {
    if (!open) return undefined;

    // 打开时将焦点移入面板首个可聚焦元素
    const focusTimer = setTimeout(() => {
      if (panelRef.current) {
        const firstFocusable = panelRef.current.querySelector(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (firstFocusable && typeof firstFocusable.focus === 'function') {
          firstFocusable.focus();
        } else if (typeof panelRef.current.focus === 'function') {
          panelRef.current.focus();
        }
      }
    }, 0);

    const restoreFocus = () => {
      if (anchorRef && anchorRef.current && typeof anchorRef.current.focus === 'function') {
        anchorRef.current.focus();
      }
    };

    const onDoc = (e) => {
      const tEl = e.target;
      if (panelRef.current && panelRef.current.contains(tEl)) return;
      if (anchorRef && anchorRef.current && anchorRef.current.contains(tEl)) return;
      onClose();
      restoreFocus();
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        restoreFocus();
        return;
      }

      // Tab / Shift+Tab 循环聚焦守卫 (Focus Trap)
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => {
          const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          return !style || (style.display !== 'none' && style.visibility !== 'hidden');
        });

        if (focusables.length > 0) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey) {
            if (document.activeElement === first || !panelRef.current.contains(document.activeElement)) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last || !panelRef.current.contains(document.activeElement)) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      }
    };

    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const items = (modelsData && modelsData[tab]) || [];

  const node = (
    <div
      ref={panelRef}
      className="sh-model-picker"
      role="dialog"
      aria-label={labels.title}
      aria-modal="true"
      tabIndex={-1}
      style={{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${pos.width}px` }}
    >
      <div className="sh-model-picker-header">
        <div className="sh-model-picker-title">{labels.title}</div>
        <div className="sh-model-auto-row">
          <span className="sh-model-auto-label">{labels.auto}</span>
          <button // exempt-ui01: 模型选择器顶部自动决策切换开关
            type="button"
            role="switch"
            aria-label={labels.auto}
            aria-checked={auto ? 'true' : 'false'}
            className={`sh-model-switch${auto ? ' on' : ''}`}
            onClick={() => onToggleAuto(!auto)}
          >
            <span className="sh-model-switch-thumb" />
          </button>
        </div>
      </div>

      <div className="sh-model-tabs" role="tablist">
        <button // exempt-ui01: 模态切换 Tab 视频
          type="button"
          role="tab"
          className={`sh-model-tab${tab === 'video' ? ' active' : ''}`}
          aria-selected={tab === 'video'}
          onClick={() => setTab('video')}
        >
          {labels.video}
        </button>
        <button // exempt-ui01: 模态切换 Tab 图像
          type="button"
          role="tab"
          className={`sh-model-tab${tab === 'image' ? ' active' : ''}`}
          aria-selected={tab === 'image'}
          onClick={() => setTab('image')}
        >
          {labels.image}
        </button>
      </div>

      <div className="sh-model-list" role="listbox">
        {items.length ? (
          items.map((model, idx) => {
            const isSelected = !auto && selectedModel && selectedModel.id === model.id;
            const handleRowKeyDown = (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectModel(model);
                return;
              }
              const list = e.currentTarget.parentElement;
              const rows = list ? Array.from(list.querySelectorAll('.sh-model-row')) : [];
              if (!rows.length) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                rows[(idx + 1) % rows.length]?.focus();
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                rows[(idx - 1 + rows.length) % rows.length]?.focus();
              } else if (e.key === 'Home') {
                e.preventDefault();
                rows[0]?.focus();
              } else if (e.key === 'End') {
                e.preventDefault();
                rows[rows.length - 1]?.focus();
              }
            };
            return (
              <div
                key={model.id}
                className={`sh-model-row${isSelected ? ' selected' : ''}`}
                role="option"
                tabIndex={0}
                aria-selected={isSelected ? 'true' : 'false'}
                onClick={() => onSelectModel(model)}
                onKeyDown={handleRowKeyDown}
              >
                <div className="sh-model-row-left">
                  <div className="sh-model-icon-box">
                    <BrandIcon
                      modelId={model.id}
                      brandId={model.brandId}
                      brandName={model.brandName}
                      brandIconPath={model.brandIconPath}
                      family={model.family}
                      label={model.name}
                      brands={modelsData?.brands}
                      iconOrId={model.icon}
                      size={20}
                    />
                  </div>
                  <div className="sh-model-row-info">
                    <div className="sh-model-row-title-row">
                      <span className="sh-model-name">{model.name}</span>
                      {model.pro ? <PurpleDiamondIcon size={14} /> : null}
                      {model.badge ? (
                        <span className={`sh-model-badge ${model.badge.type || 'purple'}`}>
                          {model.badge.text}
                        </span>
                      ) : null}
                    </div>
                    <div className="sh-model-row-desc">{model.subtitle}</div>
                    {model.priceLabel ? (
                      <div className="sh-model-row-price" data-omnimux-model-price={model.priceLabel}>
                        {model.priceLabel}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="sh-model-row-right">
                  <div className={`sh-model-radio${isSelected ? ' checked' : ''}`}>
                    {isSelected ? <span className="sh-model-radio-dot" /> : null}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="sh-model-empty" role="status">
            {catalogLoading ? labels.loading : (catalogError || labels.empty)}
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined' || !document.body) return node;
  return createPortal(node, document.body);
}

/**
 * 方案 B 经典会话模型选择器（挂在输入框快捷方式底栏）
 */
export function ModelPicker({ sessionId }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);

  // 广播并协同处理全局浮层打开互斥事件
  useEffect(() => {
    if (!open) return;
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('omnimux:composer:overlay:open', {
        detail: { id: 'model-picker' },
      }));
    }
    const onOverlayOpen = (e) => {
      if (e?.detail?.id !== 'model-picker') {
        setOpen(false);
      }
    };
    window.addEventListener('omnimux:composer:overlay:open', onOverlayOpen);
    return () => {
      window.removeEventListener('omnimux:composer:overlay:open', onOverlayOpen);
    };
  }, [open]);

  const [auto, setAuto] = useState(() => {
    try {
      const raw = window.sessionStorage.getItem(`omnimux:model:${sessionId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.auto === 'boolean') return parsed.auto;
      }
    } catch (err) {
      console.error('[omnimux:model-picker] 读取会话自动推荐状态失败:', err);
    }
    return true;
  });

  const [selectedModel, setSelectedModel] = useState(() => {
    try {
      const raw = window.sessionStorage.getItem(`omnimux:model:${sessionId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed.selectedModel || null;
      }
    } catch (err) {
      console.error('[omnimux:model-picker] 读取会话选中模型失败:', err);
    }
    return null;
  });

  const [modelsData, setModelsData] = useState({ video: [], image: [], brands: {} });
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');

  // 从中枢加载模型列表
  useEffect(() => {
    let live = true;
    const fetchCatalog = async () => {
      try {
        const res = await fetch('/omnimux/model-catalog');
        if (!res.ok) {
          console.error('[omnimux:model-picker] 加载模型目录网络错误:', res.status, res.statusText);
          setCatalogError(isPickerEn() ? `Failed to load models (${res.status})` : `模型目录加载失败（${res.status}）`);
          setCatalogLoading(false);
          return;
        }
        const payload = await res.json();
        if (!live || !payload) return;
        const root = payload.catalog || payload;
        const brandsMap = root.brands && typeof root.brands === 'object' && !Array.isArray(root.brands)
          ? root.brands
          : {};
        const video = [];
        const image = [];
        const seenIds = new Set();

        const processRow = (row) => {
          if (!row || typeof row !== 'object') return null;
          if (typeof row.id !== 'string') return null;
          const rawId = row.id.trim();
          if (!rawId || seenIds.has(rawId)) return null;
          seenIds.add(rawId);

          const name = typeof row.label === 'string' && row.label.trim()
            ? row.label.trim()
            : (typeof row.name === 'string' && row.name.trim() ? row.name.trim() : rawId);
          const capsuleName = name;
          const rawBrandId = row.brandId !== undefined ? row.brandId : row.brand_id;
          const brandId = isValidBrandId(rawBrandId) ? rawBrandId : undefined;
          const brandName = typeof row.brandName === 'string' && row.brandName.trim()
            ? row.brandName.trim()
            : (typeof row.brand_name === 'string' && row.brand_name.trim() ? row.brand_name.trim() : undefined);
          const rawBrandIconPath = row.brandIconPath !== undefined ? row.brandIconPath : row.brand_icon_path;
          const brandIconPath = sanitizeBrandIconPath(rawBrandIconPath) ?? undefined;
          const family = typeof row.family === 'string' && row.family.trim() ? row.family.trim() : undefined;
          return {
            id: rawId,
            name,
            capsuleName,
            subtitle: '',
            pro: typeof row.pro === 'boolean' ? row.pro : false,
            badge: typeof row.badge === 'string'
              ? { text: row.badge, type: 'purple' }
              : (row.badge && typeof row.badge === 'object' ? row.badge : undefined),
            ...(brandId ? { brandId } : {}),
            ...(brandName ? { brandName } : {}),
            ...(brandIconPath ? { brandIconPath } : {}),
            ...(family ? { family } : {}),
            icon: brandId || (typeof row.icon === 'string' && row.icon.trim()) || resolveModelBrand(rawId) || '',
            priceLabel: typeof row.priceLabel === 'string' ? row.priceLabel : '',
          };
        };

        if (Array.isArray(root.video) && root.video.length > 0) {
          for (const row of root.video) {
            const item = processRow(row);
            if (item) video.push(item);
          }
        }
        if (Array.isArray(root.image) && root.image.length > 0) {
          for (const row of root.image) {
            const item = processRow(row);
            if (item) image.push(item);
          }
        }

        if (video.length > 0 || image.length > 0) {
          const nextVideo = video;
          const nextImage = image;
          setModelsData({
            video: nextVideo,
            image: nextImage,
            brands: brandsMap,
          });
          setCatalogError('');
          setCatalogLoading(false);

          // 如果已锁定的模型不再位于刷新后的 Catalog 中，自动重置为自动推荐模式；否则同步最新品牌元数据
          setSelectedModel((currentSelected) => {
            if (!currentSelected || !currentSelected.id) return null;
            const allAvailable = [...nextVideo, ...nextImage];
            const fresh = allAvailable.find((m) => m.id === currentSelected.id);
            if (!fresh) {
              console.warn(`[omnimux:model-picker] 锁定的模型 ${currentSelected.id} 已下架，重置为自动推荐`);
              setAuto(true);
              publishSessionModel({
                sessionId,
                auto: true,
                model: null,
              });
              return null;
            }
            return {
              ...currentSelected,
              name: fresh.name,
              capsuleName: fresh.capsuleName,
              brandId: fresh.brandId,
              brandName: fresh.brandName,
              brandIconPath: fresh.brandIconPath,
              family: fresh.family,
              icon: fresh.icon,
            };
          });
        } else {
          setCatalogError(isPickerEn() ? 'No models available' : '当前没有可用模型');
          setCatalogLoading(false);
        }
      } catch (err) {
        console.error('[omnimux:model-picker] 加载或解析模型目录异常:', err);
        setCatalogError(isPickerEn() ? 'Failed to load models' : '模型目录加载失败');
        setCatalogLoading(false);
      }
    };

    fetchCatalog();
    const onUpdated = () => fetchCatalog();
    window.addEventListener('omnimux:model-catalog-updated', onUpdated);
    return () => {
      live = false;
      window.removeEventListener('omnimux:model-catalog-updated', onUpdated);
    };
  }, [sessionId]);

  // 监听外部模型选择变化
  useEffect(() => {
    const onModelChanged = (e) => {
      const detail = e?.detail;
      if (!detail || detail.sessionId !== sessionId) return;
      if (typeof detail.auto === 'boolean') {
        setAuto(detail.auto);
        setSelectedModel(detail.auto ? null : (detail.selectedModel || null));
      }
    };
    window.addEventListener('omnimux:model:changed', onModelChanged);
    return () => {
      window.removeEventListener('omnimux:model:changed', onModelChanged);
    };
  }, [sessionId]);

  // 切换自动开关（关闭自动且暂无显式选择时自动命中首个可用模型，防止状态自相矛盾）
  const handleToggleAuto = useCallback((nextAuto) => {
    setAuto(nextAuto);
    let nextModel = nextAuto ? null : selectedModel;
    if (nextAuto) {
      setSelectedModel(null);
    } else if (!nextModel) {
      nextModel = modelsData?.video?.[0] || modelsData?.image?.[0] || null;
      if (nextModel) {
        setSelectedModel(nextModel);
      }
    }
    publishSessionModel({
      sessionId,
      auto: nextAuto,
      model: nextModel,
    });
  }, [sessionId, selectedModel, modelsData]);

  // 选中或再次点击已选模型切换回自动
  const handleSelectModel = useCallback((model) => {
    if (!auto && selectedModel && selectedModel.id === model.id) {
      handleToggleAuto(true);
      setOpen(false);
      btnRef.current?.focus?.();
      return;
    }
    setAuto(false);
    setSelectedModel(model);
    publishSessionModel({
      sessionId,
      auto: false,
      model,
    });
    setOpen(false);
    if (btnRef.current && typeof btnRef.current.focus === 'function') {
      btnRef.current.focus();
    }
  }, [sessionId, auto, selectedModel, handleToggleAuto]);

  const en = isPickerEn();
  const isModelChosen = !auto && Boolean(selectedModel);

  return (
    <div className="sh-model-picker-wrap">
      {isModelChosen ? (
        <div className="sh-model-capsule-group">
          <button // exempt-ui01: 选中模型时显示的品牌图标与模型名称胶囊
            ref={btnRef}
            type="button"
            className={`sh-model-capsule-btn${open ? ' on' : ''}`}
            aria-label={selectedModel.name}
            title={selectedModel.name}
            aria-haspopup="dialog"
            aria-expanded={open ? 'true' : 'false'}
            data-omnimux-model-capsule=""
            onClick={() => setOpen((v) => !v)}
          >
            <BrandIcon
              modelId={selectedModel.id}
              brandId={selectedModel.brandId}
              brandName={selectedModel.brandName}
              brandIconPath={selectedModel.brandIconPath}
              family={selectedModel.family}
              label={selectedModel.name}
              brands={modelsData?.brands}
              iconOrId={selectedModel.icon}
              size={14}
            />
            <span className="sh-model-capsule-name">
              {selectedModel.capsuleName || selectedModel.name}
            </span>
          </button>
          <button // exempt-ui01: 胶囊清除按钮一键恢复自动推荐
            type="button"
            className="sh-model-capsule-clear"
            aria-label={en ? 'Reset to Auto' : '恢复自动模型'}
            title={en ? 'Reset to Auto' : '恢复自动模型'}
            onClick={() => handleToggleAuto(true)}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" />
            </svg>
          </button>
        </div>
      ) : (
        <button // exempt-ui01: 自动推荐时显示的立体层级模型触发按钮
          ref={btnRef}
          type="button"
          className={`sh-picker-trigger sh-model-picker-trigger${open ? ' on' : ''}`}
          aria-label={en ? 'Model' : '模型'}
          title={en ? 'Model' : '模型'}
          aria-haspopup="dialog"
          aria-expanded={open ? 'true' : 'false'}
          data-omnimux-model-picker=""
          onClick={() => setOpen((v) => !v)}
        >
          <ModelLayersIcon size={16} />
          <span className="sh-picker-trigger-label">{en ? 'Model' : '模型'}</span>
        </button>
      )}

      <ModelPickerPanel
        open={open}
        anchorRef={btnRef}
        auto={auto}
        selectedModel={selectedModel}
        modelsData={modelsData}
        catalogLoading={catalogLoading}
        catalogError={catalogError}
        onToggleAuto={handleToggleAuto}
        onSelectModel={handleSelectModel}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

export default ModelPicker;
