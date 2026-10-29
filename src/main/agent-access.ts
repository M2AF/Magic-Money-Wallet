/** Desktop-only integration with explicit read, request and execution capabilities. */
import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { AgentAccessCore, agentArgs, agentText } from './agent-access-core'
import { createAgentExecution } from './agent-execution-desktop'
import { createDesktopX402 } from './x402-desktop'
import { createNativeExecution } from './agent-native-desktop'
import type { NativePolicyInput, NativeX402LimitInput } from '../shared/agent-native'
import type { X402LimitsInput } from '../shared/x402'
import type { AgentPolicyInput } from '../shared/agent-execution'
import { startAgentHttp } from './agent-access-http'
import { isUnlocked, loadAddresses, effectiveAddresses, loadConfig, verifyPassword } from './secure-store'
import { activeChains, isTestnet, isPrivacy } from './chain-config'
import { fetchAllBalances } from './balance-fetcher'
import { fetchAllTokens } from './token-fetcher'
import { resolveSwapNetworks } from './swap-network-resolver'
import { getSwapQuote, getSwapTokenList, type SwapChain } from './swap-proxy'
import { buildSwapIdentity, assertQuoteMatchesRequest } from './swap-intent'
import { listSessions } from './swap-sessions'
import { validateAddress } from './address-validate'
import { CURATED_SWAP_TOKENS } from '../shared/swap-curated-tokens'
import { swapAssetKey } from '../shared/swap-token-identity'
import { readJsonObjectFile, writeJsonObjectFileAtomic } from './atomic-json-map-file'
import type { AgentActivity, AgentToken } from '../shared/agent-access'

function current() {
  if (!isUnlocked()) return null
  const config = loadConfig()
  if (isPrivacy(config)) return null // No agent access to privacy-wallet scanning/view-key surfaces.
  const stored = loadAddresses()
  if (!stored) return null
  return { config, addresses: effectiveAddresses(stored, config) }
}
function required() {
  const state = current()
  if (!state) throw new Error('Unlock the paired wallet in a supported mode.')
  return state
}
function context() {
  const state = current()
  if (!state) return null
  const { config, addresses: a } = state
  const environment = isTestnet(config) ? 'testnet' : 'mainnet'
  const key = createHash('sha256').update(JSON.stringify([a.accountIndex, a.evm, a.solana, a.cardano, environment])).digest('hex')
  return { key, accountIndex: a.accountIndex ?? 0, environment }
}
const cleanToken = (t: { chain: string; address: string; symbol: string; name: string; decimals: number; isNative: boolean }): AgentToken => ({
  chain: t.chain, address: t.address, symbol: agentText(t.symbol, 'token symbol', 80), name: agentText(t.name, 'token name', 160),
  decimals: t.decimals, isNative: t.isNative, logoUri: null,
})
async function token(chain: string, address: string): Promise<AgentToken> {
  const { config } = required()
  const key = swapAssetKey(chain, address)
  const curated = CURATED_SWAP_TOKENS.find(t => swapAssetKey(t.chain, t.address) === key)
  if (curated) return cleanToken(curated)
  const discovered = await getSwapTokenList({ chain: chain as SwapChain, address, limit: 50 }, config)
  const match = discovered.tokens.find(t => t.chain === chain && swapAssetKey(chain, t.address) === key)
  if (!match || !Number.isInteger(match.decimals) || match.decimals < 0 || match.decimals > 36) throw new Error('Token metadata unavailable. Use an exact supported token address.')
  return cleanToken(match)
}
function human(raw: string, decimals: number): string {
  const digits = raw.padStart(decimals + 1, '0')
  return decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`.replace(/\.?0+$/, '') : digits
}

export function registerAgentAccess(getWindow: () => BrowserWindow | null): () => void {
  const auditDir = join(app.getPath('userData'), 'agent-access')
  const auditPath = join(auditDir, 'activity.json')
  const execution = createAgentExecution(() => {
    const state = current(), ctx = context()
    return state && ctx ? { context: ctx.key, accountIndex: ctx.accountIndex, address: state.addresses.evm,
      chainId: isTestnet(state.config) ? 11155111 : 1 } : null
  }, id => core.executionAuthorization(id))
  const x402 = process.env.MAGICMONEY_X402 === '1' ? createDesktopX402({
    enabled: () => process.env.MAGICMONEY_X402 === '1', context: () => context()?.key ?? null,
    authorize: id => core.executionAuthorization(id), account: (auth, id) => execution.spendingAuthority(auth, id),
    audit: (client, action, outcome) => core.recordX402Activity(client, action, outcome),
    pendingProposals: () => core.pendingProposals() + native.pendingCount(),
  }) : undefined
  const native = createNativeExecution({
    owner: () => { const s = current(), ctx = context(); return s && ctx ? { context: ctx.key, accountIndex: ctx.accountIndex, environment: ctx.environment, solana: s.addresses.solana, cardano: s.addresses.cardano } : null },
    authorize: id => core.executionAuthorization(id), x402Enabled: () => !!x402,
    pendingProposals: () => core.pendingProposals() + (x402?.pendingCount() ?? 0),
    audit: (client, action, outcome) => core.recordX402Activity(client, action, outcome),
  })
  const core: AgentAccessCore = new AgentAccessCore({
    context,
    record(event: AgentActivity) {
      const saved = readJsonObjectFile(fs, auditPath)
      const events = saved.events ?? []
      if (!Array.isArray(events)) throw new Error('Agent activity file is invalid; access is blocked.')
      writeJsonObjectFileAtomic(fs, auditDir, auditPath, { events: [event, ...events].slice(0, 200) })
    },
    async networks() {
      const { config } = required()
      const swaps = await resolveSwapNetworks(config)
      return activeChains(config).map(c => ({ id: c.id, name: c.name, family: c.type, chainId: c.chainId ?? null,
        nativeSymbol: c.nativeSymbol, swap: swaps.find(n => n.id === c.id) ?? null,
        nativeTransferProposals: ['evm', 'solana', 'cardano', 'bitcoin', 'tron', 'dogecoin'].includes(c.type) }))
    },
    async addresses() {
      const { addresses: a } = required()
      // Explicit allowlist: WalletAddresses.privacy includes a PRIVATE Monero view key.
      return { accountIndex: a.accountIndex ?? 0, evm: a.evm, solana: a.solana, cardano: a.cardano,
        bitcoin: a.bitcoin, bitcoinNested: a.bitcoinNested, bitcoinTaproot: a.bitcoinTaproot,
        polkadot: a.polkadot, tron: a.tron, dogecoin: a.dogecoin }
    },
    async balances() {
      const { config, addresses } = required()
      const result = await fetchAllBalances(addresses, config)
      return { fetchedAt: result.fetchedAt, chains: Object.fromEntries(Object.entries(result.chains).map(([id, b]) =>
        [id, { native: b.native, symbol: b.symbol, usdValue: b.usdValue, error: b.error ? 'Balance unavailable' : null }])) }
    },
    async tokens() {
      const { config, addresses: a } = required()
      const result = await fetchAllTokens({ evm: a.evm, solana: a.solana, cardano: a.cardano, cardanoStake: a.cardanoStake,
        tron: a.tron, bitcoinTaproot: a.bitcoinTaproot }, config)
      return { fetchedAt: result.fetchedAt, error: result.error ? 'Some holdings unavailable' : null,
        tokens: result.tokens.slice(0, 2000).map(t => ({ chain: t.chain, address: t.contractAddress, symbol: t.symbol,
          name: t.name, decimals: t.decimals, decimalsKnown: t.decimalsKnown, rawBalance: t.rawBalance ?? null,
          displayBalance: t.balance, usdValue: t.usdValue, source: t.source ?? 'eoa', suspectedSpam: t.suspectedSpam ?? false,
          programmable: t.source === 'cip113', executable: false })) }
    },
    async sessions() {
      const { config, addresses } = required()
      const sessions = await listSessions(buildSwapIdentity(addresses, '', '', isTestnet(config)))
      // Return the wallet's evidence record, not a provider's arbitrary status response.
      return sessions.map(s => ({ id: s.id, state: s.state, provider: s.provider, fromChain: s.fromChain, toChain: s.toChain,
        sourceTxHash: s.sourceTxHash, sourceTxState: s.sourceTxState, destinationTxHash: s.destTxHash,
        deliveredAmountRaw: s.deliveredAmountRaw, deliveredAmountSource: s.deliveredAmountSource ?? null,
        providerReportedAmountRaw: s.providerReportedAmountRaw ?? null, updatedAt: s.updatedAt }))
    },
    async search(args) {
      const { config } = required()
      const chain = agentText(args.chain, 'chain', 64)
      if (!activeChains(config).some(c => c.id === chain) || isTestnet(config)) throw new Error('Token search unavailable on this network.')
      if (args.query !== undefined && args.address !== undefined) throw new Error('Use query or address.')
      const query = args.query === undefined ? undefined : agentText(args.query, 'query', 100)
      const address = args.address === undefined ? undefined : agentText(args.address, 'address')
      const result = await getSwapTokenList({ chain: chain as SwapChain, query, address, limit: 20 }, config)
      const curated = CURATED_SWAP_TOKENS.filter(t => t.chain === chain && (!address || swapAssetKey(chain, t.address) === swapAssetKey(chain, address))
        && (!query || `${t.symbol} ${t.name} ${t.address}`.toLowerCase().includes(query.toLowerCase())))
      const unique = new Map<string, AgentToken>()
      for (const t of [...curated, ...result.tokens]) unique.set(swapAssetKey(chain, t.address), cleanToken(t))
      return [...unique.values()].slice(0, 50)
    },
    async transfer(args) {
      const { config } = required()
      const chain = agentText(args.chain, 'chain', 64)
      const def = activeChains(config).find(c => c.id === chain)
      if (!def || !['evm', 'solana', 'cardano', 'bitcoin', 'tron', 'dogecoin'].includes(def.type)) throw new Error('Native transfer proposals are unavailable on this network.')
      const recipient = agentText(args.recipient, 'recipient')
      if (!validateAddress(chain, recipient, isTestnet(config)).valid) throw new Error('Recipient does not match this network.')
      const amount = agentText(args.amount, 'amount', 100)
      const decimals = ({ solana: 9, cardano: 6, bitcoin: 8, tron: 6, dogecoin: 8 } as Record<string, number>)[def.type] ?? 18
      if (!/^(0|[1-9][0-9]{0,59})(\.[0-9]+)?$/.test(amount) || (amount.split('.')[1]?.length ?? 0) > decimals
        || BigInt(amount.replace('.', '')) <= 0n) throw new Error('Use a positive decimal amount in native coin units with supported precision.')
      return { kind: 'transfer', chain, recipient, amount, symbol: def.nativeSymbol, network: def.name }
    },
    async quote(args) {
      const { config, addresses } = required()
      if (isTestnet(config)) throw new Error('Swaps are unavailable in Testnet Mode.')
      const fromChain = agentText(args.fromChain, 'fromChain', 64)
      const toChain = agentText(args.toChain, 'toChain', 64)
      const networks = await resolveSwapNetworks(config)
      if (!networks.some(n => n.id === fromChain && n.source) || !networks.some(n => n.id === toChain && n.destination)
        || (fromChain !== toChain && [fromChain, toChain].includes('cardano'))) throw new Error('This route is unavailable.')
      const raw = agentText(args.sellAmountRaw, 'sellAmountRaw', 78)
      if (!/^[1-9][0-9]{0,77}$/.test(raw)) throw new Error('Use a positive integer amount in base units.')
      const bps = args.slippageBps
      if (typeof bps !== 'number' || !Number.isInteger(bps) || bps < 1 || bps > 500) throw new Error('Slippage must be 1 to 500 basis points.')
      const [from, to] = await Promise.all([token(fromChain, agentText(args.fromToken, 'fromToken')), token(toChain, agentText(args.toToken, 'toToken'))])
      if (swapAssetKey(fromChain, from.address) === swapAssetKey(toChain, to.address)) throw new Error('Choose different assets.')
      const identity = buildSwapIdentity(addresses, fromChain, toChain, false)
      const request = { fromChain: fromChain as SwapChain, toChain: toChain as SwapChain, fromToken: from.address, toToken: to.address,
        fromSymbol: from.symbol, toSymbol: to.symbol, fromDecimals: from.decimals, toDecimals: to.decimals,
        sellAmountRaw: raw, slippageBps: bps, taker: identity.sourceAddress, toAddress: identity.destinationAddress,
        fromChainId: networks.find(n => n.id === fromChain)?.chainId ?? undefined,
        toChainId: networks.find(n => n.id === toChain)?.chainId ?? undefined }
      const result = await getSwapQuote(request, config)
      if (!result.quote) throw new Error('No supported quote is available.')
      // Reuse canonical request/response validation. Never expose txData or an executable intent to an agent.
      assertQuoteMatchesRequest(request, result.quote, identity)
      const q = result.quote
      return { swap: { from, to, amount: human(raw, from.decimals), slippageBps: bps },
        estimate: { provider: q.provider, sellAmountRaw: q.sellAmountRaw, buyAmountRaw: q.buyAmountRaw,
          minBuyAmountRaw: q.minBuyAmountRaw ?? null, estimatedGasRaw: q.estimatedGasRaw, expiresAt: q.expiresAt,
          priceImpactPct: q.priceImpactPct, appFee: q.appFee ?? null, externalFees: q.externalFees ?? [],
          note: 'Estimate only. Fees, minimum received and route require fresh wallet review.' } }
    },
    async balance(chain) {
      const { config, addresses } = required()
      const result = await fetchAllBalances(addresses, config)
      const b = result.chains[chain]
      return b && !b.error ? b.native : null
    },
  }, Date.now, execution, x402, native)
  let listener: Awaited<ReturnType<typeof startAgentHttp>> | null = null
  let changing = false
  let policyAuthorizationEpoch = 0
  function trusted(event: IpcMainInvokeEvent) {
    const win = getWindow()
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame
      || !current()) throw new Error('Agent settings require the unlocked wallet window.')
  }
  ipcMain.handle('agent:snapshot', event => { trusted(event); return core.snapshot() })
  ipcMain.handle('agent-native:snapshot', event => { trusted(event); return native.snapshot() })
  ipcMain.handle('agent-native:prepare', (event, id: unknown) => { trusted(event); return native.prepare(agentText(id, 'native id', 80)) })
  ipcMain.handle('agent-native:approve', (event, id: unknown, reviewId: unknown) => { trusted(event); return native.approve(agentText(id, 'native id', 80), agentText(reviewId, 'review id', 80)) })
  ipcMain.handle('agent-native:reject', (event, id: unknown) => { trusted(event); native.reject(agentText(id, 'native id', 80)) })
  ipcMain.handle('agent-native:status', (event, id: unknown) => { trusted(event); return native.status(agentText(id, 'native id', 80)) })
  ipcMain.handle('agent-native:kill', (event, id: unknown) => { trusted(event); if (id === undefined) policyAuthorizationEpoch++; native.kill(id === undefined ? undefined : agentText(id, 'policy id', 80)) })
  const requiredX402 = () => { if (!x402) throw new Error('x402 is disabled by the desktop feature flag.'); return x402 }
  ipcMain.handle('agent-x402:snapshot', event => { trusted(event); return x402?.snapshot() ?? { available: false, payments: [], limits: [] } })
  ipcMain.handle('agent-x402:prepare', (event, id: unknown) => { trusted(event); return requiredX402().prepare(agentText(id, 'x402 id', 80)) })
  ipcMain.handle('agent-x402:approve', (event, id: unknown, reviewId: unknown) => { trusted(event); return requiredX402().approve(agentText(id, 'x402 id', 80), agentText(reviewId, 'review id', 80)) })
  ipcMain.handle('agent-x402:reject', (event, id: unknown) => { trusted(event); requiredX402().reject(agentText(id, 'x402 id', 80)) })
  ipcMain.handle('agent-execution:snapshot', event => { trusted(event); return execution.snapshot() })
  ipcMain.handle('agent-execution:prepare', (event, id: unknown) => { trusted(event); return execution.prepare(agentText(id, 'transaction id', 80)) })
  ipcMain.handle('agent-execution:approve', (event, id: unknown, reviewId: unknown) => { trusted(event); return execution.approve(agentText(id, 'transaction id', 80), agentText(reviewId, 'review id', 80)) })
  ipcMain.handle('agent-execution:reject', (event, id: unknown) => { trusted(event); execution.reject(agentText(id, 'transaction id', 80)) })
  ipcMain.handle('agent-execution:status', (event, id: unknown) => { trusted(event); return execution.status(agentText(id, 'transaction id', 80)) })
  ipcMain.handle('agent-execution:kill', (event, id: unknown) => {
    trusted(event)
    if (id === undefined) policyAuthorizationEpoch++
    try { execution.kill(id === undefined ? undefined : agentText(id, 'policy id', 80)) }
    finally { if (id === undefined) native.kill() }
  })
  async function passwordGate(event: IpcMainInvokeEvent, password: unknown) {
    trusted(event)
    const before = context()?.key
    if (typeof password !== 'string' || password.length > 1024 || !await verifyPassword(password)) throw new Error('Wallet password is incorrect.')
    trusted(event)
    if (context()?.key !== before) throw new Error('Account changed during authorization.')
  }
  ipcMain.handle('agent-native:create-policy', async (event, raw: unknown, password: unknown) => {
    const epoch = policyAuthorizationEpoch; await passwordGate(event, password)
    if (epoch !== policyAuthorizationEpoch) throw new Error('Authorization interrupted by Stop.')
    const keys = ['clientId', 'chain', 'recipients', 'perSend', 'daily', 'total', 'maxFee', 'minutes']
    const input = agentArgs(raw, keys, keys) as unknown as NativePolicyInput
    return native.createPolicy(core.executionAuthorization(agentText(input.clientId, 'agent id', 80)), input)
  })
  ipcMain.handle('agent-native:configure-x402', async (event, raw: unknown, password: unknown) => {
    const epoch = policyAuthorizationEpoch; await passwordGate(event, password)
    if (epoch !== policyAuthorizationEpoch) throw new Error('Authorization interrupted by Stop.')
    const keys = ['policyId', 'resourceUrls', 'perPayment', 'daily', 'total'], input = agentArgs(raw, keys, keys) as unknown as NativeX402LimitInput
    const policy = native.snapshot().policies.find(p => p.id === input.policyId)
    if (!policy) throw new Error('Native account unavailable.')
    return native.configureX402(core.executionAuthorization(policy.clientId), input)
  })
  ipcMain.handle('agent-native:recovery', async (event, id: unknown, recipient: unknown, amount: unknown, password: unknown) => {
    await passwordGate(event, password); return native.recovery(agentText(id, 'native policy id', 80), recipient, amount)
  })
  ipcMain.handle('agent-x402:configure', async (event, raw: unknown, password: unknown) => {
    requiredX402(); const epoch = policyAuthorizationEpoch
    await passwordGate(event, password)
    if (epoch !== policyAuthorizationEpoch) throw new Error('Authorization interrupted by Stop.')
    const input = agentArgs(raw, ['policyId', 'network', 'resourceUrls', 'perPayment', 'daily', 'total'], ['policyId', 'resourceUrls', 'perPayment', 'daily', 'total']) as unknown as X402LimitsInput
    const policy = execution.snapshot().policies.find(p => p.id === input.policyId)
    if (!policy) throw new Error('Isolated account unavailable for this owner.')
    return requiredX402().configure(core.executionAuthorization(policy.clientId), input)
  })
  ipcMain.handle('agent-execution:create-policy', async (event, raw: unknown, password: unknown) => {
    const epoch = policyAuthorizationEpoch
    await passwordGate(event, password)
    if (epoch !== policyAuthorizationEpoch) throw new Error('Authorization interrupted by the kill switch.')
    const keys = ['clientId', 'recipients', 'perSend', 'daily', 'total', 'maxFee', 'minutes']
    const input = agentArgs(raw, [...keys, 'chain', 'emogotchiTokenIds'], keys) as unknown as AgentPolicyInput
    return execution.createPolicy(core.executionAuthorization(agentText(input.clientId, 'agent id', 80)), input)
  })
  ipcMain.handle('agent-execution:recovery', async (event, id: unknown, recipient: unknown, amount: unknown, password: unknown) => {
    await passwordGate(event, password)
    return execution.recovery(agentText(id, 'policy id', 80), recipient, amount)
  })
  ipcMain.handle('agent:enable', async (event, enabled: unknown) => {
    trusted(event)
    if (typeof enabled !== 'boolean' || changing) throw new Error('Agent Access is busy or arguments are invalid.')
    changing = true
    try {
      core.setEnabled(false); listener?.close(); listener = null
      if (enabled) {
        const next = await startAgentHttp(core)
        try { trusted(event); core.setEnabled(true); listener = next } catch (error) { next.close(); throw error }
      }
      return core.snapshot()
    } finally { changing = false }
  })
  ipcMain.handle('agent:revoke', (event, id: unknown) => { trusted(event); core.revoke(agentText(id, 'agent id', 80)) })
  ipcMain.handle('agent:review', (event, id: unknown, decision: unknown) => { trusted(event); return core.review(id, decision) })
  ipcMain.handle('agent:check-review', (event, id: unknown) => { trusted(event); core.checkReview(id) })
  ipcMain.handle('agent:pair', async (event, name: unknown, proposals: unknown) => {
    trusted(event)
    if (!listener || changing) throw new Error('Enable Agent Access first.')
    // Validate before opening a native file dialog; no credential exists until the user chooses a directory.
    agentText(name, 'agent name', 48)
    if (typeof proposals !== 'boolean') throw new Error('Invalid permission.')
    const before = context()?.key
    const chosen = await dialog.showOpenDialog(getWindow()!, { title: 'Save agent connection files in a private folder', properties: ['openDirectory', 'createDirectory'] })
    if (chosen.canceled || !chosen.filePaths[0]) return { exported: false }
    trusted(event)
    if (!listener || context()?.key !== before) throw new Error('Account changed. Pair again.')
    const paired = core.pair(name, proposals)
    const stem = `magicmoney-agent-${randomUUID().slice(0, 8)}`
    const configPath = join(chosen.filePaths[0], `${stem}.json`)
    const adapterPath = join(chosen.filePaths[0], `${stem}.mjs`)
    try {
      fs.writeFileSync(adapterPath, fs.readFileSync(join(app.getAppPath(), 'resources/agent-access.mjs')), { flag: 'wx', mode: 0o600 })
      fs.writeFileSync(configPath, JSON.stringify({ version: 1, endpoint: listener.endpoint, token: paired.token }, null, 2), { flag: 'wx', mode: 0o600 })
    } catch {
      core.revoke(paired.grant.id)
      throw new Error('Could not export connection files. The grant was revoked.')
    }
    return { exported: true, configPath, command: `node ${JSON.stringify(adapterPath)} --connection ${JSON.stringify(configPath)} mcp` }
  })
  return () => { listener?.close(); listener = null }
}
