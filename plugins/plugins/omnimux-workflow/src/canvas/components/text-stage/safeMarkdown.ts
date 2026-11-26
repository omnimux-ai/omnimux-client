import { Marked } from 'marked';

const SAFE_LANG_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const SAFE_TAG_SET = new Set([
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'strong',
  'b',
  'em',
  'i',
  'del',
  's',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'img',
  'input',
  'span',
  'div',
]);

const STRIP_CONTENT_TAGS_RE = /<\s*(script|style|iframe|object|embed|svg|math|form|template|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const STRIP_SELF_CLOSING_DANGEROUS_RE = /<\s*(script|style|iframe|object|embed|svg|math|form|meta|link|base|template|noscript)\b[^>]*\/?>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

export function escapeHtml(raw: string): string {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);?/g, (_, dec: string) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/gi, '&')
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n');
}

export function sanitizeLinkHref(rawHref: string | null | undefined): string | null {
  if (typeof rawHref !== 'string') return null;
  const trimmed = rawHref.trim();
  if (!trimmed) return null;
  const normalized = decodeHtmlEntities(trimmed).replace(/[\u0000-\u0020\u007f]+/g, '');
  if (!normalized) return null;
  if (normalized.startsWith('#')) {
    return trimmed;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

export function sanitizeImageSrc(rawSrc: string | null | undefined): string | null {
  if (typeof rawSrc !== 'string') return null;
  const trimmed = rawSrc.trim();
  if (!trimmed) return null;
  const normalized = decodeHtmlEntities(trimmed).replace(/[\u0000-\u0020\u007f]+/g, '');
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

function parseAttributes(rawAttrs: string): Array<{ name: string; value: string }> {
  const attrs: Array<{ name: string; value: string }> = [];
  const attrRe = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(rawAttrs)) !== null) {
    const name = match[1]?.toLowerCase() ?? '';
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (name) attrs.push({ name, value });
  }
  return attrs;
}

function sanitizeSafeTagAttributes(tag: string, rawAttrs: string): string {
  const attrs = parseAttributes(rawAttrs);
  const kept: string[] = [];

  for (const { name, value } of attrs) {
    if (name.startsWith('on') || name === 'style' || name === 'srcdoc' || name === 'formaction') {
      continue;
    }
    if (tag === 'a') {
      if (name === 'href') {
        const safe = sanitizeLinkHref(value);
        if (safe) kept.push(`href="${escapeHtml(safe)}"`);
      } else if (name === 'title') {
        kept.push(`title="${escapeHtml(value)}"`);
      }
    } else if (tag === 'img') {
      if (name === 'src') {
        const safe = sanitizeImageSrc(value);
        if (safe) kept.push(`src="${escapeHtml(safe)}"`);
      } else if (name === 'alt' || name === 'title') {
        kept.push(`${name}="${escapeHtml(value)}"`);
      }
    } else if (tag === 'input') {
      if (name === 'type' && value.toLowerCase() === 'checkbox') {
        kept.push('type="checkbox"');
      } else if (name === 'checked') {
        kept.push('checked=""');
      } else if (name === 'disabled') {
        kept.push('disabled=""');
      }
    } else if ((tag === 'code' || tag === 'p' || tag === 'span' || tag === 'div') && name === 'class') {
      const safeClasses = value
        .split(/\s+/)
        .filter((token) => /^[a-zA-Z0-9_-]{1,64}$/.test(token));
      if (safeClasses.length > 0) kept.push(`class="${safeClasses.join(' ')}"`);
    } else if ((tag === 'th' || tag === 'td') && name === 'align') {
      const lower = value.toLowerCase();
      if (lower === 'left' || lower === 'center' || lower === 'right') {
        kept.push(`align="${lower}"`);
      }
    }
  }

  if (tag === 'a' && kept.some((item) => item.startsWith('href='))) {
    kept.push('target="_blank"', 'rel="noopener noreferrer"');
  }

  return kept.length > 0 ? ` ${kept.join(' ')}` : '';
}

/**
 * Defense-in-depth allowlist HTML sanitizer for Markdown preview output.
 */
export function sanitizeMarkdownHtml(html: string): string {
  const stripped = html
    .replace(HTML_COMMENT_RE, '')
    .replace(STRIP_CONTENT_TAGS_RE, '')
    .replace(STRIP_SELF_CLOSING_DANGEROUS_RE, '');

  return stripped.replace(/<\s*(\/?)\s*([a-zA-Z0-9-]+)([^>]*)>/g, (_full, closingSlash: string, rawTag: string, rawAttrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!SAFE_TAG_SET.has(tag)) {
      return '';
    }
    if (closingSlash) {
      if (tag === 'br' || tag === 'hr' || tag === 'img' || tag === 'input') return '';
      return `</${tag}>`;
    }
    const cleanAttrs = sanitizeSafeTagAttributes(tag, rawAttrs);
    if (tag === 'img' && !cleanAttrs.includes('src=')) {
      return '';
    }
    if (tag === 'input' && !cleanAttrs.includes('type="checkbox"')) {
      return '';
    }
    if (tag === 'br' || tag === 'hr' || tag === 'img' || tag === 'input') {
      return `<${tag}${cleanAttrs} />`;
    }
    return `<${tag}${cleanAttrs}>`;
  });
}

function createSafeMarkedInstance(): Marked {
  const instance = new Marked({ gfm: true, breaks: true });
  const renderer = new instance.Renderer();

  renderer.html = ({ text }) => escapeHtml(text);

  renderer.link = function ({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);
    const safeHref = sanitizeLinkHref(href);
    if (!safeHref) return label;
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(safeHref)}"${titleAttr} target="_blank" rel="noopener noreferrer">${label}</a>`;
  };

  renderer.image = ({ href, title, text }) => {
    const safeSrc = sanitizeImageSrc(href);
    if (!safeSrc) return escapeHtml(text || '');
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(text || '')}"${titleAttr} />`;
  };

  renderer.code = ({ text, lang }) => {
    const cleanLang = typeof lang === 'string' && SAFE_LANG_RE.test(lang.trim()) ? lang.trim() : '';
    const classAttr = cleanLang ? ` class="language-${cleanLang}"` : '';
    return `<pre><code${classAttr}>${escapeHtml(text)}</code></pre>\n`;
  };

  instance.use({ renderer });
  return instance;
}

const safeMarked = createSafeMarkedInstance();

export function renderSafeMarkdownHtml(content: string): string {
  if (!content || !content.trim()) {
    return '';
  }
  try {
    const parsed = safeMarked.parse(content, { async: false });
    return sanitizeMarkdownHtml(typeof parsed === 'string' ? parsed : String(parsed));
  } catch (e) {
    console.error('Failed to parse markdown:', e);
    return `<p class="wf-md-error">${escapeHtml(content)}</p>`;
  }
}
