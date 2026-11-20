import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import postcss from 'postcss';

const stylesheet = postcss.parse(readFileSync(new URL('./promptTokenEditor.css', import.meta.url), 'utf8'));
const rules = stylesheet.nodes.filter(rule => rule.type === 'rule' && rule.selector.startsWith('.wf-mention-'));
const declarations = (selector) => Object.fromEntries(rules.find(rule => rule.selector === selector).nodes
  .filter(node => node.type === 'decl').map(node => [node.prop, node.value]));

const menuSurface = 'var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base)))';

test('body mention portals use host tokens and force the menu surface to full opacity', () => {
  const base = declarations('.wf-mention-popover');
  assert.equal(base.background, menuSurface);
  assert.equal(base['background-color'], `rgb(from ${menuSurface} r g b / 1)`);
  assert.equal(base.border, '1px solid var(--dsw-alias-border-l2)');
  assert.equal(base.color, 'var(--dsw-alias-label-primary)');
  assert.equal(base['box-shadow'], '0 8px 24px var(--dsw-alias-bg-mask-1)');
  const hover = declarations('.wf-mention-item:hover,\n.wf-mention-item--highlighted');
  assert.equal(hover.background, 'var(--dsw-alias-interactive-bg-hover)');
  assert.equal(hover.color, 'var(--dsw-alias-label-primary)');
  for (const rule of rules) {
    assert.doesNotMatch(rule.toString(), /--dsw-alias-bg-(?:elevated|overlay)|--wb-|backdrop-filter|#[\da-f]{3,8}\b|rgba?\(\s*\d/i);
  }
});

test('submenu overrides the shared mention popover layer at equal specificity', () => {
  const mainIndex = rules.findIndex(rule => rule.selector === '.wf-mention-popover');
  const subIndex = rules.findIndex(rule => rule.selector === '.wf-mention-submenu');
  assert.ok(mainIndex >= 0 && subIndex > mainIndex);
  assert.equal(declarations('.wf-mention-popover')['z-index'], '10000');
  assert.equal(declarations('.wf-mention-submenu')['z-index'], '10001');
});
