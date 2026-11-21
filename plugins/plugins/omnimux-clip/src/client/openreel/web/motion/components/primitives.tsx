import type { JSX } from "react";
import { ColorPicker } from "@openreel/ui";
import { useClipT } from "../../../../i18n/index.js";

export function ColorSelector({
  value,
  onChange,
  disabled = false,
  label = "Select color",
  allowTransparent = false,
  fallback = "#000000",
  showValue = true,
  showAlpha = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  allowTransparent?: boolean;
  fallback?: string;
  showValue?: boolean;
  showAlpha?: boolean;
}): JSX.Element {
  const t = useClipT();
  return (
    <div title={t(label)} className={showValue ? "min-w-[8rem]" : "w-11"}>
      <ColorPicker
        value={value.trim() || fallback}
        onChange={onChange}
        label={t(label)}
        disabled={disabled}
        allowTransparent={allowTransparent}
        showAlpha={showAlpha}
        className={
          showValue
            ? "w-full"
            : "w-11 justify-center px-0 [&>span:last-child]:sr-only"
        }
      />
    </div>
  );
}
