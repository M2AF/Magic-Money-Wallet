import { decodeCbor, CborMap } from './cardano-tx-inspect'
import { splitTxRoot, hexToBytesStrict } from './cardano-swap-validate'
import type { SwapSession } from '../shared/swap-session'

export class CardanoInputReservationError extends Error {}
export const inputRef = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}#(0|[1-9][0-9]*)$/.test(value)

/** Public output references only; never store transaction bytes or witnesses. */
export function cardanoSwapInputRefs(cbor: string): string[] {
  const body = decodeCbor(splitTxRoot(hexToBytesStrict(cbor)).body)
  const inputs = body instanceof CborMap ? body.getInt(0) : null
  if (!Array.isArray(inputs) || !inputs.length) throw new CardanoInputReservationError('The Cardano transaction has no readable spending inputs.')
  const refs = inputs.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 2 || !(entry[0] instanceof Uint8Array)
      || entry[0].length !== 32 || typeof entry[1] !== 'bigint' || entry[1] < 0n) {
      throw new CardanoInputReservationError('The Cardano transaction has an unreadable spending input.')
    }
    return `${Array.from(entry[0], b => b.toString(16).padStart(2, '0')).join('')}#${entry[1]}`
  })
  if (new Set(refs).size !== refs.length) throw new CardanoInputReservationError('The Cardano transaction repeats a spending input.')
  return refs
}

export function pendingCardanoSource(s: SwapSession): boolean {
  return s.fromChain === 'cardano' && !!s.sourceTxHash
    && (s.sourceTxState === 'submitted' || s.sourceTxState === 'uncertain')
    // Minswap's on-chain reader can establish inclusion through the order
    // lifecycle even when no separate source-receipt update was recorded.
    && !['source-confirmed', 'completed', 'partial', 'refunded'].includes(s.state)
}
