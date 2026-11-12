import { useId } from "react";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format, disabled }: SliderProps) {
  const id = useId();
  const display = format ? format(value) : value.toFixed(2);
  return (
    <div className="block">
      <div className="mb-1 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[12px] font-medium text-muted">{label}</label>
        <span className="font-mono text-[11px] text-dim" aria-hidden="true">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        className="w-full"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        // The visible value is spelled out so the reading is not a bare
        // number between two bounds.
        aria-valuetext={display}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
