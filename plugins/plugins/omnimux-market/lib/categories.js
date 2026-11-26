export const CATEGORIES = {
    'office-efficiency': '办公效率',
    'content-creation': '内容创作',
    'dev-programming': '开发编程',
    'data-analysis': '数据分析',
    'design-media': '设计多媒体',
    'ai-agent': 'AI Agent',
    'knowledge-management': '知识管理',
    'business-ops': '商业运营',
    education: '教育学习',
    professional: '行业专业',
    'it-ops-security': 'IT 运维与安全',
    'life-service': '生活服务',
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES);
export function categoryLabel(key) {
    if (!key)
        return '';
    return CATEGORIES[key] || key;
}
export function parseCategory(raw) {
    const key = String(raw || '').trim();
    if (!key)
        return undefined;
    return CATEGORY_KEYS.includes(key) ? key : undefined;
}
export const VERTICAL_SCENARIOS = Object.freeze([
    { id: 'scene-video', titleZh: '短视频创作', titleEn: 'Video Creation' },
    { id: 'scene-replicate', titleZh: '爆款复刻与再制', titleEn: 'Viral Replication' },
    { id: 'scene-visual', titleZh: '商品视觉与海报', titleEn: 'Visual & Product' },
    { id: 'scene-research', titleZh: '选品与社媒洞察', titleEn: 'Market & Social Research' },
    { id: 'scene-growth', titleZh: '投放与增长运营', titleEn: 'Ads & Growth Ops' },
    { id: 'scene-tools', titleZh: '剪辑与效率工具', titleEn: 'Editing & Tools' },
]);
