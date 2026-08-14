import type { SsEstimateParams, SsEstimate, SsCreateParams, SsExchange, XchangeEstimate, XchangeCreateParams, ExchangeProvider } from './simpleswap'
import type { SwapQuoteRequest, SwapQuoteResponse, SwapExecuteResult, SwapTokenListResponse, NormalizedSwapQuote, SwapChain, CrossSwapStatusRequest, CrossSwapStatus } from './swap'
// Unlike src/main (deliberately not reachable from the renderer), src/shared is
// platform-neutral — no node, no electron — so importing it here typechecks
// under every target's lib, even though it sits outside tsconfig.web's include.
import type { AssetFilterEntries } from '../../shared/asset-filter-key'

// In-app software update status (Electron only). Mirrors update-manager.ts.
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'mac-available' | 'error'
  version?: string
  percent?: number
  error?: string
}

// Per-chain dApp grant. Mirrors main/dapp-permissions.ts — declared here rather
// than imported because tsconfig.web.json deliberately does not include src/main.
export type DappChain = 'evm' | 'cardano' | 'bitcoin' | 'solana' | 'polkadot' | 'midnight'

export interface ApprovedOrigin {
  origin: string
  chains: DappChain[]
  addedAt: number
}

// User-added EVM network (MetaMask-style manual add). Mirrors secure-store.ts.
export interface CustomChain {
  id: string            // 'custom-<chainId>'
  name: string
  chainId: number
  nativeSymbol: string
  rpcUrl: string
  explorerUrl: string   // explorer origin ('' when none)
}

// A manually imported ERC-20 on a custom chain. Mirrors secure-store.ts.
export interface CustomToken {
  chain: string
  contractAddress: string
  name: string
  symbol: string
  decimals: number
}

// A manually imported NFT on a custom chain. Mirrors secure-store.ts — only the
// identity is stored; artwork/traits are re-resolved on each portfolio fetch.
export interface CustomNft {
  chain: string
  contractAddress: string
  tokenId: string
  type: 'ERC-721' | 'ERC-1155'
}

/** What the NFT import form gets back before saving. */
export interface CustomNftPreview {
  type: 'ERC-721' | 'ERC-1155'
  collectionName: string | null
  owned: Array<{ tokenId: string; name: string; image: string | null }>
}

export interface WalletAddresses {
  evm: string
  solana: string
  cardano: string
  cardanoStake: string
  bitcoin: string          // Native SegWit (bc1q…) — payment
  bitcoinNested: string    // Nested SegWit (3…)
  bitcoinTaproot: string   // Taproot (bc1p…) — ordinals
  polkadot: string
  tron?: string
  dogecoin?: string
  accountIndex: number
  // Abstract Global Wallet (smart account). agw = manual override ?? auto-derived.
  // agwOwned = we hold a key that can sign for it (required to send from it).
  agw?: string
  agwOwned?: boolean
  // Public address of the AGW signer key imported from the Abstract portal
  // (Settings → Export Signer Private Key), when one is stored for this account.
  // The key itself never leaves the wallet backend.
  agwSigner?: string
  // That imported signer — not this wallet's EOA — is the owner that signs.
  agwSignerActive?: boolean
  // Testnet Mode: cached testnet-encoded set (Bitcoin tb1…, Cardano addr_test…).
  // While the mode is on, main substitutes these into the top-level fields before
  // returning, so the renderer rarely needs to read this directly.
  testnet?: {
    bitcoin: string
    bitcoinNested: string
    bitcoinTaproot: string
    cardano: string
    cardanoStake: string
    // Midnight Preprod — same keys as Privacy Mode's mainnet set, re-encoded
    // with the _preprod bech32 HRP. Rides Testnet Mode; no separate switcher.
    midnight?: string
    midnightShielded?: string
    midnightDust?: string
  }
  // Privacy Mode: cached privacy-chain addresses (new chains, not substitutes —
  // the renderer reads these directly via getAddress()).
  privacy?: {
    monero: string
    // Private VIEW key (watch-only — can see incoming funds, can never spend).
    // Cached alongside the address so balances scan while locked; the spend key
    // never leaves the main process.
    moneroViewKey?: string
    zcashTransparent: string
    zcashUnified?: string
    midnight?: string          // unshielded mn_addr… — where NIGHT lives
    midnightShielded?: string  // mn_shield-addr… receiver
    midnightDust?: string      // mn_dust… — DUST fee identity (point DUST generation here)
  }
}

export interface ChainBalance {
  native: string
  symbol: string
  usdValue: string | null
  tokenCount: number
  error: string | null
  priceChange24h: number | null
  sparkline: number[] | null
}

export interface AllBalances {
  chains: Record<string, ChainBalance>
  fetchedAt: number
  portfolioSparkline: number[] | null
}

export interface TxRecord {
  hash: string
  direction: 'in' | 'out' | 'self'
  amount: string | null
  symbol: string
  timestamp: number
  counterparty: string | null
  explorerUrl: string
}

export interface ChainHistory {
  records: TxRecord[]
  error: string | null
}

export type AllHistory = Record<string, ChainHistory>

// ── Phase 5: Market Watch ────────────────────────────────────────────────────

export interface MarketCoin {
  id: string
  rank: number
  name: string
  symbol: string
  image: string
  price: number
  change24h: number | null
  marketCap: number | null
  sparkline: number[] | null
}

export interface MarketResult {
  coins: MarketCoin[]
  fetchedAt: number
  error: string | null
  source?: string
}

export interface WalletToken {
  contractAddress: string
  name: string
  symbol: string
  decimals: number
  balance: string
  /**
   * Exact holding in base units. `balance` is a rounded, comma-grouped DISPLAY
   * string — never do arithmetic on it. Absent for the read-only asset classes
   * (Bitcoin runes/BRC-20, Midnight DUST); the send UI treats absent as
   * "not sendable" rather than guessing.
   */
  rawBalance?: string
  usdValue: string | null
  nativeEquivalent: string | null
  nativeSymbol: string
  logoUri: string | null
  chain: string
  chainLabel: string
  chainColor: string
  source?: 'agw'   // asset lives in the Abstract Global Wallet (smart account)
  // H-1: heuristic phishing-airdrop flag set by main's spam-filter.ts. The
  // dashboard treats these as spam by default; restoring whitelists the token.
  suspectedSpam?: boolean
}

export interface TokensResult {
  tokens: WalletToken[]
  fetchedAt: number
  error: string | null
}

export interface NftTrait {
  trait_type: string
  value: string
}

export interface WalletCollectible {
  id: string
  name: string
  description: string | null
  image: string | null
  animationUrl: string | null
  collectionName: string | null
  chain: string
  chainLabel: string
  chainColor: string
  tokenId: string
  contractAddress: string
  /**
   * NOT normalized across sources — Alchemy writes "ERC721", Blockscout
   * "ERC-721", Tron "TRC-721", Cardano "CIP25", Solana "NFT"/"cNFT", Bitcoin
   * "inscription". Classify with nftStandard() in ../lib/asset-send, never by
   * comparing this string directly.
   */
  contractType: string
  /** ERC-1155/TRC-1155 editions held. Absent on 1-of-1 standards. */
  quantity?: string
  traits: NftTrait[]
  source?: 'agw'   // NFT lives in the Abstract Global Wallet (smart account)
  floorPrice?: number | null   // collection floor in the chain's native unit
  usdValue?: string | null     // floor × native price, e.g. "$42.10"
}

export interface NftFloorPrice {
  floor: string | null
  currency: string
  floorUsd: string | null
}

export interface CollectiblesResult {
  items: WalletCollectible[]
  fetchedAt: number
  error: string | null
  chainResults: Record<string, { count: number; error: string | null }>
}

// ── Phase 10: WalletConnect ──────────────────────────────────────────────────

export interface WcSession {
  topic: string
  peerName: string
  peerIcon: string | null
  peerUrl: string
  expiry: number
  accounts: string[]
}

export interface WcProposal {
  id: number
  peerName: string
  peerIcon: string | null
  peerUrl: string
  requiredChains: string[]
  optionalChains: string[]
  requiredMethods: string[]
}

export interface WcRequest {
  id: number
  topic: string
  peerName: string
  peerIcon: string | null
  chainId: string
  method: string
  params: unknown[]
  humanReadable: string
}

// ── Phase 9: ChainLens Profile ───────────────────────────────────────────────

export interface ClWallet {
  id: string
  user_id: string
  chain: string
  address: string
  watch_only: boolean
  verified_at: string | null
  is_primary: boolean | null
  label: string | null
}

export interface ClLinkedAccount {
  id: string
  user_id: string
  provider: string
  provider_id: string
  display_name: string | null
  avatar_url: string | null
  email: string | null
}

export interface ClUser {
  id: string
  provider: string
  provider_id: string
  display_name: string | null
  avatar_url: string | null
  email: string | null
  created_at: string | null
  cl_wallets: ClWallet[]
  cl_linked_accounts: ClLinkedAccount[]
}

export interface ChainlensSyncResult {
  success: boolean
  profile: ClUser | null
  error: string | null
}

export type MainTab = 'portfolio' | 'market' | 'swap' | 'apphub' | 'profile'

// ─── DEX swap types live in ./swap (re-exported here for convenience) ─────────
export type { SwapMode, SwapProvider, SwapChain, SwapToken, SwapQuoteRequest, NormalizedSwapQuote, SwapQuoteResponse, SwapExecuteResult, SwapTokenListResponse, CrossSwapStatusRequest, CrossSwapStatus } from './swap'

export type AppPage =
  | 'loading'
  | 'welcome'
  | 'create'
  | 'confirm'
  | 'import'
  | 'setpassword'
  | 'unlock'
  | 'dashboard'

// chainId string from chain-config — e.g. 'ethereum', 'arbitrum', 'solana', 'cardano'
export type SendChain = string

export interface FeeEstimate {
  fee: string
  feeSymbol: string
  feeUsd: string | null
}

/**
 * Which transfer semantics a send uses. Mirrors the definition in
 * src/main/tx-sender.ts (this file deliberately duplicates main's types rather
 * than importing across the renderer/main boundary — see WalletToken above).
 *
 * 'erc721'/'erc1155' also cover Tron's TRC-721/TRC-1155, which share the ABI.
 * 'cardano' is a CIP-25 native asset. 'spl' is a Solana SPL mint held at
 * quantity 1. Compressed Solana NFTs and Bitcoin ordinals are deliberately
 * absent — they need data the fetcher does not capture, so the UI gates them.
 */
export type NftStandard = 'erc721' | 'erc1155' | 'spl' | 'cardano'

export type SendAsset =
  | { kind: 'token'; contractAddress: string; decimals: number; symbol?: string }
  | {
      kind: 'nft'
      contractAddress: string
      tokenId: string
      standard: NftStandard
      /** ERC-1155/TRC-1155 editions to move. Defaults to '1' elsewhere. */
      quantity?: string
    }

export interface SendResult {
  txHash: string
  explorerUrl: string
}

export interface BrowserTab {
  id: number
  title: string
  url: string
  loading: boolean
}

export interface TorBrowserState {
  enabled: boolean
  status: 'off' | 'connecting' | 'connected' | 'error' | 'unsupported'
  host: string
  port: number
  isTor: boolean
  message: string
}

// Magic Guard — privacy filtering for the built-in dApp browser. v1 ships the
// on/off toggle + per-site exception UI; `effectiveEnabled` stays false and
// `status` stays 'degraded' (with `error` explaining why) until the filtering
// engine itself is wired in behind this same state shape.
export type MagicGuardStatus = 'loading' | 'ready' | 'degraded' | 'disabled'

export interface MagicGuardState {
  enabled: boolean
  siteEnabled: boolean
  effectiveEnabled: boolean
  status: MagicGuardStatus
  hostname: string | null
  blockedThisPage: number
  blockedThisTab: number
  listVersion?: string
  lastUpdatedAt?: number
  error?: string
}

/** Result of saving an asset to the OS Downloads folder (main/downloads.ts). */
export interface DownloadResult {
  ok: boolean
  path?: string
  fileName?: string
  error?: string
}

/**
 * Live download progress driving the wallet's top-edge bar. `percent` is null
 * when the source sends no Content-Length — the bar sweeps instead of lying.
 */
export interface DownloadProgress {
  active: boolean
  percent: number | null
}

/**
 * Whether MagicMoney can be — and currently is — the system's default browser.
 * `supported` is false wherever we can't verify or influence it (macOS/Linux,
 * dev builds, the extension), and the Settings row hides rather than lie.
 */
export interface DefaultBrowserState {
  supported: boolean
  registered: boolean
  isDefault: boolean
}

// ── Browser: bookmarks, installed web apps, saved passwords ─────────────────

export interface Bookmark {
  id: string
  url: string
  title: string
  addedAt: number
}

export interface WebApp {
  id: string
  url: string
  name: string
  shortcutPath: string | null
  installedAt: number
}

/** Metadata for one saved login — the password itself is never in this shape. */
export interface PasswordSummary {
  id: string
  url: string
  host: string
  username: string
  note?: string
  updatedAt: number
}

export interface PasswordVaultStatus {
  exists: boolean
  unlocked: boolean
  count: number
  available: boolean
}

/**
 * Biometric unlock for the saved-password vault. Additive: the wallet password
 * always still opens it, exactly as for the wallet itself.
 *
 * `method` is one of 'windows-hello' | 'touch-id' | 'android-biometric' |
 * 'face-id', typed loosely because each target reports its own sensor name;
 * `bioMethodLabel` turns it into UI copy. `supported: false` means the control
 * must be hidden — there is no ceremony this build/machine could run.
 */
export interface PasswordBioStatus {
  supported: boolean
  enrolled: boolean
  method: string | null
}

/**
 * Display name for a PasswordBioStatus/helloStatus `method`, written to read
 * after "Unlock with …". Android's BiometricPrompt can be a fingerprint or a
 * face depending on the device, so it stays generic rather than guessing.
 */
/**
 * Every biometric sensor any target can report. ONE definition — this union was
 * previously copy-pasted into local useState declarations, and a copy that had
 * drifted (missing 'face-id') is what made an iPhone render "Enable Windows
 * Hello unlock": the local fallback mapped anything unrecognised to Windows.
 * Import this rather than re-spelling it, and pair it with bioMethodLabel()
 * below so the UI asks what the device reported instead of assuming a platform.
 */
export type BiometricMethod = 'windows-hello' | 'touch-id' | 'face-id' | 'android-biometric'

export function bioMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case 'windows-hello': return 'Windows Hello'
    case 'touch-id':      return 'Touch ID'
    case 'face-id':       return 'Face ID'
    default:              return 'biometrics'
  }
}

/** Everything the chrome needs about the page in the active tab, read from main. */
export interface BrowserPageState {
  url: string
  title: string
  host: string
  bookmarked: boolean
  installed: boolean
  savedLogins: PasswordSummary[]
  passwordsUnlocked: boolean
}

/** One importable Chromium profile found on this machine. */
export interface ImportSource {
  id: string
  browser: string
  profile: string
  path: string
  hasPasswords: boolean
  hasBookmarks: boolean
}

export interface PasswordImportSummary {
  added: number
  skipped: number
  total?: number
  /** Rows that exist but could not be decrypted (Chrome 127+ app-bound blobs),
   *  or CSV rows missing a URL/password. */
  unreadable?: number
  /** CSV import only: the user dismissed the file dialog. */
  canceled?: boolean
  error?: string
}

export interface BookmarkImportSummary {
  added: number
  skipped: number
  error?: string
  bookmarks: Bookmark[]
}

export interface WebAppInstallResult {
  ok: boolean
  path?: string
  apps: WebApp[]
  error?: string
}

export interface PageSaveResult {
  ok: boolean
  path?: string
  error?: string
}

declare global {
  interface Window {
    wallet: {
      isSetup(): Promise<boolean>
      /** Fresh BIP-39 phrase for the create flow. Defaults to 12 words. */
      generate(words?: 12 | 24): Promise<string[]>
      /**
       * Optional passkey path: entropy comes from a WebAuthn PRF ceremony
       * instead of the system RNG. Absent on targets that can't run WebAuthn
       * (browser extension, iOS).
       */
      generateWithPasskey?(words?: 12 | 24): Promise<{ words: string[] }>
      /** Whether to offer the passkey option at all. Absent = never offer. */
      passkeySupported?(): Promise<boolean>
      /**
       * Recover a wallet from a passkey — the counterpart of
       * generateWithPasskey. `words` must match the length the wallet was
       * created with: the same passkey yields a different wallet at 12 vs 24.
       * Rejects where the platform won't evaluate PRF at assertion.
       */
      importWithPasskey?(words?: 12 | 24): Promise<WalletAddresses>
      /**
       * Link the unlocked wallet to a NEW passkey by wrapping the phrase under
       * its PRF output. Rejects (and stores nothing) on platforms that can mint
       * PRF but not read it back, since that blob could never be opened.
       */
      passkeyLink?(): Promise<boolean>
      passkeyLinked?(): Promise<boolean>
      passkeyUnlink?(): Promise<boolean>
      /**
       * Ask the passkey to reproduce the pending wallet. USER-INITIATED ONLY:
       * it prompts again and raises an OS error dialog on platforms that mint
       * PRF at registration but refuse it at assertion. false = "can't", never
       * "something broke" — the wallet exists either way.
       */
      passkeyVerify?(): Promise<boolean>
      /**
       * Sign the in-app browser out of every site (cookies, localStorage,
       * IndexedDB, caches). dApp grants are wallet-scoped and clear on their
       * own; site logins are not, so a new wallet stays linkable to the previous
       * identity until this runs. Always user-initiated — it destroys logins.
       */
      clearBrowsingData?(): Promise<boolean>
      validate(mnemonic: string): Promise<boolean>
      confirmBackup(): Promise<WalletAddresses>
      import(mnemonic: string): Promise<WalletAddresses>
      // Password / lock lifecycle
      setPassword(password: string): Promise<boolean>
      unlock(password: string): Promise<boolean>
      lock(): Promise<boolean>
      isUnlocked(): Promise<boolean>
      needsMigration(): Promise<boolean>
      onLocked(cb: () => void): void
      offLocked(cb: () => void): void
      reportActivity?(): void
      // Biometric unlock — Windows Hello / Touch ID / Android BiometricPrompt
      // (optional; absent on the extension bridge).
      helloStatus?(): Promise<{ supported: boolean; enrolled: boolean; method?: BiometricMethod | null }>
      // ── Android 14+ system passkey provider (Capacitor only) ──────────────
      // Optional, capability-probed like helloStatus above: only the Android
      // build implements these, and only Android 14+ can honour them. The row
      // stays hidden everywhere else rather than offering a switch that does
      // nothing. `enabledInSettings: null` means Android would not say.
      passkeyProviderStatus?(): Promise<{
        supported: boolean
        androidVersion: number
        enrolled: boolean
        enabledInSettings: boolean | null
        fingerprint?: string | null
      }>
      passkeyProviderEnable?(): Promise<{ supported: boolean; enrolled: boolean; enabledInSettings: boolean | null }>
      passkeyProviderDisable?(): Promise<void>
      // Resolves WHERE it landed: the deep link can fail entirely on an OEM
      // build (measured: the AOSP action does not resolve on Samsung), and the
      // UI has copy for that rather than pretending a screen opened.
      passkeyProviderOpenSettings?(): Promise<{ opened: boolean; via: string }>
      helloEnroll?(): Promise<boolean>
      helloUnlock?(): Promise<boolean>
      helloRemove?(): Promise<boolean>
      // Camera QR scan (optional; Android only). Resolves the decoded text, or
      // null if the user cancelled / no camera permission.
      scanQr?(): Promise<string | null>
      // Screenshot/recents protection while a seed phrase is on screen
      // (optional; Android only — FLAG_SECURE on the activity window).
      setSecureScreen?(on: boolean): Promise<void>
      getAddresses(): Promise<WalletAddresses | null>
      getBalances(): Promise<AllBalances>
      revealSeed(password: string): Promise<string[]>
      // Phase 2
      validateAddress(chainId: string, to: string): Promise<{ valid: boolean; reason?: string }>
      // `asset` is omitted for a native send (every pre-existing call site), set
      // for an ERC-20/SPL/native-asset token or an NFT. See SendAsset above.
      estimateFee(chainId: string, to: string, amount: string, asset?: SendAsset): Promise<FeeEstimate>
      sendEvm(chainId: string, to: string, amount: string, asset?: SendAsset): Promise<SendResult>
      sendAgw(to: string, amount: string, asset?: SendAsset): Promise<SendResult>
      sendSolana(to: string, amount: string, asset?: SendAsset): Promise<SendResult>
      sendCardano(to: string, amount: string, asset?: SendAsset): Promise<SendResult>
      sendBitcoin(to: string, amount: string): Promise<SendResult>
      sendTron(to: string, amount: string, asset?: SendAsset): Promise<SendResult>
      sendDogecoin(to: string, amount: string): Promise<SendResult>
      sendMonero(to: string, amount: string): Promise<SendResult>
      sendZcash(to: string, amount: string): Promise<SendResult>
      // Midnight (NIGHT) — optional: Electron-only (WASM proving, per midnight-send.ts).
      // Absent on the extension/Capacitor bridges; gate UI with a typeof check,
      // same convention as helloStatus?/scanQr?.
      sendMidnight?(to: string, amount: string): Promise<SendResult>
      getMidnightDustStatus?(): Promise<{ ready: boolean; percent: number; isConnected: boolean; error: string | null }>
      registerMidnightDust?(): Promise<{ registered: boolean; txId: string | null }>
      // Phase 3
      getHistory(): Promise<AllHistory>
      getAccountIndex(): Promise<number>
      setAccount(index: number): Promise<WalletAddresses>
      // Custom chains — user-added EVM networks (optional: Electron-only for
      // now; absent on the extension/Capacitor bridges — gate UI with typeof).
      getCustomChains?(): Promise<CustomChain[]>
      addCustomChain?(chain: { name: string; chainId: number; nativeSymbol: string; rpcUrl: string; explorerUrl?: string }): Promise<CustomChain[]>
      removeCustomChain?(id: string): Promise<CustomChain[]>
      // Imported ERC-20s on custom chains (Blockscout explorers auto-detect;
      // this is the manual fallback). resolve* reads metadata without saving.
      getCustomTokens?(): Promise<CustomToken[]>
      resolveCustomToken?(chain: string, contractAddress: string): Promise<{ name: string; symbol: string; decimals: number; balance: string }>
      importCustomToken?(chain: string, contractAddress: string): Promise<CustomToken[]>
      removeCustomToken?(chain: string, contractAddress: string): Promise<CustomToken[]>
      // Imported NFTs on custom chains. resolveCustomNft previews without saving;
      // omit tokenId to list this wallet's tokens from an Enumerable ERC-721.
      getCustomNfts?(): Promise<CustomNft[]>
      resolveCustomNft?(chain: string, contractAddress: string, tokenId?: string): Promise<CustomNftPreview>
      importCustomNft?(chain: string, contractAddress: string, tokenId: string): Promise<CustomNft[]>
      removeCustomNft?(chain: string, contractAddress: string, tokenId: string): Promise<CustomNft[]>
      // Testnet Mode
      getTestnetMode(): Promise<boolean>
      setTestnetMode(enabled: boolean): Promise<{ testnet: boolean; addresses: WalletAddresses | null }>
      // Privacy Mode
      getPrivacyMode(): Promise<boolean>
      setPrivacyMode(enabled: boolean): Promise<{ privacy: boolean; addresses: WalletAddresses | null }>
      setAgw(accountIndex: number, address: string | null): Promise<WalletAddresses | null>
      // Abstract portal signer key (Settings → Export Signer Private Key) — makes
      // a watch-only AGW spendable. `secret` is the private key or its recovery
      // phrase; it is consumed by the backend and never stored by the renderer.
      // Optional so a bridge without it degrades to watch-only instead of throwing.
      importAgwSigner?(accountIndex: number, secret: string): Promise<WalletAddresses | null>
      removeAgwSigner?(accountIndex: number): Promise<WalletAddresses | null>
      // Connected sites (revoke dApp access)
      getConnectedSites(): Promise<ApprovedOrigin[]>
      revokeSite(origin: string, chain?: DappChain): Promise<ApprovedOrigin[]>
      revokeAllSites(): Promise<ApprovedOrigin[]>
      deleteWallet(): Promise<boolean>
      // Phase 5
      getMarket(): Promise<MarketResult>
      searchMarket(query: string): Promise<MarketCoin[]>
      getCoinChart(coinId: string, days: string): Promise<Array<[number, number]>>
      getTokens(): Promise<TokensResult>
      getCollectibles(excludeIds?: string[]): Promise<CollectiblesResult>
      // Pushed when the background floor-valuation pass finishes.
      onCollectiblesUpdated(cb: (r: CollectiblesResult) => void): void
      offCollectiblesUpdated(cb: (r: CollectiblesResult) => void): void
      getNftFloor(chain: string, contractAddress: string): Promise<NftFloorPrice>
      swapGetQuote(req: SwapQuoteRequest): Promise<SwapQuoteResponse>
      swapExecute(quote: NormalizedSwapQuote): Promise<SwapExecuteResult>
      swapCrossStatus(req: CrossSwapStatusRequest): Promise<CrossSwapStatus>
      swapGetTokens(chain: SwapChain): Promise<SwapTokenListResponse>
      ssEstimate(params: SsEstimateParams): Promise<SsEstimate>
      ssCreateExchange(params: SsCreateParams): Promise<SsExchange>
      ssStatus(id: string): Promise<SsExchange>
      xEstimate(params: SsEstimateParams): Promise<XchangeEstimate>
      xCreateExchange(params: XchangeCreateParams): Promise<SsExchange>
      xStatus(provider: ExchangeProvider, id: string): Promise<SsExchange>
      minimize(): void
      close(): void
      // Side-by-side window layout (Full Screen Mode) — Electron only; absent
      // from the extension bridge (optional, like helloStatus below).
      layoutSnap?(side: 'left' | 'right'): void
      layoutDetach?(): void
      layoutToggle?(): void
      browserToggleMaximize?(): void
      browserSetChromeHeight?(h: number): void
      layoutGetState?(): Promise<{ snapped: boolean; side: 'left' | 'right' | null; browserOpen: boolean; maximized: boolean }>
      onLayoutChanged?(cb: (s: { snapped: boolean; side: 'left' | 'right' | null; browserOpen: boolean; maximized: boolean }) => void): void
      offLayoutChanged?(cb: (s: { snapped: boolean; side: 'left' | 'right' | null; browserOpen: boolean; maximized: boolean }) => void): void
      // App version + in-app software update — Electron only; absent from the
      // extension bridge (extensions self-update via the Chrome store).
      getAppVersion?(): Promise<string>
      updateCheck?(): Promise<UpdateStatus>
      updateGetState?(): Promise<UpdateStatus>
      updateInstall?(): void
      onUpdateStatus?(cb: (s: UpdateStatus) => void): void
      offUpdateStatus?(cb: (s: UpdateStatus) => void): void
      // Save a remote/data: asset (NFT media) to the OS Downloads folder.
      // Electron + Android only — the extension keeps its plain <a download>,
      // which works there because extension pages aren't routed to the OS browser.
      downloadFile?(url: string, suggestedName: string): Promise<DownloadResult>
      // Drives the thin neon bar across the top of the wallet while bytes arrive.
      onDownloadProgress?(cb: (p: DownloadProgress) => void): void
      offDownloadProgress?(cb: (p: DownloadProgress) => void): void
      // Register + hand off to the OS "default apps" screen so MagicMoney can be
      // chosen as the system browser. Absent on the extension bridge.
      defaultBrowserGetState?(): Promise<DefaultBrowserState>
      defaultBrowserRequest?(): Promise<DefaultBrowserState>
      // Phase 6: popup dApp browser
      openBrowser(): void
      // Open a specific URL in the built-in browser (Electron; Capacitor maps this
      // onto its persistent-tabs browser).
      openInAppBrowser?(url: string): void
      closeBrowser(): void
      browserBack(): void
      browserForward(): void
      browserReload(): void
      browserHome(): void
      browserNavigate(url: string): Promise<void>
      browserGetState(): Promise<{ url: string; canBack: boolean; canForward: boolean; loading: boolean; tabs: BrowserTab[]; activeTabId: number }>
      browserGetTorState?(): Promise<TorBrowserState>
      browserSetTorMode?(enabled: boolean): Promise<TorBrowserState>
      onBrowserTorState?(cb: (state: TorBrowserState) => void): void
      offBrowserTorState?(cb: (state: TorBrowserState) => void): void
      // Magic Guard — Electron only for now (extension/Capacitor adapters ship later).
      browserGetMagicGuardState?(): Promise<MagicGuardState>
      browserSetMagicGuardEnabled?(enabled: boolean): Promise<MagicGuardState>
      browserSetMagicGuardForSite?(enabled: boolean): Promise<MagicGuardState>
      onBrowserGuardState?(cb: (state: MagicGuardState) => void): void
      offBrowserGuardState?(cb: (state: MagicGuardState) => void): void
      browserNewTab(url?: string): void
      browserSetActiveTab(id: number): void
      browserCloseTab(id: number): void
      browserSuspendTabsMenu(): Promise<string>
      browserResumeTabsMenu(): void
      // Bookmarks / save-and-share / password manager — Electron browser chrome
      // only. Optional so the extension + Capacitor bridges (which have no
      // WebContentsView and no OS shortcut story) keep type-checking unchanged.
      browserGetPageState?(): Promise<BrowserPageState>
      browserToggleBookmark?(): Promise<BrowserPageState>
      browserListBookmarks?(): Promise<Bookmark[]>
      browserRemoveBookmark?(id: string): Promise<Bookmark[]>
      browserRenameBookmark?(id: string, title: string): Promise<Bookmark[]>
      browserImportBookmarks?(sourceId: string): Promise<BookmarkImportSummary>
      browserWebAppsSupported?(): Promise<boolean>
      browserListWebApps?(): Promise<WebApp[]>
      browserInstallWebApp?(): Promise<WebAppInstallResult>
      browserUninstallWebApp?(id: string): Promise<WebApp[]>
      browserSavePage?(): Promise<PageSaveResult>
      browserCapturePage?(): Promise<PageSaveResult>
      browserCopyLink?(): Promise<{ ok: boolean; url?: string; error?: string }>
      browserShareByEmail?(): Promise<{ ok: boolean; error?: string }>
      passwordsStatus?(): Promise<PasswordVaultStatus>
      passwordsUnlock?(password: string): Promise<PasswordVaultStatus>
      passwordsLock?(): Promise<PasswordVaultStatus>
      // Biometric unlock for the saved-password vault. Optional and capability-
      // probed like helloStatus? above: the extension bridge has no biometric
      // API at all, so the control is hidden there rather than offered broken.
      passwordsBioStatus?(): Promise<PasswordBioStatus>
      passwordsBioEnroll?(): Promise<boolean>
      passwordsBioUnlock?(): Promise<PasswordVaultStatus>
      passwordsBioRemove?(): Promise<boolean>
      passwordsList?(): Promise<PasswordSummary[]>
      passwordsReveal?(id: string): Promise<string>
      passwordsCopy?(id: string): Promise<{ ok: boolean }>
      passwordsSave?(entry: { id?: string; url: string; username: string; password: string; note?: string }): Promise<PasswordSummary[]>
      passwordsDelete?(id: string): Promise<PasswordSummary[]>
      passwordsImportSources?(): Promise<ImportSource[]>
      passwordsImport?(sourceId: string): Promise<PasswordImportSummary>
      passwordsImportCsv?(): Promise<PasswordImportSummary>
      browserFillPassword?(id: string): Promise<{ ok: boolean; error?: string }>
      onBrowserAutofill?(cb: (s: { host: string; username: string; more: number }) => void): void
      offBrowserAutofill?(cb: (s: { host: string; username: string; more: number }) => void): void
      onBrowserToast?(cb: (message: string) => void): void
      offBrowserToast?(cb: (message: string) => void): void
      onBrowserFullscreen?(cb: (fullscreen: boolean) => void): void
      offBrowserFullscreen?(cb: (fullscreen: boolean) => void): void
      onBrowserUrl(cb: (url: string) => void): void
      onBrowserLoading(cb: (loading: boolean) => void): void
      onBrowserNavState(cb: (s: { canBack: boolean; canForward: boolean }) => void): void
      onBrowserTitle(cb: (title: string) => void): void
      onBrowserTabs(cb: (s: { activeTabId: number; tabs: BrowserTab[] }) => void): void
      offBrowserUrl(cb: (url: string) => void): void
      offBrowserLoading(cb: (loading: boolean) => void): void
      offBrowserNavState(cb: (s: { canBack: boolean; canForward: boolean }) => void): void
      offBrowserTitle(cb: (title: string) => void): void
      offBrowserTabs(cb: (s: { activeTabId: number; tabs: BrowserTab[] }) => void): void
      onBrowserClosed(cb: () => void): void
      offBrowserClosed(cb: () => void): void
      // Capacitor persistent-tabs browser (optional — absent on Electron/extension)
      showBrowser?(): void
      hideBrowser?(): void
      openBrowserInNewTab?(url: string): void
      onBrowserHidden?(cb: () => void): void
      offBrowserHidden?(cb: () => void): void
      onBrowserTabCount?(cb: (n: number) => void): void
      offBrowserTabCount?(cb: (n: number) => void): void
      // dApp browser: active EVM network (toolbar switcher + awareness)
      web3GetChain(): Promise<string>
      web3GetChains(): Promise<Array<{ chainId: number; id: string; name: string; color: string }>>
      web3SetChain(chainId: number): Promise<string>
      onWeb3ChainChanged(cb: (hex: string) => void): void
      offWeb3ChainChanged(cb: (hex: string) => void): void
      // Phase 9: ChainLens profile sync
      chainlensGetProfile(): Promise<ClUser | null>
      chainlensSync(): Promise<ChainlensSyncResult>
      chainlensUpdateProfile(updates: { display_name?: string; avatar_url?: string }): Promise<{ success: boolean; error: string | null }>
      chainlensPickAvatar(): Promise<string | null>
      /**
       * Hidden/spam asset list shared with the ChainLens website. Both resolve
       * `entries: null` for "could not sync" — which is NOT an empty list, and
       * callers must keep their local list rather than un-hiding everything.
       * Absent on builds without profile sync (the extension stubs both out).
       */
      assetFiltersGet?(): Promise<AssetFilterEntries | null>
      assetFiltersPush?(entries: AssetFilterEntries): Promise<{ entries: AssetFilterEntries | null; error: string | null }>
      // Phase 10: WalletConnect
      wcGetSessions(): Promise<WcSession[]>
      wcGetPendingProposals(): Promise<WcProposal[]>
      wcPair(uri: string): Promise<void>
      wcApproveSession(id: number): Promise<WcSession>
      wcRejectSession(id: number): Promise<void>
      wcDisconnect(topic: string): Promise<void>
      wcApproveRequest(id: number): Promise<void>
      wcRejectRequest(id: number): Promise<void>
      onWcProposal(cb: (p: WcProposal) => void): void
      onWcRequest(cb: (r: WcRequest) => void): void
      onWcSessionsChanged(cb: (s: WcSession[]) => void): void
      offWcProposal(cb: (p: WcProposal) => void): void
      offWcRequest(cb: (r: WcRequest) => void): void
      offWcSessionsChanged(cb: (s: WcSession[]) => void): void
    }
  }
}
