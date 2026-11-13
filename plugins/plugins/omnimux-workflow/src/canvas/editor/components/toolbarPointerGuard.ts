/**
 * 工具栏指针守卫：拦住 xyflow pan/select capture，保留 button click。
 * 抽到纯 TS，方便 node:test 不经 jsdom 直接测。
 */

/** 拦住 xyflow pan/select 把后续鼠标事件 capture 走 */
export function stopToolbarNativeEvent(e: { stopPropagation(): void }): void {
  e.stopPropagation();
}

/** 添加按钮右键：不弹浏览器菜单，也不冒泡到空白画布 ContextMenu */
export function preventToolbarAddContextMenu(e: {
  preventDefault(): void;
  stopPropagation(): void;
}): void {
  e.preventDefault();
  e.stopPropagation();
}
