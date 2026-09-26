/**
 * DexSwapWidget.tsx — Phantom-style swap with cross-chain auto-routing.
 *
 * Pick a FROM network/token and a TO network/token independently. When the two
 * networks match it's a same-chain swap (0x/1inch/Jupiter, best price); when they
 * differ it auto-routes cross-chain (LI.FI → Rango) — all via the proxy. The
 * wallet signs the source-chain tx locally (window.wallet.swapExecute) and, for
 * cross-chain, tracks bridge delivery (window.wallet.swapCrossStatus).
 *
 * Spending FROM Bitcoin/Cardano/Polkadot needs signing the executor doesn't have,
 * so those sources hand off to the Cross-Chain (SimpleSwap) tab.
 *
 * Same Phantom UX guards as before: gas preflight, 12s refresh w/ >0.5% re-accept,
 * auto-slippage, and a native dust buffer on Max.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { WalletAddresses, AllBalances, TokensResult, WalletToken, NormalizedSwapQuote, SwapToken, SwapChain } from '../types/wallet'
import { SWAP_TOKEN_LISTS, DEX_CHAINS, takerKeyForChain, isDexSignableSource } from '../types/swap-tokens'
import type { SwapNetworkOption } from '../types/wallet'
import { swapAssetKey } from '../../shared/swap-token-identity'
import { solanaShortfallMessage, maxSolSaleLamports } from '../../shared/solana-upfront-cost'
import { SwapQuoteCard } from './SwapQuoteCard'
import { SwapSettings } from './SwapSettings'
import { CrossChainStatusCard } from './CrossChainStatusCard'
import { TokenPicker } from './TokenPicker'

interface Props {
  addresses: WalletAddresses
  active: boolean
  onUseCrossChain?: () => void
  /** Pay token chosen from Portfolio → Tokens: select it and its network. */
  preselect?: { token: SwapToken; id: number } | null
  onPreselectHandled?: () => void
}

const STABLES = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'USDP'])
const BLUE_CHIP = new Set(['SOL', 'ETH'])
// Flat native-fee reserve per chain (human units) for the gas preflight + Max buffer.
const MIN_NATIVE_FEE: Record<string, number> = {
  ethereum: 0.003, arbitrum: 0.0004, optimism: 0.0004, base: 0.0004,
  polygon: 0.05, avalanche: 0.02, bsc: 0.002, monad: 0.05, solana: 0.001,
}

/** Every curated address per chain — the set whose symbols we are willing to trust. */
const CURATED_KEYS = new Set(
  Object.entries(SWAP_TOKEN_LISTS).flatMap(([chain, list]) =>
    list.map(t => swapAssetKey(chain, t.address))),
)

/**
 * Auto-slippage.
 *
 * The tight stablecoin tolerance keys on the token's ADDRESS being one we ship,
 * not on its symbol. Now that any token on the chain is selectable, a symbol is
 * attacker-chosen: minting a token called "USDC" costs a few cents, and quoting
 * it at 5 bps against a real stablecoin would hand the difference to whoever
 * built the pool. An unrecognised token gets the wide default instead.
 */
function getAutoSlippageBps(from: SwapToken | undefined, to: SwapToken | undefined): number {
  if (!from || !to) return 250
  const trusted = (t: SwapToken) => CURATED_KEYS.has(swapAssetKey(t.chain, t.address))
  if (trusted(from) && trusted(to) && STABLES.has(from.symbol) && STABLES.has(to.symbol)) return 5
  if (trusted(from) && BLUE_CHIP.has(from.symbol)) return 50
  return 250
}

function humanToRaw(human: string, decimals: number): string {
  if (!human || !(parseFloat(human) > 0)) return '0'
  const [i, f = ''] = human.split('.')
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals)
  const digits = ((i || '0').replace(/^0+/, '') || '0') + frac
  try { return BigInt(digits).toString() } catch { return '0' }
}
/**
 * Raw base units → a human number for DISPLAY only.
 *
 * The integer and fractional parts are divided separately in the BigInt domain:
 * `Number(BigInt(raw))` alone loses precision above 2^53, which a token with 18
 * decimals and a large supply passes easily.
 */
function rawToHuman(raw: string, decimals: number): number {
  if (!raw || !/^[0-9]+$/.test(raw)) return 0
  try {
    const v = BigInt(raw)
    const d = BigInt(10) ** BigInt(decimals)
    return Number(v / d) + Number(v % d) / Number(d)
  } catch { return 0 }
}

type ExecState = 'idle' | 'swapping' | 'success' | 'error'

export function DexSwapWidget({ addresses, active, onUseCrossChain, preselect, onPreselectHandled }: Props) {
  const [fromChain, setFromChain] = useState<SwapChain>('ethereum')
  const [toChain, setToChain] = useState<SwapChain>('ethereum')
  const [fromToken, setFromToken] = useState<SwapToken | undefined>(() => SWAP_TOKEN_LISTS.ethereum[0])
  const [toToken, setToToken] = useState<SwapToken | undefined>(() => SWAP_TOKEN_LISTS.ethereum[1])
  const [amount, setAmount] = useState('')
  /**
   * Networks the wallet says are swappable, joined from its own registry and the
   * measured capability matrix in the privileged layer. DEX_CHAINS is only the
   * pre-load fallback now: the hand-kept copy had drifted from the registry in
   * both directions (it offered BSC, which this wallet has no network for, and
   * omitted Robinhood Chain, Arc, Abstract and HyperEVM, which providers route).
   */
  const [networks, setNetworks] = useState<SwapNetworkOption[]>([])

  /** Holdings, for picker balances and so a held token needs no discovery to appear. */
  const [owned, setOwned] = useState<WalletToken[]>([])

  const [overrideBps, setOverrideBps] = useState<number | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [quote, setQuote] = useState<NormalizedSwapQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)

  const [nativeBal, setNativeBal] = useState<number>(0)
  /**
   * Native balance per chain, from ONE balances read. The receive picker needs
   * the DESTINATION chain's native balance; it used to be handed a literal 0,
   * so SOL showed no balance there even with SOL in the wallet. A chain missing
   * from this map is unknown (null), never zero.
   */
  const [nativeByChain, setNativeByChain] = useState<Record<string, number>>({})
  /** Bumped when a swap settles (or is dismissed), to re-read balances and holdings. */
  const [balanceNonce, setBalanceNonce] = useState(0)
  const refreshBalances = useCallback(() => setBalanceNonce(n => n + 1), [])
  const [fromBal, setFromBal] = useState<number | null>(null)

  const [refreshIn, setRefreshIn] = useState<number | null>(null)
  const [priceChanged, setPriceChanged] = useState(false)
  const acceptedBuyRaw = useRef<string | null>(null)

  const [execState, setExecState] = useState<ExecState>('idle')
  const [execResult, setExecResult] = useState<{ txHash: string; explorerUrl: string; approvalTxHash: string | null } | null>(null)
  const [execError, setExecError] = useState<string | null>(null)
  /** Destination token as it was at execution time (see run()). */
  const [executedTo, setExecutedTo] = useState<{ symbol: string; decimals: number } | null>(null)

  // Set true on (re)mount AND clear on unmount. Without the explicit `= true`, React
  // StrictMode's dev-only mount→cleanup→mount cycle leaves it stuck `false`, which
  // silently dropped every quote result and froze the button on "Fetching quote…"
  // (desktop dev only; the production extension build has no StrictMode double-invoke).
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const isAuto = overrideBps === null
  const autoBps = getAutoSlippageBps(fromToken, toToken)
  const slippageBps = isAuto ? autoBps : overrideBps

  // A different account means different balances and holdings: re-read them,
  // and drop any quote, which was priced for the previous account.
  const accountKey = `${addresses.accountIndex ?? 0}|${addresses.evm ?? ''}|${addresses.solana ?? ''}`
  const lastAccount = useRef(accountKey)
  useEffect(() => {
    if (lastAccount.current === accountKey) return
    lastAccount.current = accountKey
    setOwned([]); setAmount('')
    setQuote(null); setQuoteError(null); acceptedBuyRaw.current = null; setPriceChanged(false)
  }, [accountKey])

  const sourceSignable = isDexSignableSource(fromChain)
  const isCrossChain = fromChain !== toChain
  const addrFor = useCallback((c: SwapChain) => addresses[takerKeyForChain(c)], [addresses])
  /**
   * Numeric EVM chain id for a wallet chain-id STRING, from the resolver's
   * registry join. Built-ins resolve through the same per-provider maps the
   * Worker already has, so this is only load-bearing for an IMPORTED network —
   * see SwapQuoteRequest.fromChainId.
   */
  const chainIdFor = useCallback(
    (c: SwapChain) => networks.find(n => n.id === c)?.chainId ?? undefined, [networks])

  /**
   * Chains offered on one side of the swap. A network the wallet reports as
   * unswappable is left out entirely rather than shown and then refused — the
   * reason travels with the quote error if one is somehow requested anyway.
   */
  const networkOptions = (side: 'source' | 'destination') => {
    const usable = networks.filter(n => (side === 'source' ? n.source : n.destination))
    return usable.length
      ? usable.map(n => ({ id: n.id as SwapChain, label: n.label }))
      : DEX_CHAINS
  }

  const clearQuote = () => { setQuote(null); setQuoteError(null); acceptedBuyRaw.current = null; setPriceChanged(false) }

  // ── Network change handlers (reset the picked token; keep from/to distinct) ──
  const sameToken = (a: SwapToken | undefined, b: SwapToken | undefined) =>
    !!a && !!b && swapAssetKey(a.chain, a.address) === swapAssetKey(b.chain, b.address)

  const onFromChain = (c: SwapChain) => {
    setFromChain(c)
    const list = SWAP_TOKEN_LISTS[c] ?? []
    const next = list[0]
    setFromToken(next)
    if (c === toChain && next) {
      setToToken(prev => sameToken(prev, next) ? list.find(t => !sameToken(t, next)) : prev)
    }
    setAmount(''); clearQuote()
  }
  const onToChain = (c: SwapChain) => {
    setToChain(c)
    const list = SWAP_TOKEN_LISTS[c] ?? []
    let next: SwapToken | undefined = list[0]
    if (c === fromChain && sameToken(next, fromToken)) next = list.find(t => !sameToken(t, fromToken))
    setToToken(next)
    clearQuote()
  }

  // ── Portfolio → Tokens "Swap": that coin, on its own network, as the pay token ──
  useEffect(() => {
    if (!preselect) return
    const token = preselect.token
    const chain = token.chain
    setFromChain(chain)
    setFromToken(token)
    // Keep the receive side distinct: the same coin can't be both sides.
    if (chain === toChain && sameToken(token, toToken)) {
      const list = SWAP_TOKEN_LISTS[chain] ?? []
      setToToken(list.find(t => !sameToken(t, token)))
    }
    setAmount(''); clearQuote()
    onPreselectHandled?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect?.id])

  // ── Load balances (native + from-token) on the SOURCE chain ────────────────
  useEffect(() => {
    if (!active) return
    let on = true
    ;(async () => {
      try {
        const bals: AllBalances = await window.wallet.getBalances()
        if (!on) return
        const byChain: Record<string, number> = {}
        for (const [c, b] of Object.entries(bals.chains ?? {})) {
          const v = parseFloat((b as { native?: string } | undefined)?.native ?? '')
          if (Number.isFinite(v)) byChain[c] = v
        }
        setNativeByChain(byChain)
        setNativeBal(byChain[fromChain] ?? 0)
      } catch { /* ignore */ }
    })()
    return () => { on = false }
  }, [fromChain, active, balanceNonce, accountKey])

  // Settle anything a previous session left mid-bridge. The status card only
  // lives while this screen shows it, so a swap left bridging (navigation, app
  // restart) never reached a final state in the persisted record. Reconciling
  // reads provider status and records outcomes; it never signs anything.
  useEffect(() => {
    if (!active) return
    window.wallet.swapReconcile?.().then(() => refreshBalances()).catch(() => { /* evidence store; never blocks swaps */ })
  }, [active, refreshBalances])

  useEffect(() => {
    if (!active) return
    let on = true
    ;(async () => {
      try {
        const list = await window.wallet.swapGetNetworks()
        if (on && Array.isArray(list)) setNetworks(list)
      } catch { /* the bundled fallback below still renders a usable picker */ }
    })()
    return () => { on = false }
  }, [active])

  // Holdings feed both the sell balance and the picker (a token you already hold
  // is selectable even when no provider lists it).
  useEffect(() => {
    if (!active) return
    let on = true
    ;(async () => {
      try {
        const res: TokensResult = await window.wallet.getTokens()
        // Holdings in the Abstract Global Wallet are a SEPARATE smart account
        // that the swap signer (your Abstract EOA) cannot spend. Listing them
        // here showed that balance as swappable, then the route — quoted and
        // signed for the EOA, which held none — reverted in simulation.
        if (on) setOwned((res.tokens ?? []).filter(t => t.source !== 'agw'))
      } catch { /* picker falls back to curated entries */ }
    })()
    return () => { on = false }
  }, [active, balanceNonce, accountKey])

  useEffect(() => {
    if (!fromToken) { setFromBal(null); return }
    if (fromToken.isNative) { setFromBal(nativeBal); return }
    // Match on the chain-qualified key, NOT a blanket .toLowerCase(): lowercasing a
    // Solana mint produces a string that matches nothing, so every SPL balance read
    // as zero. And the exact holding comes from `rawBalance` — `balance` is a
    // comma-grouped DISPLAY string, so parseFloat("1,234.5") silently yields 1.
    const want = swapAssetKey(fromChain, fromToken.address)
    const match = owned.find(t => t.chain === fromChain && swapAssetKey(fromChain, t.contractAddress) === want)
    if (!match) { setFromBal(0); return }
    setFromBal(rawToHuman(match.rawBalance ?? '0', match.decimals))
  }, [fromToken, fromChain, nativeBal, owned])

  // ── Quote fetch ───────────────────────────────────────────────────────────
  const fetchQuote = useCallback(async (silent = false): Promise<NormalizedSwapQuote | null> => {
    if (!fromToken || !toToken) return null
    if (!(parseFloat(amount) > 0)) return null
    if (sameToken(fromToken, toToken)) return null
    if (!silent) { setFetching(true); setQuoteError(null) }
    try {
      const r = await window.wallet.swapGetQuote({
        fromChain, toChain,
        fromToken: fromToken.address, toToken: toToken.address,
        fromSymbol: fromToken.symbol, toSymbol: toToken.symbol,
        sellAmountRaw: humanToRaw(amount, fromToken.decimals),
        slippageBps, taker: addrFor(fromChain), toAddress: addrFor(toChain),
        fromDecimals: fromToken.decimals, toDecimals: toToken.decimals,
        fromChainId: chainIdFor(fromChain), toChainId: chainIdFor(toChain),
      })
      if (!alive.current) return null
      if (r.error || !r.quote) { if (!silent) setQuoteError(r.error ?? 'No route available.'); return null }
      return r.quote
    } catch (e) {
      if (!silent) setQuoteError(e instanceof Error ? e.message : 'Quote failed')
      return null
    } finally {
      if (!silent && alive.current) setFetching(false)
    }
  }, [amount, fromChain, toChain, fromToken, toToken, slippageBps, addrFor, chainIdFor])

  const getQuote = async () => {
    setPriceChanged(false)
    const q = await fetchQuote(false)
    if (q) { setQuote(q); acceptedBuyRaw.current = q.buyAmountRaw }
  }

  // ── Guard 2: 12s refresh ticker ───────────────────────────────────────────
  useEffect(() => {
    if (!quote || priceChanged || execState !== 'idle' || !active) { setRefreshIn(null); return }
    setRefreshIn(12)
    const countdown = setInterval(() => setRefreshIn(s => (s != null && s > 0 ? s - 1 : s)), 1000)
    const refresh = setInterval(async () => {
      const q = await fetchQuote(true)
      if (!q || !alive.current) return
      const prev = acceptedBuyRaw.current
      const dec = toToken?.decimals ?? 18
      const dropped = prev ? rawToHuman(q.buyAmountRaw, dec) < rawToHuman(prev, dec) * 0.995 : false
      if (dropped) { setQuote(q); setPriceChanged(true) }
      else { setQuote(q); acceptedBuyRaw.current = q.buyAmountRaw; setRefreshIn(12) }
    }, 12_000)
    return () => { clearInterval(countdown); clearInterval(refresh) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, priceChanged, execState, active, fetchQuote, toToken?.decimals])

  const acceptNewPrice = () => { if (quote) { acceptedBuyRaw.current = quote.buyAmountRaw; setPriceChanged(false) } }

  // ── Guard 4: Max with native dust buffer ──────────────────────────────────
  const onMax = async () => {
    if (fromBal == null) return
    if (fromToken?.isNative && fromChain === 'solana' && toToken) {
      // Solana: leave exactly what THIS route needs besides the sale — fees and
      // any new or temporary token accounts at current rent — computed by the
      // privileged layer from a quote for the full balance. The same record then
      // drives the button and the pre-signing check, so all three agree.
      const lamports = BigInt(Math.floor(fromBal * 1e9))
      try {
        const r = await window.wallet.swapGetQuote({
          fromChain, toChain, fromToken: fromToken.address, toToken: toToken.address,
          fromSymbol: fromToken.symbol, toSymbol: toToken.symbol, sellAmountRaw: lamports.toString(),
          slippageBps, taker: addrFor(fromChain), toAddress: addrFor(toChain),
          fromDecimals: fromToken.decimals, toDecimals: toToken.decimals,
          fromChainId: chainIdFor(fromChain), toChainId: chainIdFor(toChain),
        })
        const cost = r.quote?.solanaCost
        if (cost?.balanceLamports != null) {
          const max = maxSolSaleLamports(cost, BigInt(cost.balanceLamports))
          setAmount(max > 0n ? (Number(max) / 1e9).toFixed(9).replace(/0+$/, '').replace(/\.$/, '') : '0')
          setQuote(null); acceptedBuyRaw.current = null
          return
        }
      } catch { /* fall through to the conservative reserve below */ }
    }
    if (fromToken?.isNative) {
      // No cost record for this route: a conservative reserve. The quote that
      // follows, and the pre-signing check, still judge the real requirement.
      const buffer = (MIN_NATIVE_FEE[fromChain] ?? 0.001) * 1.5
      const safe = Math.max(0, fromBal - buffer)
      setAmount(safe > 0 ? String(safe) : '0')
    } else {
      setAmount(String(fromBal))
    }
    setQuote(null); acceptedBuyRaw.current = null
  }

  const flip = () => {
    const nfc = toChain, ntc = fromChain, nft = toToken, ntt = fromToken
    setFromChain(nfc); setToChain(ntc); setFromToken(nft); setToToken(ntt)
    setAmount(''); clearQuote()
  }

  // ── Guard 1: gas preflight (source chain) ─────────────────────────────────
  const feeReserve = MIN_NATIVE_FEE[fromChain] ?? 0.001
  const sellHuman = parseFloat(amount) || 0
  const nativeSpend = fromToken?.isNative ? sellHuman : 0
  // Solana: judged against the quote's own cost record, with the SAME shared
  // rule and wording the pre-signing check uses. Other chains: the flat reserve.
  const solanaShortfall = quote?.solanaCost ? solanaShortfallMessage(quote.solanaCost) : null
  const insufficientGas = !!quote && (quote.solanaCost
    ? solanaShortfall != null
    : nativeBal < nativeSpend + feeReserve)

  const run = async () => {
    if (!quote || !toToken) return
    setExecState('swapping'); setExecError(null); setExecResult(null)
    // Freeze the destination token: the tracker below formats the RECEIVED amount
    // with these decimals, and the user can change the picker while a cross-chain
    // swap is still bridging.
    setExecutedTo({ symbol: toToken.symbol, decimals: toToken.decimals })
    try {
      const r = await window.wallet.swapExecute(quote)
      if (!alive.current) return
      setExecResult(r); setExecState('success')
      if (!quote.isCrossChain) {
        // Same-chain settles in the source transaction. Solana returns once it is
        // confirmed; an EVM swap returns at broadcast and is mined shortly after,
        // so read again once it has had time to land.
        refreshBalances()
        setTimeout(() => { if (alive.current) refreshBalances() }, 15_000)
      }
    } catch (e) {
      if (!alive.current) return
      setExecError(e instanceof Error ? e.message : 'Swap failed'); setExecState('error')
    }
  }

  const reset = () => {
    setExecState('idle'); setExecResult(null); setExecError(null); setQuote(null); setAmount(''); acceptedBuyRaw.current = null
    refreshBalances()
  }

  const expectedBuy = quote && toToken ? rawToHuman(quote.buyAmountRaw, toToken.decimals) : null
  const canQuote = parseFloat(amount) > 0 && !!fromToken && !!toToken && !sameToken(fromToken, toToken) && !fetching && sourceSignable

  // ── Cross-chain success → bridge tracker ──────────────────────────────────
  if (execState === 'success' && execResult && quote?.isCrossChain) {
    return (
      <CrossChainStatusCard
        quote={quote}
        txHash={execResult.txHash}
        explorerUrl={execResult.explorerUrl}
        toSymbol={executedTo?.symbol ?? quote.toTokenSymbol}
        toDecimals={executedTo?.decimals ?? 18}
        onDone={reset}
        onSettled={refreshBalances}
      />
    )
  }

  // ── Button ────────────────────────────────────────────────────────────────
  function renderButton() {
    if (execState === 'success' && execResult) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>✓ Swap submitted</div>
          {execResult.approvalTxHash && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Approval mined ✓</div>}
          <a href={execResult.explorerUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}>View transaction ↗</a>
          <button type="button" onClick={reset} style={btn(true, 'transparent')}>Done</button>
        </div>
      )
    }
    if (execState === 'error') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#fca5a5', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>{execError}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={run} style={{ ...btn(true), flex: 1 }}>Retry</button>
            <button type="button" onClick={reset} style={{ ...btn(true, 'transparent'), flex: 1 }}>Close</button>
          </div>
        </div>
      )
    }
    if (execState === 'swapping') {
      return <button type="button" disabled style={btn(false)}><Spinner /> Swapping…{quote?.approvalTx ? ' (approving first)' : ''}</button>
    }
    if (!quote) {
      return <button type="button" onClick={getQuote} disabled={!canQuote} style={btn(canQuote)}>{fetching ? 'Fetching quote…' : 'Get Quote'}</button>
    }
    if (priceChanged) {
      return <button type="button" onClick={acceptNewPrice} style={btn(true, '#facc15', '#0d0d0d')}>Accept New Price</button>
    }
    if (insufficientGas) {
      return (
        <>
          <button type="button" disabled style={btn(false)}>
            Not enough {nativeSymbolFor(fromChain)} {solanaShortfall ? 'for this route' : 'for fee'}
          </button>
          {solanaShortfall && (
            <div role="alert" style={{ fontSize: 12, color: '#fca5a5', lineHeight: 1.5 }}>{solanaShortfall}</div>
          )}
        </>
      )
    }
    const verb = isCrossChain ? 'Swap cross-chain' : 'Swap'
    return <button type="button" onClick={run} style={btn(true)}>{verb} {fromToken?.symbol} → {toToken?.symbol}</button>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* YOU PAY */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={labelStyle}>YOU PAY</span>
          <select aria-label="From network" value={fromChain} onChange={e => onFromChain(e.target.value as SwapChain)} style={netSelectStyle}>
            {networkOptions('source').map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="number" inputMode="decimal" min="0" placeholder="0.0" value={amount}
            onChange={e => { setAmount(e.target.value); setQuote(null); acceptedBuyRaw.current = null }}
            disabled={!sourceSignable}
            style={{ ...inputStyle, flex: 1, fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-display)' }} />
          <TokenPicker
            chain={fromChain}
            value={fromToken}
            onSelect={t => { setFromToken(t); setAmount(''); clearQuote() }}
            owned={owned}
            nativeBalance={nativeByChain[fromChain] ?? null}
            label="Pay token"
            disabled={!sourceSignable}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {fromBal != null
            ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Balance: {fromBal.toLocaleString('en-US', { maximumFractionDigits: 6 })} {fromToken?.symbol}</span>
            : <span />}
          {fromBal != null && sourceSignable && <button type="button" onClick={onMax} style={maxBtn}>MAX</button>}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button type="button" onClick={flip} title="Flip" style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="7 10 12 5 17 10" /><polyline points="17 14 12 19 7 14" /></svg>
        </button>
      </div>

      {/* YOU RECEIVE */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={labelStyle}>YOU RECEIVE</span>
          <select aria-label="To network" value={toChain} onChange={e => onToChain(e.target.value as SwapChain)} style={netSelectStyle}>
            {networkOptions('destination').map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-display)', color: expectedBuy != null ? 'var(--text-primary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {expectedBuy != null ? expectedBuy.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'}
          </div>
          <TokenPicker
            chain={toChain}
            value={toToken}
            onSelect={t => { setToToken(t); clearQuote() }}
            owned={owned}
            nativeBalance={nativeByChain[toChain] ?? null}
            label="Receive token"
          />
        </div>
      </div>

      {/* Source not locally signable → hand off to SimpleSwap */}
      {!sourceSignable && (
        <div style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
            Spending from <strong>{fromToken?.symbol}</strong> on {fromChain} uses the Cross-Chain exchange (deposit-address flow).
          </div>
          {onUseCrossChain && (
            <button type="button" onClick={onUseCrossChain} style={btn(true, 'rgba(56,189,248,0.9)', '#04121d')}>Switch to Cross-Chain</button>
          )}
        </div>
      )}

      {sourceSignable && (
        <SwapSettings open={showAdvanced} onToggle={() => setShowAdvanced(v => !v)} slippageBps={slippageBps} autoBps={autoBps} isAuto={isAuto} onSet={setOverrideBps} />
      )}

      {quoteError && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 12, color: '#fca5a5' }}>{quoteError}</div>
      )}

      {quote && fromToken && toToken && (
        <SwapQuoteCard quote={quote} fromSymbol={fromToken.symbol} toSymbol={toToken.symbol} fromDecimals={fromToken.decimals} toDecimals={toToken.decimals} autoBps={autoBps} isAuto={isAuto} refreshIn={refreshIn} priceChanged={priceChanged} />
      )}

      {sourceSignable && renderButton()}
    </div>
  )
}

// ── small helpers / styles ────────────────────────────────────────────────────

function nativeSymbolFor(chain: string): string {
  return SWAP_TOKEN_LISTS[chain as SwapChain]?.find(t => t.isNative)?.symbol ?? 'gas'
}
const Spinner = () => <span style={{ width: 14, height: 14, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#0d0d0d', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite', marginRight: 6, verticalAlign: 'middle' }} />

const cardStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }
const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em' }
const inputStyle: React.CSSProperties = { background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', color: 'var(--text-primary)', fontSize: 14, outline: 'none', minWidth: 0 }
const netSelectStyle: React.CSSProperties = { background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '5px 8px', fontSize: 12, cursor: 'pointer', outline: 'none', flexShrink: 0 }
const maxBtn: React.CSSProperties = { padding: '2px 10px', borderRadius: 99, fontSize: 10, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--accent-dim)', color: 'var(--accent)' }
function btn(enabled: boolean, bg = 'var(--accent)', color = '#0d0d0d'): React.CSSProperties {
  return { padding: '13px', borderRadius: 'var(--radius-sm)', border: bg === 'transparent' ? '1px solid var(--border)' : 'none', fontSize: 14, fontWeight: 700, cursor: enabled ? 'pointer' : 'not-allowed', background: enabled ? bg : 'var(--border)', color: enabled ? (bg === 'transparent' ? 'var(--text-primary)' : color) : 'var(--text-muted)', width: '100%' }
}
