import React from 'react';

interface NumberInputProps {
  label: string;
  value: number;
  onChange: (val: number) => void;
  type?: 'percent' | 'currency' | 'multiple' | 'number';
  step?: number;
  min?: number;
  max?: number;
  helperText?: string;
  decimals?: number;
}

export const NumberInput: React.FC<NumberInputProps> = ({
  label,
  value,
  onChange,
  type = 'number',
  step = 1,
  min,
  max,
  helperText,
  decimals = 2,
}) => {
  // Convert value for input display
  const displayValue = type === 'percent' ? +(value * 100).toFixed(decimals) : value;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parseFloat(e.target.value);
    if (isNaN(raw)) return;
    const finalVal = type === 'percent' ? raw / 100 : raw;
    onChange(finalVal);
  };

  const getPrefix = () => {
    if (type === 'currency') return '$';
    return null;
  };

  const getSuffix = () => {
    if (type === 'percent') return '%';
    if (type === 'multiple') return 'x';
    return null;
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <label className="text-xs font-semibold text-slate-300">{label}</label>
        {helperText && <span className="text-[11px] text-slate-500">{helperText}</span>}
      </div>
      <div className="relative flex items-center">
        {getPrefix() && (
          <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
            {getPrefix()}
          </span>
        )}
        <input
          type="number"
          step={type === 'percent' ? step * 100 : step}
          min={min !== undefined && type === 'percent' ? min * 100 : min}
          max={max !== undefined && type === 'percent' ? max * 100 : max}
          value={displayValue}
          onChange={handleChange}
          className={`w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs font-mono font-medium text-blue-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all ${
            getPrefix() ? 'pl-7' : ''
          } ${getSuffix() ? 'pr-7' : ''}`}
        />
        {getSuffix() && (
          <span className="absolute right-3 text-xs font-semibold text-slate-400 pointer-events-none">
            {getSuffix()}
          </span>
        )}
      </div>
    </div>
  );
};
