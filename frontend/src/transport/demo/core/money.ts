/** Money helpers mirroring `atrium.calculators.money`: Decimal everywhere, half-up cents. */
import Big from 'big.js';

// Python's Decimal context keeps 28 significant digits; big.js only bounds division.
Big.DP = 40;
Big.RM = Big.roundHalfUp;
Big.NE = -40;
Big.PE = 40;

export type Decimal = Big;

export const ZERO = new Big(0);

export function dec(value: Decimal | number | string): Decimal {
  if (value instanceof Big) return value;
  return new Big(typeof value === 'number' ? String(value) : value);
}

export function cents(value: Decimal): Decimal {
  return value.round(2, Big.roundHalfUp);
}

/** JSON-friendly number with exactly two decimals of precision (Python `num`). */
export function num(value: Decimal): number {
  return Number(cents(value).toString());
}

export function f(value: Decimal): number {
  return Number(value.toString());
}

/** `R$ 1.234,56` */
export function brl(value: Decimal | number | string): string {
  const v = cents(dec(value));
  const sign = v.lt(0) ? '-' : '';
  const [intPart, frac] = v.abs().toFixed(2).split('.');
  const groups: string[] = [];
  let integer = intPart;
  while (integer.length > 3) {
    groups.unshift(integer.slice(-3));
    integer = integer.slice(0, -3);
  }
  groups.unshift(integer);
  return `${sign}R$ ${groups.join('.')},${frac}`;
}

export function minBig(a: Decimal, b: Decimal): Decimal {
  return a.lte(b) ? a : b;
}

export function maxBig(a: Decimal, b: Decimal): Decimal {
  return a.gte(b) ? a : b;
}

/** Python's `format(x, 'g')` for the small magnitudes used in the UI (6 significant digits). */
export function gfmt(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value) && Math.abs(value) < 1e6) return String(value);
  const out = Number(value.toPrecision(6));
  return String(out);
}

/** Python's `f"{value:.Nf}"` on a float, via decimal half-up rounding. */
export function fixed(value: number | Decimal, places: number): string {
  return dec(typeof value === 'number' ? value : value).round(places, Big.roundHalfUp).toFixed(places);
}

/** Python's `round(x, n)` on a float — banker's rounding on the binary value. */
export function pyRound(value: number, places = 0): number {
  const factor = 10 ** places;
  const scaled = value * factor;
  const rounded = Math.round(scaled);
  // Ties go to even, like Python's round().
  const result = Math.abs(scaled - Math.trunc(scaled)) === 0.5 && rounded % 2 !== 0 ? rounded - Math.sign(scaled) : rounded;
  return result / factor;
}

export { Big };
