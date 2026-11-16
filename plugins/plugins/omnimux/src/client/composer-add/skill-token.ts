/**
 * Composer 斜杠技能 token 的纯文本工具。
 *
 * 词边界与 ui-conversation/decorations.ts 保持一致：`/slug` 必须出现在
 * 行首或空白之后，并以空白或文本结束收尾；这样 `x/skill`、`/skill.md`
 * 和正文里的普通斜杠路径不会被误判/误删。
 */

export interface SkillTokenRange {
  start: number;
  end: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizedSlug(slug: string): string {
  return String(slug || '').replace(/^\//, '').trim();
}

/** 查找 draft 中指定技能 slug 的 `/slug` token 范围（含尾随空格，不含前面的空白）。 */
export function findSkillTokenRange(draft: string, slug: string): SkillTokenRange | null {
  const text = String(draft || '');
  const name = normalizedSlug(slug);
  if (!text || !name) return null;
  const pattern = new RegExp(`(^|\\s)/${escapeRegExp(name)}(?=\\s|$)[ \\t]?`);
  const match = pattern.exec(text);
  if (!match) return null;
  const prefixLength = match[1]?.length ?? 0;
  return {
    start: match.index + prefixLength,
    end: match.index + match[0].length,
  };
}

/** draft 是否还包含指定技能的 `/slug` token。 */
export function draftHasSkillToken(draft: string, slug: string): boolean {
  return findSkillTokenRange(draft, slug) !== null;
}

/** 删除指定技能的 `/slug` token（连同尾随空格），保留其余正文。 */
export function removeSkillTokenFromDraft(draft: string, slug: string): string {
  const text = String(draft || '');
  const range = findSkillTokenRange(text, slug);
  if (!range) return text;
  return text.slice(0, range.start) + text.slice(range.end);
}
