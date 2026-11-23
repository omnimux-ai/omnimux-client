import React from 'react';
import {
  EXPERT_STATUS_CONFIG,
  getExpertButtonText,
  getExpertLocalizedNames,
  getExpertStageLabel,
  getExpertStatusText,
  resolveExpertAvatar,
  resolveIconSrc,
  resolveInitials,
} from './plazaUtils.js';

const h = React.createElement;

function getIconSrc(avatar) {
  return resolveIconSrc(avatar);
}

function getInitials(name) {
  return resolveInitials(name);
}

export function renderExpertCard(item, opts) {
  const { tr, isEn, expertMarketToggling, onToggle } = opts;
  const { title, desc } = getExpertLocalizedNames(item, isEn);
  const conf = EXPERT_STATUS_CONFIG[item.status] || EXPERT_STATUS_CONFIG.available;
  const statusText = getExpertStatusText(conf, tr, isEn);
  const btnText = getExpertButtonText(conf, tr, isEn);
  const isToggling = expertMarketToggling === item.id;
  const stageLabel = (item.stage === 'research' || item.stage === 'production' || item.stage === 'growth')
    ? getExpertStageLabel(item.stage, tr, isEn)
    : '';
  const isEnabled = item.status === 'enabled';
  const actionClass = 'expert-card-action' + (isEnabled ? ' is-enabled' : ' is-visible');
  const btnClass = 'expert-pill-btn' + (isEnabled ? ' secondary' : '');

  const onAvatarErr = (e) => {
    const fallbackSrc = resolveExpertAvatar(item);
    if (e.currentTarget.src !== fallbackSrc) {
      e.currentTarget.src = fallbackSrc;
      return;
    }
    e.currentTarget.style.display = 'none';
    const n = e.currentTarget.nextElementSibling;
    if (n) n.style.display = 'grid';
  };
  const onBtnClick = (e) => {
    e.stopPropagation();
    onToggle(item);
  };

  const avatarSrc = resolveExpertAvatar(item);

  return h('div', { key: item.id, className: 'expert-card', 'data-expert-id': item.id, 'data-expert-status': item.status || 'available' },
    h('div', { className: 'expert-card-avatar-wrap' },
      h('img', { className: 'expert-card-avatar', src: avatarSrc, alt: title, loading: 'lazy', onError: onAvatarErr }),
      h('div', { className: 'expert-card-avatar-fallback', style: { display: 'none' } }, getInitials(title)),
    ),
    conf.btnKey ? h('div', { className: actionClass },
      // exempt-ui01 expert pill action button
      h('button', { type: 'button', className: btnClass, disabled: isToggling, onClick: onBtnClick }, isToggling ? '...' : btnText),
    ) : null,
    h('div', { className: 'expert-card-status ' + (item.status || '') },
      statusText,
      stageLabel ? h('span', { className: 'expert-card-stage' }, stageLabel) : null,
    ),
    h('div', { className: 'expert-card-title' }, title),
    h('p', { className: 'expert-card-desc' }, desc),
  );
}

export function ExpertCard(props) {
  const { item, ...rest } = props;
  return renderExpertCard(item, rest);
}
