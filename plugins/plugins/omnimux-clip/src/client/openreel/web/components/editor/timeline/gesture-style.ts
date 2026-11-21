type GestureStyle = Readonly<{ cursor?: string; userSelect?: "none" }>;

interface ActiveStyles {
  original: Array<{ property: string; value: string; priority: string }>;
  gestures: Set<GestureStyle>;
}

const activeStyles = new WeakMap<HTMLElement, ActiveStyles>();

/** Each gesture owns its styles only within the editor it started in. */
export function beginTimelineGestureStyle(target: Element | null, style: GestureStyle): () => void {
  const root = target?.closest<HTMLElement>(".openreel-studio-root, .editor-shell");
  if (!root) return () => {};

  let active = activeStyles.get(root);
  if (!active) {
    active = {
      original: ["cursor", "user-select"].map(property => ({
        property,
        value: root.style.getPropertyValue(property),
        priority: root.style.getPropertyPriority(property),
      })),
      gestures: new Set(),
    };
    activeStyles.set(root, active);
  }
  const entry = { ...style };
  const { original, gestures } = active;
  const apply = () => {
    for (const { property, value, priority } of original) root.style.setProperty(property, value, priority);
    for (const gesture of gestures) {
      if (gesture.cursor) root.style.setProperty("cursor", gesture.cursor);
      if (gesture.userSelect) root.style.setProperty("user-select", gesture.userSelect);
    }
  };
  gestures.add(entry);
  apply();
  return () => {
    if (!gestures.delete(entry)) return;
    apply();
    if (gestures.size === 0) activeStyles.delete(root);
  };
}
