/**
 * midnight.ts — Midnight (NIGHT) address derivation + unshielded balance.
 *
 * Derivation was verified byte-for-byte against Lace (2026-07-13, mainnet):
 *   seed = BIP-39 seed (full 64 bytes) → @midnight-ntwrk/wallet-sdk-hd
 *   HDWallet.fromSeed(seed).selectAccount(a) → role key (index 0), then
 *     unshielded (NIGHT):  Roles.NightExternal → signingKeyFromBip340 →
 *                          signatureVerifyingKey → addressFromKey (32 bytes)
 *                          → bech32m 'mn_addr'
 *     shielded:            Roles.Zswap → ZswapSecretKeys.fromSeed →
 *                          coinPublicKey(32) || encryptionPublicKey(32)
 *                          → bech32m 'mn_shield-addr'
 *   Key crypto comes from @midnightntwrk/ledger-v9 (the Lace-era ledger; the
 *   older @midnight-ntwrk/zswap@4 derives a DIFFERENT coin key — do not use).
 *
 * NIGHT is an UNSHIELDED token on mainnet, so the balance is public and
 * queryable by address: the indexer streams an address's transaction history
 * over a graphql-transport-ws subscription; we fold created/spent UTXOs until
 * the caught-up progress marker and sum the native token (32 zero bytes).
 * 1 NIGHT = 1e6 Stars.
 *
 * ledger-v9 is WASM → lazy-imported, Electron main only (same doctrine as
 * monero-ts). The balance path is plain WebSocket/JSON and runs anywhere, but
 * the browser targets only get it once their stores carry a midnight address.
 * Sends are NOT implemented yet (need DUST fees + proof server + v2 tx build).
 */

const INDEXER_WS = 'wss://indexer.mainnet.midnight.network/api/v4/graphql/ws'
const STARS = 1e6                       // 1 NIGHT = 10^6 Stars
// nativeToken().raw from ledger-v9 — NIGHT's unshielded token type.
const NIGHT_TOKEN_TYPE = '0000000000000000000000000000000000000000000000000000000000000000'

export interface MidnightAddresses {
  unshielded: string   // mn_addr1… — where NIGHT lives (public balance)
  shielded: string     // mn_shield-addr1… — shielded receive
  dust: string         // mn_dust1… — the DUST fee identity (point DUST generation here)
}

// Per-target loader (the WASM + the ESM-only wallet-sdk-hd cannot load the same
// way everywhere):
//   Electron main    → ./midnight-ledger (dynamic import in Node — ESM ok)
//   extension SW     → aliased to ../extension/midnight-ledger (offscreen RPC —
//                      the SW itself can't import() a bare package)
//   Capacitor        → aliased to ../capacitor/midnight-ledger (lazy WASM chunk)
// Each loader does BOTH the wallet-sdk-hd role-key derivation and the ledger-v9
// address computation, so wallet-core never imports either package directly.
import { deriveWithLedger } from './midnight-ledger'

/**
 * Derive both Midnight addresses from the raw BIP-39 seed. The heavy lifting
 * (wallet-sdk-hd role keys + ledger-v9 address crypto) happens inside the
 * per-target loader; wallet-core only supplies the seed + account index.
 */
export async function deriveMidnightAddresses(
  seed: Uint8Array,
  accountIndex: number
): Promise<MidnightAddresses> {
  return deriveWithLedger(seed, accountIndex)
}

// ── DUST generation status (fee-resource balance) ─────────────────────────────
// DUST accrues to the wallet's mn_dust identity while the PAIRED Cardano wallet
// holds NIGHT (the Cardano-side registration made in the official DUST dApp).
// The indexer exposes the whole status keyed by the Cardano REWARD (stake)
// address — the same query the Nethermind DUST dashboard runs. Plain HTTPS
// GraphQL → safe in every runtime.

const INDEXER_HTTP = 'https://indexer.mainnet.midnight.network/api/v4/graphql'
const SPECKS = 1e15   // 1 DUST = 10^15 Specks (atomic unit)

export interface DustStatus {
  registered: boolean
  dust: number            // current DUST balance (currentCapacity)
  capacity: number        // max DUST this NIGHT holding can accrue
  nightOnCardano: number  // the paired Cardano wallet's NIGHT balance
  dustAddress: string | null
}

/**
 * DUST status for a Cardano stake address (bech32 stake1… ONLY — the indexer
 * bech32-decodes every entry and a non-bech32 string fails the WHOLE query
 * with "invalid Cardano reward address", verified live 2026-07-18).
 * Returns null when unregistered/unreachable.
 */
export async function fetchDustStatus(cardanoStake: string | null | undefined): Promise<DustStatus | null> {
  if (!cardanoStake?.startsWith('stake1')) return null
  const variants = [cardanoStake]

  try {
    const res = await fetch(INDEXER_HTTP, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query($a: [String!]!) { dustGenerationStatus(cardanoRewardAddresses: $a) {
          registered nightBalance generationRate currentCapacity maxCapacity dustAddress } }`,
        variables: { a: variants },
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    const json = await res.json() as {
      data?: { dustGenerationStatus?: Array<{ registered: boolean; nightBalance: string; currentCapacity: string; maxCapacity: string; dustAddress: string | null }> }
    }
    const entries = json.data?.dustGenerationStatus ?? []
    const hit = entries.find(e => e.registered) ?? null
    if (!hit) return null
    return {
      registered: true,
      dust: Number(hit.currentCapacity) / SPECKS,
      capacity: Number(hit.maxCapacity) / SPECKS,
      nightOnCardano: Number(hit.nightBalance) / STARS,
      dustAddress: hit.dustAddress,
    }
  } catch {
    return null
  }
}

// ── Unshielded NIGHT balance via indexer subscription ─────────────────────────

interface UnshieldedUtxoMsg { tokenType: string; value: string; intentHash: string; outputIndex: number }
interface SubMsg {
  type: string
  id?: string
  payload?: {
    data?: {
      unshieldedTransactions?: {
        __typename: 'UnshieldedTransaction' | 'UnshieldedTransactionsProgress'
        createdUtxos?: UnshieldedUtxoMsg[]
        spentUtxos?: UnshieldedUtxoMsg[]
        highestTransactionId?: number
      }
    }
    errors?: Array<{ message?: string }>
  }
}

/**
 * Fold the address's transaction stream into a NIGHT balance. The indexer
 * replays history and then emits a progress marker — that marker is our
 * "caught up" signal, so a fresh address resolves in one round-trip.
 */
export async function fetchMidnightBalance(
  unshieldedAddress: string | undefined
): Promise<{ native: number; error: string | null }> {
  if (!unshieldedAddress) return { native: 0, error: 'coming-soon' }

  return new Promise((resolve) => {
    let settled = false
    const utxos = new Map<string, bigint>()   // intentHash:outputIndex → Stars
    const finish = (result: { native: number; error: string | null }) => {
      if (settled) return
      settled = true
      try { ws.close() } catch { /* already closed */ }
      resolve(result)
    }
    const balance = () => Number([...utxos.values()].reduce((a, v) => a + v, 0n)) / STARS

    let ws: WebSocket
    try {
      ws = new WebSocket(INDEXER_WS, 'graphql-transport-ws')
    } catch {
      resolve({ native: 0, error: 'Indexer unreachable' })
      return
    }
    const timer = setTimeout(() => finish({ native: 0, error: 'Timed out' }), 20_000)

    ws.onopen = () => ws.send(JSON.stringify({ type: 'connection_init' }))
    ws.onerror = () => { clearTimeout(timer); finish({ native: 0, error: 'Indexer unreachable' }) }
    ws.onmessage = (ev: MessageEvent) => {
      let msg: SubMsg
      try { msg = JSON.parse(String(ev.data)) } catch { return }

      if (msg.type === 'connection_ack') {
        ws.send(JSON.stringify({
          id: '1',
          type: 'subscribe',
          payload: {
            query: `subscription($a: UnshieldedAddress!) { unshieldedTransactions(address: $a) {
              __typename
              ... on UnshieldedTransaction { createdUtxos { tokenType value intentHash outputIndex } spentUtxos { tokenType value intentHash outputIndex } }
              ... on UnshieldedTransactionsProgress { highestTransactionId } } }`,
            variables: { a: unshieldedAddress }
          }
        }))
        return
      }
      if (msg.type === 'error') {
        clearTimeout(timer)
        finish({ native: 0, error: msg.payload?.errors?.[0]?.message ?? 'Indexer error' })
        return
      }
      if (msg.type !== 'next') return

      const event = msg.payload?.data?.unshieldedTransactions
      if (!event) return
      if (event.__typename === 'UnshieldedTransaction') {
        for (const u of event.createdUtxos ?? []) {
          if (u.tokenType !== NIGHT_TOKEN_TYPE) continue
          utxos.set(`${u.intentHash}:${u.outputIndex}`, BigInt(u.value))
        }
        for (const u of event.spentUtxos ?? []) {
          utxos.delete(`${u.intentHash}:${u.outputIndex}`)
        }
        return
      }
      // Progress marker → history replay is caught up; snapshot the balance.
      clearTimeout(timer)
      finish({ native: balance(), error: null })
    }
  })
}
