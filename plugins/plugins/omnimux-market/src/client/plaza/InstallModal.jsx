import React from 'react';

function getH(props) {
  if (props && props.h) return props.h;
  if (typeof h === 'function') return h;
  return React.createElement;
}

function t(trLookup, key, fallback) {
  if (typeof trLookup === 'function') {
    const val = trLookup(key);
    if (val && val !== key) return val;
  }
  return fallback;
}

function isEnLocale(trLookup) {
  return typeof trLookup === 'function' && trLookup('locale') === 'en';
}

function renderCloseButton(onClose, trLookup, h, disabled) {
  const closeLabel = t(trLookup, 'action.close', isEnLocale(trLookup) ? 'Close' : '关闭');
  // exempt-ui01 modal close icon button
  return h('button', {
    type: 'button',
    className: 'omnimux-modal-close-btn is-external ws-detail-external-close',
    'aria-label': closeLabel,
    title: closeLabel,
    disabled: Boolean(disabled),
    onClick: () => { if (!disabled && onClose) onClose(); },
  },
    h('svg', {
      width: '14',
      height: '14',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '2.2',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
      h('line', { x1: '18', y1: '6', x2: '6', y2: '18' }),
      h('line', { x1: '6', y1: '6', x2: '18', y2: '18' }),
    ),
  );
}

function renderModalHeader(trLookup, h) {
  const fallback = isEnLocale(trLookup) ? 'Install by Slug' : '按标识安装 Skill';
  const title = t(trLookup, 'workshop.installModalTitle', fallback);
  return h('div', { className: 'modal-header' },
    h('h3', { className: 'modal-title' }, title),
  );
}

export function parseSkillSlugInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (/\.(zip|md)$/i.test(text)) return { ok: false, reason: 'local-file-unsupported' };
  const urlMatch = text.match(/^https?:\/\/[^/]+\/(?:skills\/)?([^/?#]+)/i);
  let candidate = text;
  if (urlMatch) {
    try {
      candidate = decodeURIComponent(urlMatch[1]);
    } catch {
      return { ok: false, reason: 'invalid-slug' };
    }
  }
  candidate = candidate.replace(/^\/+/, '').trim();
  if (/\.(zip|md)$/i.test(candidate)) return { ok: false, reason: 'local-file-unsupported' };
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(candidate)) {
    return { ok: false, reason: 'invalid-slug' };
  }
  return { ok: true, slug: candidate };
}

function renderSlugInputSection(opts, h) {
  const { slugInput, inputRef, uploading, onInputChange, onKeyDown, trLookup } = opts;
  const en = isEnLocale(trLookup);
  const placeholder = t(trLookup, 'workshop.installSlugPlaceholder', en ? 'Enter skill slug or catalog link (e.g. my-skill)' : '输入 Skill 标识或详情链接（如 video-hook-analysis）');
  const label = t(trLookup, 'workshop.installSlugLabel', en ? 'Skill identifier or link' : 'Skill 标识或详情链接');
  return h('div', { className: 'omx-install-slug-box', style: { marginBottom: '14px' } },
    h('input', {
      ref: inputRef,
      type: 'text',
      value: slugInput,
      disabled: uploading,
      placeholder,
      'aria-label': label,
      onChange: onInputChange,
      onKeyDown,
      style: {
        width: '100%',
        boxSizing: 'border-box',
        height: '38px',
        padding: '0 12px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
      },
    }),
  );
}

function renderReqSection(trLookup, h) {
  const en = isEnLocale(trLookup);
  const reqTitle = t(trLookup, 'workshop.reqTitle', en ? 'How it works' : '安装说明');
  const reqSlug = t(trLookup, 'workshop.reqSlug', en ? 'Enter a SkillHub slug or skill detail URL' : '填写社区 Skill 标识或完整链接即可拉取安装');
  const reqCreator = t(trLookup, 'workshop.reqCreator', en ? 'Need a local custom skill? Use /skill-creator in chat' : '如需新建自定义技能，可在对话中运行 /skill-creator');
  return h('div', { className: 'req-section' },
    h('h4', { className: 'req-title' }, reqTitle),
    h('ul', { className: 'req-list' },
      h('li', { className: 'req-item' }, reqSlug),
      h('li', { className: 'req-item' }, reqCreator),
    ),
  );
}

async function executeSkillInstall(slug, onInstalled, onClose, apiFn) {
  const callApi = apiFn || (typeof api === 'function' ? api : null);
  if (callApi) {
    await callApi('install', { slug });
  }
  if (onInstalled) {
    onInstalled({ name: slug, slug, installed: true, enabled: true });
  }
  if (onClose) onClose();
}

function resolveStateHook(hooks) {
  if (hooks && typeof hooks.useState === 'function') return hooks.useState;
  if (typeof useState === 'function') return useState;
  return React.useState;
}

function resolveRefHook(hooks) {
  if (hooks && typeof hooks.useRef === 'function') return hooks.useRef;
  if (typeof useRef === 'function') return useRef;
  return React.useRef;
}

function resolveOverlayComp(props) {
  if (props && props.Overlay) return props.Overlay;
  if (typeof Overlay !== 'undefined') return Overlay;
  return 'div';
}

function resolveTrLookup(safeProps) {
  if (safeProps && typeof safeProps.tr === 'function') return safeProps.tr;
  if (typeof useTr === 'function') return useTr();
  if (typeof lookup === 'function') return lookup;
  return (k) => k;
}

function resolveApi(apiProp) {
  if (apiProp) return apiProp;
  if (typeof api === 'function') return api;
  return null;
}

export function InstallModal(props) {
  const safeProps = props || {};
  const { open, onClose, onInstalled, hooks, api: apiProp } = safeProps;
  const stateFn = resolveStateHook(hooks);
  const refFn = resolveRefHook(hooks);
  const h = getH(props);

  // Preserve hook count/order for test compatibility: ['state', 'state', 'state', 'ref'].
  const [slugInput, setSlugInput] = stateFn('');
  const [uploading, setUploading] = stateFn(false);
  const [error, setError] = stateFn('');
  const inputRef = refFn(null);

  if (!open) return null;

  const trLookup = resolveTrLookup(safeProps);
  const en = isEnLocale(trLookup);
  const apiFn = resolveApi(apiProp);

  const safeClose = () => {
    if (uploading) return;
    setSlugInput('');
    setError('');
    if (onClose) onClose();
  };

  const handleInstall = async () => {
    if (uploading) return;
    const rawValue = typeof slugInput === 'string'
      ? slugInput
      : (slugInput && typeof slugInput.name === 'string' ? slugInput.name : '');
    const parsed = parseSkillSlugInput(rawValue);
    if (!parsed.ok) {
      if (parsed.reason === 'local-file-unsupported') {
        setError(t(trLookup, 'workshop.localFileUnsupported', en
          ? 'Local .zip or .md upload is not supported. Use /skill-creator in chat to build a local skill.'
          : '暂不支持本地上传 .zip 或 .md 文件安装；如需自定义本地技能，请在对话中运行 /skill-creator。'));
      } else {
        setError(t(trLookup, 'workshop.invalidSlug', en
          ? 'Enter a valid skill slug (letters, numbers, hyphens, dots, or underscores).'
          : '请输入有效的 Skill 标识或完整详情链接。'));
      }
      return;
    }
    setUploading(true);
    setError('');
    try {
      await executeSkillInstall(parsed.slug, onInstalled, () => {
        setSlugInput('');
        setError('');
        if (onClose) onClose();
      }, apiFn);
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const actionText = t(trLookup, 'workshop.installAction', en ? 'Install' : '安装');
  const submitLabel = uploading ? t(trLookup, 'workshop.installingShort', en ? 'Installing…' : '正在安装…') : actionText;
  const hasValue = Boolean(typeof slugInput === 'string' ? slugInput.trim() : slugInput?.name);
  const overlayComp = resolveOverlayComp(props);

  return h(overlayComp, { onClose: safeClose },
    h('div', { className: 'ws-detail-wrapper', onClick: (e) => e.stopPropagation() },
      renderCloseButton(safeClose, trLookup, h, uploading),
      h('div', { className: 'modal-dialog', role: 'dialog', 'aria-modal': 'true' },
        renderModalHeader(trLookup, h),
        renderSlugInputSection({
          slugInput: typeof slugInput === 'string' ? slugInput : (slugInput?.name || ''),
          inputRef,
          uploading,
          onInputChange: (e) => {
            setSlugInput(e.target.value);
            if (error) setError('');
          },
          onKeyDown: (e) => {
            if (e.key === 'Enter' && hasValue && !uploading) {
              e.preventDefault();
              void handleInstall();
            }
          },
          trLookup,
        }, h),
        renderReqSection(trLookup, h),
        error ? h('p', { className: 'sh-err', role: 'alert' }, error) : null,
        // exempt-ui01 modal submit action button
        h('button', {
          type: 'button',
          className: 'btn-modal-install' + (hasValue ? ' ready' : ''),
          disabled: !hasValue || uploading,
          onClick: handleInstall,
        }, submitLabel),
      ),
    ),
  );
}
