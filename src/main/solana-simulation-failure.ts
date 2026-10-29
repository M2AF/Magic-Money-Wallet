/** Decode only errors whose PROGRAM is known; Solana custom codes are not global. */
export function describeSolanaSimulationFailure(err: unknown, logs: string[]): string {
  const all = logs.join(' | ')
  // Read from Swift v2's deployed Anchor IDL on 2026-10-26:
  // program mayan34…, IDL 2qzWRSi3vRWtFwd7WRjvTUno5BPswFrH4H22fAZkmz5o.
  if (/Program mayan34VedncxdK2XobtvWFDXQASUTBXhUVzt2kKgny failed: custom program error: 0x1789\b/i.test(all)) {
    return 'Mayan rejected the amount reaching its bridge (AmountInTooSmall, 6025). '
      + 'The quoted source swap did not satisfy the bridge input requirement. Request a new route.'
  }
  if (
    /Program 11111111111111111111111111111111 failed: custom program error: 0x1\b/i.test(all)
    && /ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL/.test(all)
  ) {
    return 'This route needs more SOL to create a required token account and cover Solana network fees. '
      + 'Add SOL, then refresh the quote.'
  }
  // Anchor's actual diagnostic often precedes many consumed/failed wrapper lines.
  const diagnostic = logs.find(l => /AnchorError|Error Code:|Error Message:/.test(l))
  const tail = logs.slice(-3).join(' | ')
  return `${JSON.stringify(err)}${diagnostic ? ` — ${diagnostic}` : ''}${tail ? ` — ${tail}` : ''}`
}
