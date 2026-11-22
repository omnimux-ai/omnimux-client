import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'CanvasPageHeader.tsx'), 'utf8');
const componentsCss = readFileSync(join(here, '../../theme/components.css'), 'utf8');
const themeCss = readFileSync(join(here, '../../theme/workbench-theme.css'), 'utf8');

describe('CanvasPageHeader Component', () => {
  it('defines props with workspaceId and onSwitchWorkspaceId', () => {
    assert.match(source, /workspaceId:\s*string\s*\|\s*null/);
    assert.match(source, /onSwitchWorkspaceId\?:\s*\(newWorkspaceId:\s*string\)\s*=>\s*void/);
  });

  it('renders capsule with title and more dropdown toggle button', () => {
    assert.match(source, /className="wf-page-header-capsule"/);
    assert.match(source, /className="wf-page-header-title"/);
    assert.match(source, /className="wf-page-header-more-btn"/);
  });

  it('reflects open state on controls container and provides brand color checkmark fallback', () => {
    assert.match(source, /data-open=\{isOpen \? 'true' : undefined\}/);
    assert.match(source, /color:\s*'var\(--dsw-alias-brand-primary,\s*var\(--wb-accent,\s*#4176E6\)\)'/);
  });

  it('provides clean dropdown list without redundant header row', () => {
    assert.match(source, /className="wf-page-dropdown-popover"/);
    assert.match(source, /className="wf-page-dropdown-list"/);
    assert.match(source, /className="wf-page-dropdown-create-btn"/);
    assert.match(source, /新建创作页/);
    assert.doesNotMatch(source, /wf-page-dropdown-header/);
  });

  it('uses an opaque host surface while preserving the popover border and animation', () => {
    const popoverRule = componentsCss.match(/\.wf-page-dropdown-popover\s*\{([^}]+)\}/)?.[1] ?? '';
    assert.match(popoverRule, /background:\s*var\(--dsw-alias-bg-layer-1, var\(--dsw-alias-bg-base, Canvas\)\);/);
    assert.match(popoverRule, /border:\s*1px solid var\(--dsw-alias-border-l2\)/);
    assert.match(popoverRule, /box-shadow:\s*0 12px 32px var\(--dsw-alias-bg-mask-1\)/);
    assert.doesNotMatch(popoverRule, /backdrop-filter|--dsw-alias-bg-(?:elevated|overlay)/);
    assert.match(popoverRule, /animation:\s*omnimux-popover-in/);
    assert.match(componentsCss, /@keyframes omnimux-popover-in\s*\{/);
  });

  it('theme tokens define elevated popover background and alias fallbacks for light and dark themes', () => {
    const lightTheme = themeCss.match(/^\.wf-canvas-root\s*\{([^}]+)\}/m)?.[1] ?? '';
    const darkTheme = themeCss.match(/^body\[data-ds-dark-theme\] \.wf-canvas-root\s*\{([^}]+)\}/m)?.[1] ?? '';
    assert.match(lightTheme, /--wb-surface-elevated:\s*#ffffff;/);
    assert.match(darkTheme, /--wb-surface-elevated:\s*#1c1c1f;/);
    assert.ok([lightTheme, darkTheme].every((theme) => /--dsw-alias-bg-elevated:\s*var\(--wb-surface-elevated\);/.test(theme)));
  });

  it('supports hovering rename pencil button and inline rename input', () => {
    assert.match(source, /className="wf-page-edit-btn"/);
    assert.match(source, /className="wf-page-rename-input"/);
    assert.match(source, /renameProjectPage/);
  });

  it('calls createProjectPage and triggers workspace switch', () => {
    assert.match(source, /createProjectPage\(workspaceId/);
    assert.match(source, /onSwitchWorkspaceId\(newWsId\)/);
  });

  it('supports selecting and activating existing pages', () => {
    assert.match(source, /setActiveProjectPage\(workspaceId,\s*page\.id\)/);
  });
});
