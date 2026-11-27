/**
 * 柔和氛围微光色彩预设引擎（Plan A: Top-Right Ambient Glow Engine）
 * 按 skill 标识散列映射 14 套柔和右上角氛围微光与悬停点缀色，兼顾暗色与浅色主题对比度。
 */

export const AURORA_PRESETS = [
  // 1. 霓虹紫粉
  {
    accent: '#a78bfa', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(167, 139, 250, 0.22) 0%, rgba(167, 139, 250, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(167, 139, 250, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 2. 电光蓝紫
  {
    accent: '#818cf8', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(129, 140, 248, 0.22) 0%, rgba(129, 140, 248, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(129, 140, 248, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 3. 冰川湛蓝
  {
    accent: '#38bdf8', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(56, 189, 248, 0.22) 0%, rgba(56, 189, 248, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(56, 189, 248, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 4. 焦糖琥珀
  {
    accent: '#f59e0b', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(245, 158, 11, 0.22) 0%, rgba(245, 158, 11, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(245, 158, 11, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 5. 深海钴蓝
  {
    accent: '#60a5fa', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(96, 165, 250, 0.22) 0%, rgba(96, 165, 250, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(96, 165, 250, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 6. 翡翠薄荷
  {
    accent: '#34d399', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(52, 211, 153, 0.22) 0%, rgba(52, 211, 153, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(52, 211, 153, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 7. 珊瑚绯红
  {
    accent: '#fb7185', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(251, 113, 133, 0.22) 0%, rgba(251, 113, 133, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(251, 113, 133, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 8. 晴空靛青
  {
    accent: '#22d3ee', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(34, 211, 238, 0.22) 0%, rgba(34, 211, 238, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(34, 211, 238, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 9. 极地碧青
  {
    accent: '#2dd4bf', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(45, 212, 191, 0.22) 0%, rgba(45, 212, 191, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(45, 212, 191, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 10. 幻彩星云紫
  {
    accent: '#e879f9', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(232, 121, 249, 0.22) 0%, rgba(232, 121, 249, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(232, 121, 249, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 11. 钛金暖阳
  {
    accent: '#eab308', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(234, 179, 8, 0.22) 0%, rgba(234, 179, 8, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(234, 179, 8, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 12. 深海群青
  {
    accent: '#3b82f6', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(59, 130, 246, 0.22) 0%, rgba(59, 130, 246, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(59, 130, 246, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 13. 落樱品红
  {
    accent: '#f472b6', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(244, 114, 182, 0.22) 0%, rgba(244, 114, 182, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(244, 114, 182, 0.35)', /* exempt-ui03: 微光晕色 */
  },
  // 14. 极简银霜
  {
    accent: '#94a3b8', /* exempt-ui03: 卡片微光点缀色 */
    bg: 'radial-gradient(ellipse 88% 80% at 96% 0%, rgba(148, 163, 184, 0.22) 0%, rgba(148, 163, 184, 0.08) 44%, transparent 74%)', /* exempt-ui03: 柔和氛围微光渐变 */
    glow: 'rgba(148, 163, 184, 0.35)', /* exempt-ui03: 微光晕色 */
  },
];

/**
 * 确定性哈希算法：根据 skill 标识计算唯一稳定的随机种子
 */
export function hashSeed(str) {
  let hash = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * 极光微光算法：为每张 skill 卡片计算稳定且克制的顶部角标光晕方案
 */
export function resolveSkillAuroraStyle(item) {
  const seedKey = String(item?.slug || item?.id || item?.skill || item?.name || item?.title || '');
  const seed = hashSeed(seedKey);
  return AURORA_PRESETS[seed % AURORA_PRESETS.length];
}
