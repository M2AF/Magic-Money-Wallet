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

const INDEXER_WS: Record<'mainnet' | 'preprod', string> = {
  mainnet: 'wss://indexer.mainnet.midnight.network/api/v4/graphql/ws',
  preprod: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
}
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
  accountIndex: number,
  network: 'mainnet' | 'preprod' = 'mainnet'
): Promise<MidnightAddresses> {
  return deriveWithLedger(seed, accountIndex, network)
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
 * Fold the address's transaction stream into a NIGHT balance.
 *
 * ⚠ The FIRST `UnshieldedTransactionsProgress` marker is NOT a "caught up"
 * signal — verified live against the Preprod indexer (2026-07-22): it arrives
 * BEFORE the address's `UnshieldedTransaction` events, announcing the current
 * global tip id, not confirming replay of THIS address is done. A second,
 * repeat-value progress marker eventually confirms real catch-up, but only on
 * a ~30s server heartbeat — far past any balance-read UX budget. The actual
 * relevant transaction events consistently arrive within milliseconds of the
 * first progress marker, so instead of waiting for the (slow) confirming
 * marker, this debounces: resolve after a short QUIET_MS gap with no new
 * messages, which reliably lands right after the immediate event burst for
 * both funded and zero-history addresses. The original code resolved on the
 * FIRST progress marker and silently returned 0 for every funded address —
 * found by cross-checking against the wallet-sdk's own synced balance, which
 * showed a real nonzero balance this function was reporting as empty.
 */
export async function fetchMidnightBalance(
  unshieldedAddress: string | undefined,
  network: 'mainnet' | 'preprod' = 'mainnet'
): Promise<{ native: number; error: string | null }> {
  if (!unshieldedAddress) return { native: 0, error: 'coming-soon' }

  const QUIET_MS = 1_500

  return new Promise((resolve) => {
    let settled = false
    const utxos = new Map<string, bigint>()   // intentHash:outputIndex → Stars
    let quietTimer: ReturnType<typeof setTimeout> | null = null
    const finish = (result: { native: number; error: string | null }) => {
      if (settled) return
      settled = true
      if (quietTimer) clearTimeout(quietTimer)
      clearTimeout(timeoutTimer)
      try { ws.close() } catch { /* already closed */ }
      resolve(result)
    }
    const balance = () => Number([...utxos.values()].reduce((a, v) => a + v, 0n)) / STARS
    // Reset on every message after the first progress marker: as long as
    // events keep arriving, we're still mid-burst; QUIET_MS of silence means
    // the burst is over and the accumulated balance is final.
    const armQuiet = () => {
      if (quietTimer) clearTimeout(quietTimer)
      quietTimer = setTimeout(() => finish({ native: balance(), error: null }), QUIET_MS)
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(INDEXER_WS[network], 'graphql-transport-ws')
    } catch {
      resolve({ native: 0, error: 'Indexer unreachable' })
      return
    }
    const timeoutTimer = setTimeout(() => finish({ native: 0, error: 'Timed out' }), 20_000)

    ws.onopen = () => ws.send(JSON.stringify({ type: 'connection_init' }))
    ws.onerror = () => { finish({ native: 0, error: 'Indexer unreachable' }) }
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
        armQuiet()
        return
      }
      // Progress marker (first OR the slow confirming repeat) — either way,
      // arm/reset the quiet window rather than resolving immediately.
      armQuiet()
    }
  })
}
