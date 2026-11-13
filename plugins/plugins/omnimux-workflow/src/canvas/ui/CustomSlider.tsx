/**
 * CustomSlider — Native Dark-Glass Range Slider.
 * Replaces antd `Slider` with a sleek, minimalist component.
 */

import React, { useCallback } from 'react';

export interface CustomSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export const CustomSlider: React.FC<CustomSliderProps> = ({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  disabled = false,
  style,
  className = '',
}) => {
  const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(Number(e.target.value));
    },
    [onChange],
  );

  return (
    <div className={`wf-custom-slider ${className}`} style={style}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        className="wf-custom-slider__input"
        style={{
          background: `linear-gradient(to right, var(--dsw-alias-brand-primary) 0%, var(--dsw-alias-brand-primary) ${percentage}%, var(--dsw-alias-bg-layer-3) ${percentage}%, var(--dsw-alias-bg-layer-3) 100%)`,
        }}
      />
    </div>
  );
};

export default CustomSlider;
