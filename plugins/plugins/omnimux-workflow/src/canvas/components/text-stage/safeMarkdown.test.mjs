import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderSafeMarkdownHtml, sanitizeMarkdownHtml } from './safeMarkdown.ts';

test('MarkdownPreview security: strips raw HTML, scripts, iframes, SVGs, and event handlers', () => {
  const payload = [
    '# Title',
    '',
    '<script>alert("xss")</script>',
    '<img src="https://example.com/x.png" onerror="alert(1)" />',
    '<svg onload="alert(2)"><script>alert(3)</script></svg>',
    '<iframe src="https://evil.example/embed"></iframe>',
    '[click me](javascript:alert(1))',
    '[obfuscated](java\tscript:alert(2))',
    '[entity](&#106;avascript:alert(3))',
    '[vb](vbscript:msgbox(1))',
    '![bad](data:text/html,<script>alert(4)</script>)',
  ].join('\n');

  const html = renderSafeMarkdownHtml(payload);
  assert.equal(/<script\b/i.test(html), false, html);
  assert.equal(/<iframe\b/i.test(html), false, html);
  assert.equal(/<svg\b/i.test(html), false, html);
  assert.equal(/<img\b/i.test(html), false, html);
  assert.equal(/<[^>]+\bon(error|load|click|mouseover)\s*=/i.test(html), false, html);
  assert.equal(/href\s*=\s*["']\s*(javascript|vbscript|data):/i.test(html), false, html);
  assert.equal(/src\s*=\s*["']\s*data:/i.test(html), false, html);
  assert.ok(html.includes('&lt;script&gt;'), html);
  assert.ok(html.includes('<h1>Title</h1>'));
});

test('MarkdownPreview security: sanitizeMarkdownHtml removes disallowed tags and attributes directly', () => {
  const dirty = '<div onclick="alert(1)" style="color:red"><script>evil()</script><a href="javascript:alert(2)" onmouseover="x()">bad</a><img src="javascript:alert(3)" onerror="y()"><a href="https://example.com/docs">ok</a></div>';
  const clean = sanitizeMarkdownHtml(dirty);
  assert.equal(/<script\b/i.test(clean), false, clean);
  assert.equal(/\bonclick\s*=/i.test(clean), false, clean);
  assert.equal(/\bonmouseover\s*=/i.test(clean), false, clean);
  assert.equal(/\bonerror\s*=/i.test(clean), false, clean);
  assert.equal(/\bstyle\s*=/i.test(clean), false, clean);
  assert.equal(/javascript:/i.test(clean), false, clean);
  assert.ok(clean.includes('href="https://example.com/docs"'), clean);
  assert.ok(clean.includes('rel="noopener noreferrer"'), clean);
});

test('MarkdownPreview security: blocks nested/split tag reconstruction and preserves multi-param URLs', () => {
  for (const smuggled of [
    '<<x>script>xss(1)<</x>/script>',
    '<<x>img src=x onerror=xss(1)>',
    '<<img>img src=x onerror=xss(1)>',
    '<<<x>x>script>xss(1)<<</x>/x>/script>',
    '<script>unclosed()',
  ]) {
    const out = sanitizeMarkdownHtml(smuggled);
    assert.equal(/<script\b/i.test(out), false, out);
    assert.equal(/<img\b/i.test(out), false, out);
    assert.equal(/\bonerror\s*=/i.test(out), false, out);
  }

  const md = '[click](https://example.com/a?x=1&y=2 "a & b") and ![alt & "q"](https://example.com/i.png?w=100&h=200 "t & \'s\'")';
  const html = renderSafeMarkdownHtml(md);
  assert.ok(html.includes('href="https://example.com/a?x=1&amp;y=2"'), html);
  assert.ok(html.includes('src="https://example.com/i.png?w=100&amp;h=200"'), html);
  assert.equal(html.includes('&amp;amp;'), false, html);
});

test('MarkdownPreview security: preserves safe Markdown formatting, links, images, and fenced code', () => {
  const md = [
    '## Summary',
    '',
    'Hello **world** and [docs](https://example.com/guide).',
    '',
    '![preview](https://example.com/pic.png "pic")',
    '',
    '```ts',
    'const safe = "<script>";',
    '```',
  ].join('\n');

  const html = renderSafeMarkdownHtml(md);
  assert.ok(html.includes('<h2>Summary</h2>'), html);
  assert.ok(html.includes('<strong>world</strong>'), html);
  assert.ok(html.includes('href="https://example.com/guide"'), html);
  assert.ok(html.includes('target="_blank"'), html);
  assert.ok(html.includes('src="https://example.com/pic.png"'), html);
  assert.ok(html.includes('<code class="language-ts">'), html);
  assert.ok(html.includes('&lt;script&gt;'), html);
});
