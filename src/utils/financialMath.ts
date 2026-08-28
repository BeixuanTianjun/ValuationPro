/**
 * Calculates Internal Rate of Return (IRR) for a series of cash flows (t=0,1,2,...)
 * Uses Newton-Raphson with fallback to Secant / Bisection method.
 * @param cashFlows Array where cashFlows[0] is typically negative (outflow) and subsequent are inflows
 * @param guess Initial rate guess (default 0.15)
 */
export function calculateIRR(cashFlows: number[], guess: number = 0.15): number {
  if (cashFlows.length < 2) return 0;
  
  // Check if there is at least one positive and one negative cash flow
  const hasPositive = cashFlows.some(cf => cf > 0);
  const hasNegative = cashFlows.some(cf => cf < 0);
  if (!hasPositive || !hasNegative) return 0;

  const maxIterations = 1000;
  const precision = 1e-7;
  let rate = guess;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dNpv = 0;

    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      if (isNaN(denom) || denom === 0) break;
      npv += cashFlows[t] / denom;
      if (t > 0) {
        dNpv -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
      }
    }

    if (Math.abs(npv) < precision) {
      return rate;
    }

    if (Math.abs(dNpv) < 1e-12) {
      rate += 0.01;
      continue;
    }

    const newRate = rate - npv / dNpv;
    
    // Prevent runaway negative values below -0.999
    if (newRate <= -0.99) {
      rate = (rate - 0.99) / 2;
    } else {
      rate = newRate;
    }
  }

  // Fallback bisection if Newton didn't converge cleanly
  let low = -0.90;
  let high = 5.0;
  for (let iter = 0; iter < 100; iter++) {
    const mid = (low + high) / 2;
    const npvMid = cashFlows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + mid, t), 0);
    if (Math.abs(npvMid) < precision) return mid;

    const npvLow = cashFlows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + low, t), 0);
    if (npvMid * npvLow < 0) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return rate;
}
