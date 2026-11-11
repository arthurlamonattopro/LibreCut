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
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-muted">{label}</span>
        <span className="font-mono text-[11px] text-dim">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        className="w-full"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
