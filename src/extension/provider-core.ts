/**
 * provider-core.ts — the injected wallet provider suite, transport-agnostic
 *
 * Everything that runs in a dApp page's MAIN-world context: EIP-1193 +
 * EIP-6963 window.ethereum, window.solana + Wallet Standard, CIP-30
 * window.cardano.magicmoney (plus the VESPR-authorized `vespr` compatibility
 * key), window.unisat / sats-connect, window.injectedWeb3.
 *
 * Extracted from inject.ts so two shells can install it:
 *  - Extension: inject.ts (window.postMessage ↔ content.ts ↔ service worker)
 *  - Android:   src/capacitor/dapp-inject.ts (WebMessageListener __mmBridge ↔
 *               native DappBrowser plugin ↔ wallet WebView)
 * The shell provides the transport; nothing here touches chrome.* or the bridge.
 */

import { WALLET_ICON } from './wallet-icon'

export interface ProviderTransport {
  /** Send a wallet RPC (one of PAGE_RPC_TYPES) and await the result. */
  send<T = unknown>(type: string, args: unknown[]): Promise<T>
  /** Subscribe to wallet push events (chain: 'eth', event: e.g. 'chainChanged'). */
  onEvent(cb: (chain: string, event: string, data: unknown) => void): void
}

export function installProviders(transport: ProviderTransport): void {

const send = <T = unknown>(type: string, args: unknown[]): Promise<T> => transport.send<T>(type, args)

// ── EIP-1193 window.ethereum ──────────────────────────────────────────────────

const _ethListeners: Record<string, Array<(...a: unknown[]) => void>> = {}

function emitEth(event: string, ...args: unknown[]) {
  for (const cb of _ethListeners[event] ?? []) try { cb(...args) } catch { /* noop */ }
}

transport.onEvent((chain, event, data) => {
  if (chain !== 'eth') return
  emitEth(event, data)
  // Update OUR provider object (not window.ethereum, which may belong to another
  // wallet in a multi-wallet browser, or be locked).
  if (event === 'chainChanged') {
    ;(mmEthereum as Record<string, unknown>).chainId = data
    ;(mmEthereum as Record<string, unknown>).networkVersion = String(parseInt(data as string, 16))
  }
  if (event === 'accountsChanged') {
    ;(mmEthereum as Record<string, unknown>).selectedAddress = (data as string[])[0] ?? null
  }
})

const mmEthereum = {
  isMetaMask:      true,
  isMagicMoney:    true,
  chainId:         '0x1',
  selectedAddress: null,
  networkVersion:  '1',

  request({ method, params }: { method: string; params?: unknown[] }) {
    const p = send('web3:request', [{ method, params: params ?? [] }])
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
      // On success, reflect the new chain on the provider SYNCHRONOUSLY (the background
      // emits chainChanged separately) so a dApp reading provider.chainId right after the
      // switch resolves sees the new value — the race behind "Switch Network does nothing".
      return p.then((result) => {
        const reqChain = (params as Array<{ chainId?: string }> | undefined)?.[0]?.chainId
        if (typeof reqChain === 'string') {
          ;(mmEthereum as Record<string, unknown>).chainId = reqChain
          ;(mmEthereum as Record<string, unknown>).networkVersion = String(parseInt(reqChain, 16))
        }
        return result
      })
    }
    return p
  },
  on(event: string, cb: (...a: unknown[]) => void) {
    if (!_ethListeners[event]) _ethListeners[event] = []
    _ethListeners[event].push(cb)
  },
  removeListener(event: string, cb: (...a: unknown[]) => void) {
    if (_ethListeners[event]) _ethListeners[event] = _ethListeners[event].filter(l => l !== cb)
  },
  send(method: string, params: unknown[]) { return this.request({ method, params }) },
  sendAsync(req: { method: string; params?: unknown[] }, cb: (e: Error | null, r: unknown) => void) {
    this.request(req)
      .then((r) => cb(null, { id: 1, jsonrpc: '2.0', result: r }))
      .catch((e: Error) => cb(e, null))
  },
  enable() { return this.request({ method: 'eth_requestAccounts', params: [] }) },
}

// Best-effort install on window.ethereum. In a multi-wallet browser another wallet
// (MetaMask/Phantom) may have already defined it as read-only — that assignment
// would THROW and, since this is a top-level statement, abort the ENTIRE script
// (Solana/Cardano/unisat/Polkadot AND the EIP-6963 announce below), leaving
// MagicMoney undiscoverable. Swallow the failure: modern dApps (nad.fun, OpenSea)
// find us through the EIP-6963 announce regardless of who owns window.ethereum.
try {
  Object.defineProperty(window, 'ethereum', { value: mmEthereum, writable: true, configurable: true })
} catch {
  try { (window as unknown as Record<string, unknown>).ethereum = mmEthereum } catch { /* locked — EIP-6963 only */ }
}

// ── window.solana ─────────────────────────────────────────────────────────────

const mmSolana = {
  isMagicMoney: true,
  isConnected:  false,
  publicKey:    null as string | null,

  connect() {
    return send<string>('web3:solana:connect', []).then((pk) => {
      ;(this as Record<string, unknown>).publicKey = pk
      ;(this as Record<string, unknown>).isConnected = true
      return { publicKey: { toBase58: () => pk, toString: () => pk } }
    })
  },
  disconnect() {
    ;(this as Record<string, unknown>).publicKey = null
    ;(this as Record<string, unknown>).isConnected = false
    return Promise.resolve()
  },
  signMessage(message: Uint8Array) {
    return send<number[]>('web3:solana:sign', [Array.from(message)])
      .then((sig) => ({ signature: new Uint8Array(sig) }))
  },
  signTransaction(transaction: unknown) {
    let bytes: number[]
    const tx = transaction as { serialize?: (o?: unknown) => Uint8Array }
    if (typeof tx?.serialize === 'function') {
      bytes = Array.from(tx.serialize({ requireAllSignatures: false }))
    } else if (transaction instanceof Uint8Array) {
      bytes = Array.from(transaction)
    } else {
      throw new Error('Cannot serialize transaction')
    }
    return send<number[]>('web3:solana:sign-tx', [bytes]).then(signed => new Uint8Array(signed))
  },
  signAllTransactions(transactions: unknown[]) {
    return Promise.all(transactions.map((tx) => this.signTransaction(tx)))
  },
  on(_event: string, _cb: (...a: unknown[]) => void) { /* future */ },
  removeListener(_event: string, _cb: (...a: unknown[]) => void) { /* future */ },
}

// Only claim legacy window.solana if no other wallet (e.g. Phantom) owns it, and
// never throw if it's locked — Solana dApps discover us via Wallet Standard below.
if (typeof (window as unknown as Record<string, unknown>).solana === 'undefined') {
  try { (window as unknown as Record<string, unknown>).solana = mmSolana } catch { /* locked by another wallet */ }
}

// ── CIP-30 window.cardano.magicmoney + VESPR compatibility key ───────────────

function makeCardanoFullApi() {
  return {
    getNetworkId:       ()                              => send('cardano:get-network-id', []),
    getBalance:         ()                              => send('cardano:get-balance', []),
    getUtxos:           ()                              => send('cardano:get-utxos', []),
    getUsedAddresses:   ()                              => send('cardano:get-used-addresses', []),
    getUnusedAddresses: ()                              => send('cardano:get-unused-addresses', []),
    getChangeAddress:   ()                              => send('cardano:get-change-address', []),
    getRewardAddresses: ()                              => send('cardano:get-reward-addresses', []),
    getCollateral:      (p?: { amount?: string })       => send('cardano:get-collateral', [p?.amount]),
    signTx:             (tx: string, partial = false)   => send('cardano:sign-tx', [tx, partial]),
    signData:           (addr: string, payload: string) => send('cardano:sign-data', [addr, payload]),
    submitTx:           (tx: string)                    => send('cardano:submit-tx', [tx]),
    experimental: {
      getCollateral:    (p?: { amount?: string })       => send('cardano:get-collateral', [p?.amount]),
    },
  }
}

function installVesprCompatibilityBranding(cardano: Record<string, unknown>, mmWallet: object) {
  const hostname = window.location?.hostname
  if (hostname !== 'app.strikefinance.org' && hostname !== 'app.dexhunter.io') return
  if (cardano.vespr !== mmWallet || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return

  const applyBranding = () => {
    // Stop touching the page if a genuine VESPR extension takes ownership of
    // its provider key after MagicMoney was injected.
    if (cardano.vespr !== mmWallet) return

    for (const image of document.querySelectorAll<HTMLImageElement>('img[alt="Vespr"], img[alt="Vespr wallet"]')) {
      const source = `${image.getAttribute('src') ?? ''} ${image.getAttribute('srcset') ?? ''}`
      if (!source.toLowerCase().includes('vespr')) continue

      image.alt = 'MagicMoney Wallet'
      image.removeAttribute('srcset')
      image.src = WALLET_ICON
      image.dataset.magicMoneyVesprBrand = 'true'

      const scope = hostname === 'app.dexhunter.io'
        ? image.parentElement?.parentElement
        : image.closest('button, [role="dialog"]') ?? image.parentElement?.parentElement
      if (!scope) continue
      for (const element of scope.querySelectorAll<HTMLElement>('span, p, div, h1, h2, h3')) {
        if (element.children.length > 0) continue
        const text = element.textContent?.trim()
        if (text === 'Vespr') element.textContent = 'MagicMoney Wallet'
        else if (/^Connecting to Vespr(?:\.{3}|…)?$/i.test(text ?? '')) {
          element.textContent = 'Connecting to MagicMoney Wallet...'
        }
      }
    }
  }

  applyBranding()
  new MutationObserver(applyBranding).observe(document.documentElement ?? document, {
    childList: true,
    subtree: true,
  })
}

try {
  const w = window as unknown as Record<string, unknown>
  if (!w.cardano || typeof w.cardano !== 'object') w.cardano = {}
  const cardano = w.cardano as Record<string, unknown>
  const mmWallet = {
    apiVersion: '0.1.0',
    name:       'MagicMoney Wallet',
    icon:       WALLET_ICON,
    isEnabled:  () => send<boolean>('cardano:is-enabled', []).catch(() => false),
    enable:     () => send('cardano:enable', []).then(() => makeCardanoFullApi()),
  }
  cardano.magicmoney = mmWallet
  // VESPR authorized this compatibility key for dApps that whitelist only
  // `window.cardano.vespr`. Keep MagicMoney's identity and security flow, and
  // never replace the genuine VESPR provider when its extension is installed.
  if (typeof cardano.vespr === 'undefined') cardano.vespr = mmWallet
  installVesprCompatibilityBranding(cardano, mmWallet)
} catch (e) {
  console.warn('[MagicMoney] CIP-30 injection error:', e)
}

// ── Solana Wallet Standard ────────────────────────────────────────────────────
// Required for Magic Eden and other modern Solana dApps (wallet-standard protocol)

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function b58Decode(s: string): Uint8Array {
  const bytes = [0]
  for (const c of s) {
    let carry = B58.indexOf(c)
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8 }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8 }
  }
  for (const c of s) { if (c === '1') bytes.push(0); else break }
  return new Uint8Array(bytes.reverse())
}

let _wsAddress:   string | null     = null
let _wsPublicKey: Uint8Array | null = null
const _wsListeners: Record<string, Array<(d: unknown) => void>> = {}

function _wsEmit(event: string, data: unknown) {
  for (const cb of _wsListeners[event] ?? []) try { cb(data) } catch { /* noop */ }
}

function _wsAccount() {
  return {
    address:   _wsAddress!,
    publicKey: _wsPublicKey!,
    chains:    ['solana:mainnet', 'solana:devnet'] as const,
    features:  ['standard:connect', 'standard:disconnect', 'standard:events',
                'solana:signAndSendTransaction', 'solana:signMessage'] as const,
  }
}

const _wsMagicMoney = {
  version: '1.0.0',
  name:    'MagicMoney Wallet',
  icon:    WALLET_ICON,
  chains:  ['solana:mainnet', 'solana:devnet'] as const,
  features: {
    'standard:connect': {
      version: '1.0.0',
      async connect({ silent = false }: { silent?: boolean } = {}) {
        if (silent && !_wsAddress) return { accounts: [] }
        const pk = await send<string>('web3:solana:connect', [])
        _wsAddress = pk
        _wsPublicKey = b58Decode(pk)
        // Sync legacy window.solana
        const sol = (window as unknown as Record<string, unknown>).solana as Record<string, unknown>
        sol.publicKey = { toBase58: () => pk, toString: () => pk }
        sol.isConnected = true
        _wsEmit('change', { accounts: [_wsAccount()] })
        return { accounts: [_wsAccount()] }
      }
    },
    'standard:disconnect': {
      version: '1.0.0',
      async disconnect() {
        _wsAddress = null
        _wsPublicKey = null
        const sol = (window as unknown as Record<string, unknown>).solana as Record<string, unknown>
        sol.publicKey = null
        sol.isConnected = false
        _wsEmit('change', { accounts: [] })
      }
    },
    'standard:events': {
      version: '1.0.0',
      on(event: string, cb: (d: unknown) => void) {
        if (!_wsListeners[event]) _wsListeners[event] = []
        _wsListeners[event].push(cb)
        return () => { _wsListeners[event] = (_wsListeners[event] ?? []).filter(l => l !== cb) }
      }
    },
    'solana:signAndSendTransaction': {
      version: '1.0.0',
      supportedTransactionVersions: ['legacy', 0] as const,
      signAndSendTransaction(...args: unknown[]) {
        return send('web3:solana:sign-and-send', args)
      }
    },
    'solana:signMessage': {
      version: '1.0.0',
      // Wallet Standard: accept N inputs, return N outputs as an ARRAY. Returning
      // a single object made dApps (OpenSea) read result[0] as undefined →
      // "Wallet error occurred".
      async signMessage(...inputs: { message: Uint8Array; account?: unknown }[]) {
        return Promise.all(inputs.map(async (input) => {
          const sig = await send<number[]>('web3:solana:sign', [Array.from(input.message)])
          return {
            signedMessage: input.message,
            signature: new Uint8Array(sig),
            signatureType: 'ed25519' as const
          }
        }))
      }
    },
  },
  get accounts() { return _wsAddress ? [_wsAccount()] : [] }
}

function _registerWalletStandard() {
  try {
    // detail receives the `register` function directly — NOT destructured as { register }
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', {
      detail: (register: (w: unknown) => void) => register(_wsMagicMoney)
    }))
  } catch { /* noop */ }
}

_registerWalletStandard()
// wallet-standard:app-ready fires with detail: { register } OR detail: registerFn — handle both
window.addEventListener('wallet-standard:app-ready', (e: Event) => {
  try {
    const detail = (e as CustomEvent).detail
    if (typeof detail?.register === 'function') detail.register(_wsMagicMoney)
    else if (typeof detail === 'function') detail(_wsMagicMoney)
    else _registerWalletStandard()
  } catch { /* noop */ }
})

// ── EIP-6963: multi-wallet discovery ─────────────────────────────────────────

function announceProvider() {
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({
      info: Object.freeze({
        uuid:  'b3e4f2a1-7c8d-4e9f-a0b1-2c3d4e5f6a7b',
        name:  'MagicMoney Wallet',
        icon:  WALLET_ICON,
        rdns:  'info.chainlens.magicmoney',
      }),
      provider: mmEthereum,
    })
  }))
}

announceProvider()
window.addEventListener('eip6963:requestProvider', announceProvider)

// ── window.unisat — Bitcoin dApp standard (Ordinals, Runes, BRC-20) ──────────

const mmUnisat = {
  isMagicMoney: true,

  getAccounts:     ()                                        => send<string[]>('bitcoin:get-accounts', []),
  requestAccounts: ()                                        => send<string[]>('bitcoin:request-accounts', []),
  getPublicKey:    ()                                        => send<string>('bitcoin:get-public-key', []),
  getNetwork:      ()                                        => Promise.resolve('livenet'),
  getBalance:      ()                                        => send<{ confirmed: number; unconfirmed: number; total: number }>('bitcoin:get-balance', []),
  switchNetwork:   ()                                        => Promise.resolve('livenet'),
  signMessage:     (msg: string, type = 'ecdsa')             => send<string>('bitcoin:sign-message', [msg, type]),
  signPsbt:        (psbtHex: string, opts = {})              => send<{ psbtHex: string }>('bitcoin:sign-psbt', [psbtHex, opts]).then(r => r.psbtHex),
  signPsbts:       (psbts: string[], opts = {})             => Promise.all((psbts || []).map(p => send<{ psbtHex: string }>('bitcoin:sign-psbt', [p, opts]).then(r => r.psbtHex))),
  pushPsbt:        (psbtHex: string)                         => send<string>('bitcoin:push-psbt', [psbtHex]),
  pushTx:          (raw: { rawtx: string } | string)        => send<string>('bitcoin:push-tx', [typeof raw === 'object' ? raw.rawtx : raw]),
  sendBitcoin:     (to: string, satoshis: number)           => send<string>('bitcoin:send', [to, satoshis]),

  on:              (_e: string, _cb: (...a: unknown[]) => void) => {},
  removeListener:  (_e: string, _cb: (...a: unknown[]) => void) => {},
}

// Only claim window.unisat if a Bitcoin wallet hasn't already locked it; never throw.
if (typeof (window as unknown as Record<string, unknown>).unisat === 'undefined') {
  try { (window as unknown as Record<string, unknown>).unisat = mmUnisat } catch { /* locked by another wallet */ }
}

// ── sats-connect / WBIP provider (window.btc_providers) — Satflow, Gamma, ME … ─
type BtcParams = Record<string, unknown>
const okResult = (result: unknown) => ({ status: 'success', result })
const mmBtcProvider = {
  id: 'MagicMoneyProviders.BitcoinProvider',
  name: 'MagicMoney Wallet',
  icon: WALLET_ICON,
  isMagicMoney: true,
  request: (method: string, params: BtcParams = {}): Promise<unknown> => {
    switch (method) {
      case 'getInfo':
        return Promise.resolve(okResult({ version: '1.0.0', methods: ['getAddresses', 'signMessage', 'signPsbt', 'sendTransfer'], supports: [] }))
      case 'wallet_connect':
      case 'getAddresses':
        return send<unknown>('bitcoin:request-addresses', [params.purposes]).then(okResult)
      case 'getBalance':
        return send<{ confirmed: number; unconfirmed: number; total: number }>('bitcoin:get-balance', [])
          .then(b => okResult({ confirmed: String(b.confirmed), unconfirmed: String(b.unconfirmed), total: String(b.total) }))
      case 'signMessage':
        return send<string>('bitcoin:sign-message', [params.message, params.address]).then(sig => okResult({ signature: sig, address: params.address }))
      case 'signPsbt':
        return send<{ psbtBase64: string; txid?: string }>('bitcoin:sign-psbt', [params.psbt, { signInputs: params.signInputs, broadcast: !!params.broadcast, autoFinalized: params.finalize !== false }])
          .then(r => okResult({ psbt: r.psbtBase64, txid: r.txid }))
      case 'sendTransfer': {
        const recips = (params.recipients as Array<{ address: string; amount: number }>) || []
        if (!recips.length) return Promise.reject(new Error('No recipients'))
        return send<string>('bitcoin:send', [recips[0].address, recips[0].amount]).then(txid => okResult({ txid }))
      }
      default:
        return Promise.reject(Object.assign(new Error('Method not supported: ' + method), { code: -32601 }))
    }
  },
  connect:     () => send('bitcoin:request-addresses', []),
  signMessage: (msg: string, addr?: string) => send<string>('bitcoin:sign-message', [msg, addr]),
  signPsbt:    (psbt: string, opts: BtcParams = {}) => send<{ psbtBase64: string }>('bitcoin:sign-psbt', [psbt, opts]).then(r => r.psbtBase64),
}
try {
  const w = window as unknown as Record<string, unknown>
  if (!w.MagicMoneyProviders) w.MagicMoneyProviders = {}
  ;(w.MagicMoneyProviders as Record<string, unknown>).BitcoinProvider = mmBtcProvider
  if (!Array.isArray(w.btc_providers)) w.btc_providers = []
  const list = w.btc_providers as Array<{ id: string }>
  if (!list.some(p => p && p.id === mmBtcProvider.id)) list.push({ id: mmBtcProvider.id, name: mmBtcProvider.name, icon: mmBtcProvider.icon } as { id: string })
  if (typeof w.BitcoinProvider === 'undefined') w.BitcoinProvider = mmBtcProvider
} catch { /* window locked */ }

// ── window.injectedWeb3 — Polkadot.js extension standard ─────────────────────

try {
  const w = window as unknown as Record<string, unknown>
  if (!w.injectedWeb3 || typeof w.injectedWeb3 !== 'object') w.injectedWeb3 = {}
  ;(w.injectedWeb3 as Record<string, unknown>).magicmoney = {
    version: '0.1.0',
    enable: (_origin: string) => send('polkadot:enable', []).then(() => ({
      accounts: {
        get:       ()                                        => send<unknown[]>('polkadot:get-accounts', []),
        subscribe: (cb: (accs: unknown[]) => void) => {
          send<unknown[]>('polkadot:get-accounts', []).then(a => cb(a))
          return () => {}
        },
      },
      signer: {
        signPayload: (payload: unknown) => send<{ id: number; signature: string }>('polkadot:sign-payload', [payload]),
        signRaw:     (raw: unknown)     => send<{ id: number; signature: string }>('polkadot:sign-raw', [raw]),
      },
    })),
  }
} catch (e) {
  console.warn('[MagicMoney] Polkadot injection error:', e)
}

}  // installProviders
