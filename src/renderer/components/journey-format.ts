/** Base units -> a short human amount (at most 6 places); "< 0.000001" for dust, "—" when unknown. */
export function fmt(raw: string | null, decimals: number): string {
  if (!raw || !/^[0-9]+$/.test(raw)) return '—'
  const v = BigInt(raw), d = 10n ** BigInt(decimals)
  const n = Number(v / d) + Number(v % d) / Number(d)
  const places = Math.min(decimals, 6)
  if (v > 0n && n < 10 ** -places) return `< ${(10 ** -places).toFixed(places)}`
  return n.toLocaleString('en-US', { maximumFractionDigits: places })
}

/** Wei -> ETH with 4 significant digits, so small gas ceilings stay readable ("0.000001183 ETH"). */
export function ethAmount(wei: string | null): string {
  if (!wei || !/^[0-9]+$/.test(wei)) return 'unknown'
  const n = Number(BigInt(wei)) / 1e18
  return `${n.toLocaleString('en-US', { maximumSignificantDigits: 4, maximumFractionDigits: 18 })} ETH`
}
