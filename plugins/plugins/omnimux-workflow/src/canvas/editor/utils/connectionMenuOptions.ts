/**
 * W3 (T3.4): output-action option derivation for the connection menus
 * (handle plus-click menu + blank-drop release menu).
 *
 * Options derive from the plugin's own connection matrix
 * (`connectionConfig.MATERIAL_OUTPUT_OPTIONS` via
 * `getOutputOptionsForMaterialNode`) — not from Gxgen's NODE_OUTPUT_OPTIONS.
 * Key encoding follows Gxgen useConnectionMenu: `${materialType}-${tool}`
 * split on the first dash (materialType never contains a dash, tools do).
 *
 * Pure logic (no React) so node:test can cover it directly; label/desc
 * resolution through the i18n dictionary happens in the component layer
 * via the returned labelKey/descKey.
 */

import type { MaterialType } from '../../types/materialNode';
// 显式 .ts 扩展名：node --test 的 type-stripping 不做 TS 扩展名解析
import { getOutputOptionsForMaterialNode } from './connectionConfig.ts';

export interface OutputOptionSpec {
  /** `${targetMaterialType}-${targetTool}`，菜单项 key（单个菜单内唯一）。 */
  key: string;
  /** i18n key（含源类型前缀，避免不同源类型同 key 冲突）。 */
  labelKey: string;
  descKey: string;
  icon?: string;
  targetMaterialType: MaterialType;
  targetTool: string;
}

export function encodeOutputOptionKey(materialType: MaterialType, tool: string): string {
  return `${materialType}-${tool}`;
}

export function parseOutputOptionKey(
  key: string,
): { targetMaterialType: MaterialType; targetTool: string } | null {
  const firstDashIndex = key.indexOf('-');
  if (firstDashIndex <= 0 || firstDashIndex === key.length - 1) return null;
  return {
    targetMaterialType: key.slice(0, firstDashIndex) as MaterialType,
    targetTool: key.slice(firstDashIndex + 1),
  };
}

/** 派生源节点的输出动作选项集（label/desc 的 i18n key 由组件层 t() 解析）。 */
export function getOutputOptionSpecs(sourceMaterialType: MaterialType): OutputOptionSpec[] {
  return getOutputOptionsForMaterialNode(sourceMaterialType).map((option) => {
    const tool = String(option.targetTool);
    return {
      key: encodeOutputOptionKey(option.targetMaterialType, tool),
      labelKey: `menu.option.${sourceMaterialType}.${option.targetMaterialType}-${tool}`,
      descKey: `menu.option.${sourceMaterialType}.${option.targetMaterialType}-${tool}.desc`,
      icon: option.icon,
      targetMaterialType: option.targetMaterialType,
      targetTool: tool,
    };
  });
}
