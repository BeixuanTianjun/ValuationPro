export const formatCurrency = (val: number, currency: string = '$', decimals: number = 1): string => {
  if (isNaN(val) || !isFinite(val)) return '-';
  const prefix = val < 0 ? '-' : '';
  const absVal = Math.abs(val);
  return `${prefix}${currency}${absVal.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

export const formatPercent = (val: number, decimals: number = 1): string => {
  if (isNaN(val) || !isFinite(val)) return '-';
  return `${(val * 100).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`;
};

export const formatMultiple = (val: number, decimals: number = 1): string => {
  if (isNaN(val) || !isFinite(val)) return '-';
  return `${val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}x`;
};

/** Short suffix for a statement scale, e.g. 'billions' -> 'bn'. */
export const unitSuffix = (units: string): string =>
  ({ billions: 'bn', millions: 'm', thousands: 'k', exact: '' } as Record<string, string>)[units] ?? '';

/**
 * Label for an amount field, stamped with the currency and scale actually in
 * use — a rupiah model in billions must not be labelled "($m)".
 */
export const amountLabel = (base: string, currency: string, units: string): string => {
  const suffix = unitSuffix(units);
  const cur = currency.trim();
  return suffix ? `${base} (${cur} ${suffix})` : `${base} (${cur})`;
};
