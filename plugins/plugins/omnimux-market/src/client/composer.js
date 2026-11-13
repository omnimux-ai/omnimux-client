    /**
     * 通过 React value tracker 写入输入框（来自 omnimux-gallery，原样移植）。
     * 直接 `field.value =` 会被受控 composer 忽略，必须走原型上的 value setter。
     * @param {HTMLTextAreaElement | HTMLInputElement} field
     * @param {string} gesture
     * @returns {boolean}
     */
    function insertGesture(field, gesture) {
      const token = gesture.endsWith(" ") ? gesture : gesture + " ";
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      const next = field.value.slice(0, start) + token + field.value.slice(end);
      const proto = typeof HTMLTextAreaElement === "function" && field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : typeof HTMLInputElement === "function" && field instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : Object.getPrototypeOf(field);
      const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : undefined;
      if (setter) setter.call(field, next);
      else field.value = next;
      const caret = start + token.length;
      field.setSelectionRange?.(caret, caret);
      const Input = typeof InputEvent === "function" ? InputEvent : Event;
      field.dispatchEvent(new Input("input", { bubbles: true, inputType: "insertText", data: token }));
      field.focus?.();
      return field.value.includes(token.trim());
    }

    /** 当前会话的 composer 输入框（选择器来自 omnimux-gallery GalleryStage）。 */
    function findComposer() {
      if (typeof document === "undefined") return null;
      return document.querySelector(
        "[data-composer-card] textarea, [data-composer-seat] textarea, textarea[data-phase], textarea[placeholder]",
      );
    }

    /** 会话是否还是空白（标题/滚动区文本长度启发式，来自 omnimux-gallery GalleryStage）。 */
    function isBlankSession() {
      if (typeof document === "undefined") return true;
      const header = document.querySelector('[data-slot="conversation.session.header"]');
      const title = (header && header.textContent) || "";
      if (/新会话|New session|Untitled/i.test(title)) return true;
      const scroll = document.querySelector("[data-conversation-scroll]");
      if (!scroll) return true;
      return (scroll.textContent || "").trim().length < 40;
    }

    /** 点预设 chip 再点菜单项（来自 omnimux-gallery GalleryStage）。 */
    function clickPreset(id) {
      if (typeof document === "undefined") return false;
      const chip = document.querySelector('button[title*="Agent"], button[title*="预设"]');
      if (!(chip instanceof HTMLElement)) return false;
      chip.click();
      const wanted = id === "expert-mode" ? /专家模式|Expert Mode/ : null;
      if (!wanted) return false;
      const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
      const match = items.find((el) => wanted.test(el.textContent || ""));
      if (match instanceof HTMLElement) {
        match.click();
        return true;
      }
      chip.click();
      return false;
    }
