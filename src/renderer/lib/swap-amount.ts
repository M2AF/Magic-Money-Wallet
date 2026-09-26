/**
 * swap-amount.ts — the 25% / 50% / 75% buttons on the swap's pay amount.
 *
 * A share of the holding is computed on the exact base units in BigInt (rounded
 * down, so it never exceeds the balance) and written back as a plain decimal
 * string: no float, no exponent notation, no trailing zeros. MAX keeps its own
 * fee-aware rule in DexSwapWidget; these partial amounts leave the rest of the
 * balance, so they need no gas reserve.
 */

export const SWAP_PERCENTS = [25, 50, 75] as const

/** Base units → exact decimal string ("1.5", "0.000001", "0"). */
export function rawToDecimalString(raw: bigint, decimals: number): string {
  if (raw <= 0n) return '0'
  const s = raw.toString().padStart(decimals + 1, '0')
  const int = s.slice(0, s.length - decimals)
  const frac = decimals > 0 ? s.slice(s.length - decimals).replace(/0+$/, '') : ''
  return frac ? `${int}.${frac}` : int
}

/** `pct`% of a raw balance, as the amount-field string. Invalid input → '0'. */
export function percentOfRaw(raw: string, pct: number, decimals: number): string {
  if (!/^[0-9]+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0) return '0'
  if (!Number.isInteger(pct) || pct <= 0 || pct > 100) return '0'
  return rawToDecimalString((BigInt(raw) * BigInt(pct)) / 100n, decimals)
}
