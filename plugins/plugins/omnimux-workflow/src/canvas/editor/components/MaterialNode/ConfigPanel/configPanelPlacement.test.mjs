import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONFIG_PANEL_GAP,
  CONFIG_PANEL_MIN_DOCK_HEIGHT,
  computeDockHeightLimit,
  evaluateConfigPanelMode,
  finalizeAnchorPlacement,
  finalizeDockPlacement,
} from './configPanelPlacement.ts';

function rect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

describe('Issue #111 P3: configPanelPlacement', () => {
  const bounds1024 = rect(0, 36, 1024, 684);
  const toolbar1024 = rect(350, 650, 324, 46);

  it('stays anchored when sparse layout has ample room below owner card', () => {
    const decision = evaluateConfigPanelMode({
      bounds: bounds1024,
      ownerId: 'n-image',
      ownerCard: rect(360, 90, 260, 170),
      zoom: 0.81,
      preferredWidth: 480,
      naturalHeight: 170,
      toolbarRect: toolbar1024,
      overlayRects: [rect(16, 52, 180, 40), rect(800, 52, 208, 40)],
      otherNodes: [
        {
          id: 'n-asset-img',
          head: rect(360, 462, 120, 20),
          body: rect(360, 484, 260, 150),
        },
      ],
    });

    assert.equal(decision.mode, 'anchor');
    assert.equal(decision.conflicts.length, 0);
    assert.equal(decision.outside, false);
    assert.equal(decision.hitsOverlay, false);

    const pos = finalizeAnchorPlacement(
      bounds1024,
      decision.idealLeft,
      decision.anchorTop,
      decision.availableWidth,
    );
    assert.ok(pos.left >= CONFIG_PANEL_GAP);
    assert.ok(pos.top > 0);
  });

  it('switches from anchor to dock when same-selection parameter change grows panel into adjacent node header, and restores when height shrinks', () => {
    const common = {
      bounds: bounds1024,
      ownerId: 'n-image',
      ownerCard: rect(360, 108, 260, 170),
      zoom: 0.81,
      preferredWidth: 480,
      toolbarRect: toolbar1024,
      overlayRects: [],
      otherNodes: [
        {
          id: 'n-asset-img',
          head: rect(360, 462, 120, 20),
          body: rect(360, 484, 260, 150),
        },
      ],
    };

    // 文生图: 170px → bottom = 108 + 170 + 9.72 + 170 = 457.72 < 462 → anchor
    const textToImg = evaluateConfigPanelMode({ ...common, naturalHeight: 170 });
    assert.equal(textToImg.mode, 'anchor');

    // 切到参考图: 186px → bottom = 473.72 > 462 → hits header → dock
    const refImg = evaluateConfigPanelMode({ ...common, naturalHeight: 186 });
    assert.equal(refImg.mode, 'dock');
    assert.deepEqual(refImg.conflicts.map((c) => c.id), ['n-asset-img']);

    const limit = computeDockHeightLimit({
      bounds: bounds1024,
      ownerId: 'n-image',
      ownerCard: common.ownerCard,
      availableWidth: refImg.availableWidth,
      center: refImg.center,
      toolbarRect: toolbar1024,
      otherNodes: common.otherNodes,
      conflicts: refImg.conflicts,
    });
    assert.ok(limit.maxHeight >= CONFIG_PANEL_MIN_DOCK_HEIGHT);
    // 紧凑停靠高度 110px，cut = 650 - 16 - 110 = 524 > lastTargetY(498) → 零遮挡、零平移
    const docked = finalizeDockPlacement({
      bounds: bounds1024,
      ownerCard: common.ownerCard,
      availableWidth: refImg.availableWidth,
      fittedHeight: 110,
      toolbarRect: toolbar1024,
      overlayRects: [],
      visibleTargets: limit.visibleTargets,
      lastTargetY: limit.lastTargetY,
      initialPlacement: false,
      allowAutoPan: true,
    });
    assert.equal(docked.correctivePanY, 0);
    assert.ok(docked.cut > 484 + 14, 'upper 14px click target must stay above dock cut');
    assert.ok(docked.shelfTop + 110 <= toolbar1024.top - CONFIG_PANEL_GAP);

    // 切回文生图: 170px → 恢复 anchor
    const backToText = evaluateConfigPanelMode({ ...common, naturalHeight: 170 });
    assert.equal(backToText.mode, 'anchor');
  });

  it('docks when single-node 1024x720 fitView panel collides with bottom .wf-canvas-toolbar', () => {
    // 复现 PR #183 观察到的单节点 1024×720 居中 fitView：配置底栏与 .wf-canvas-toolbar 重叠
    const singleBounds = rect(0, 0, 1024, 720);
    const singleToolbar = rect(350, 650, 324, 46);
    const ownerCard = rect(362, 230, 300, 300);

    const decision = evaluateConfigPanelMode({
      bounds: singleBounds,
      ownerId: 'target',
      ownerCard,
      zoom: 1,
      preferredWidth: 480,
      naturalHeight: 144,
      toolbarRect: singleToolbar,
      overlayRects: [],
      otherNodes: [],
    });

    assert.equal(decision.mode, 'dock');
    assert.equal(decision.hitsOverlay, true);

    const limit = computeDockHeightLimit({
      bounds: singleBounds,
      ownerId: 'target',
      ownerCard,
      availableWidth: decision.availableWidth,
      center: decision.center,
      toolbarRect: singleToolbar,
      otherNodes: [],
      conflicts: [],
    });
    const docked = finalizeDockPlacement({
      bounds: singleBounds,
      ownerCard,
      availableWidth: decision.availableWidth,
      fittedHeight: 144,
      toolbarRect: singleToolbar,
      overlayRects: [],
      visibleTargets: limit.visibleTargets,
      lastTargetY: limit.lastTargetY,
      initialPlacement: true,
      allowAutoPan: true,
    });

    // 停靠后的底边必须严格在工具栏上沿之上（无重叠）
    assert.equal(docked.shelfTop + 144, singleToolbar.top - CONFIG_PANEL_GAP);
    assert.ok(docked.correctivePanY < 0, 'single tall card near bottom gets single corrective pan');
  });

  it('never triggers corrective auto-pan when allowAutoPan is false (user hand-pan gesture lock)', () => {
    const ownerCard = rect(360, 260, 260, 260);
    const limit = computeDockHeightLimit({
      bounds: bounds1024,
      ownerId: 'n-image',
      ownerCard,
      availableWidth: 480,
      center: 490,
      toolbarRect: toolbar1024,
      otherNodes: [],
      conflicts: [],
    });
    const docked = finalizeDockPlacement({
      bounds: bounds1024,
      ownerCard,
      availableWidth: 480,
      fittedHeight: 150,
      toolbarRect: toolbar1024,
      overlayRects: [],
      visibleTargets: limit.visibleTargets,
      lastTargetY: limit.lastTargetY,
      initialPlacement: false,
      allowAutoPan: false,
    });

    assert.equal(docked.correctivePanY, 0);
  });

  it('respects top overlay clearance so corrective pan never pushes a node header under top controls', () => {
    const ownerHeader = rect(820, 96, 120, 20);
    const ownerCard = rect(780, 120, 220, 410);
    const topRightHeader = rect(780, 52, 228, 40);

    const limit = computeDockHeightLimit({
      bounds: bounds1024,
      ownerId: 'n-top',
      ownerCard,
      ownerHeader,
      availableWidth: 480,
      center: 890,
      toolbarRect: toolbar1024,
      otherNodes: [],
      conflicts: [],
    });
    const docked = finalizeDockPlacement({
      bounds: bounds1024,
      ownerCard,
      ownerHeader,
      availableWidth: 480,
      fittedHeight: 140,
      toolbarRect: toolbar1024,
      overlayRects: [topRightHeader],
      visibleTargets: limit.visibleTargets,
      lastTargetY: limit.lastTargetY,
      initialPlacement: true,
      allowAutoPan: true,
    });

    // ownerHeader.top (96) + correctivePanY >= topRightHeader.bottom (92) + 3 = 95 → delta >= -1
    assert.ok(ownerHeader.top + docked.correctivePanY >= topRightHeader.bottom + 3 - 0.01);
  });
});
