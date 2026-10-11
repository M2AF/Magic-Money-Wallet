/** Read-only, cosmetic entitlement. No signing, approvals or NFT indexer trust. */
export const REDACTED_CONTRACT = '0x0351566C7e98780A591c08000576a01801241B31'
export const REDACTED_RPC = 'https://rpc.mainnet.chain.robinhood.com'
const FRESH_MS = 90_000
export type HolderAccess = { owner: string | null; status: 'locked' | 'checking' | 'owned' | 'error'; checking: boolean; balance: string; block: string | null; checkedAt: number }
let access: HolderAccess = { owner: null, status: 'locked', checking: false, balance: '0', block: null, checkedAt: 0 }
let generation = 0
let pending: AbortController | null = null
let task: Promise<void> | null = null
const listeners = new Set<() => void>()
const address = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{40}$/i.test(v)
const publish = (next: HolderAccess) => { access = next; for (const listener of listeners) listener() }
export const sovereignAccess = () => access
export const sovereignAllowed = () => access.status === 'owned' && !!access.owner && Date.now() - access.checkedAt < FRESH_MS
export const onSovereignAccess = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export async function readRedactedOwnership(owner: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<{ balance: string; block: string }> {
  if (!address(owner)) throw new Error('Invalid owner')
  let id = 0
  const rpc = async (method: string, params: unknown[]) => {
    const requestId = ++id
    const response = await request(REDACTED_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal, cache: 'no-store' })
    if (!response.ok) throw new Error('RPC unavailable')
    const data = await response.json() as { id?: number; jsonrpc?: string; error?: unknown; result?: unknown }
    if (data.id !== requestId || data.jsonrpc !== '2.0' || data.error || typeof data.result !== 'string') throw new Error('Invalid RPC response')
    return data.result
  }
  const chain = await rpc('eth_chainId', [])
  if (!/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 4663n) throw new Error('Wrong chain')
  const block = await rpc('eth_blockNumber', [])
  if (!/^0x[0-9a-f]+$/i.test(block)) throw new Error('Invalid block')
  const word = await rpc('eth_call', [{ to: REDACTED_CONTRACT, data: `0x70a08231${owner.slice(2).toLowerCase().padStart(64, '0')}` }, block])
  if (!/^0x[0-9a-f]{64}$/i.test(word)) throw new Error('Invalid balance')
  return { balance: BigInt(word).toString(), block: BigInt(block).toString() }
}

/** Account/session changes immediately invalidate every in-flight response. */
export function bindSovereignAccount(owner: string | null): void {
  const normalized = address(owner) ? owner.toLowerCase() : null
  if (normalized === access.owner) return
  ++generation; pending?.abort(); pending = null; task = null
  publish({ owner: normalized, status: normalized ? 'checking' : 'locked', checking: false, balance: '0', block: null, checkedAt: 0 })
  if (normalized) void refreshSovereignAccess()
}

export function refreshSovereignAccess(): Promise<void> {
  if (task) return task
  const owner = access.owner
  if (!owner) return Promise.resolve()
  const ticket = ++generation
  const controller = new AbortController(); pending = controller
  const timeout = setTimeout(() => {
    controller.abort()
    if (ticket === generation) {
      ++generation; task = null; pending = null
      publish({ owner, status: 'error', checking: false, balance: '0', block: null, checkedAt: 0 })
    }
  }, 10_000)
  // A still-fresh result may remain visible during periodic revalidation.
  publish({ ...access, status: sovereignAllowed() ? 'owned' : 'checking', checking: true })
  task = (async () => {
    try {
      const result = await readRedactedOwnership(owner, controller.signal)
      const current = await window.wallet?.getAddresses()
      if (ticket !== generation) return
      if (current?.evm.toLowerCase() !== owner) { bindSovereignAccount(current?.evm ?? null); return }
      publish({ owner, status: BigInt(result.balance) > 0n ? 'owned' : 'locked', checking: false, ...result, checkedAt: Date.now() })
    } catch {
      if (ticket === generation) publish({ owner, status: 'error', checking: false, balance: '0', block: null, checkedAt: 0 })
    } finally {
      clearTimeout(timeout)
      if (ticket === generation) { task = null; pending = null }
    }
  })()
  return task
}

export function initSovereignAccess(repaint: () => void): () => void {
  const off = onSovereignAccess(repaint)
  // Detached desktop browser chrome does not mount App's account binding effect.
  const browserChrome = new URLSearchParams(window.location.search).has('browserChrome')
  let browserSyncGeneration = 0
  const syncBrowserOwner = async () => {
    if (!browserChrome) return
    const ticket = ++browserSyncGeneration
    try {
      const unlocked = await window.wallet?.isUnlocked()
      const current = unlocked ? await window.wallet.getAddresses() : null
      if (ticket === browserSyncGeneration) bindSovereignAccount(current?.evm ?? null)
    } catch { if (ticket === browserSyncGeneration) bindSovereignAccount(null) }
  }
  const refresh = async () => {
    if (document.hidden) return
    await syncBrowserOwner()
    if (document.hidden || !access.owner || localStorage.getItem('mm.theme') !== 'sovereign') return
    // Expired access is removed before the asynchronous network check.
    if (!sovereignAllowed()) repaint()
    void refreshSovereignAccess()
  }
  const timer = setInterval(() => { void refresh() }, 60_000)
  const onLocked = () => { if (browserChrome) { ++browserSyncGeneration; bindSovereignAccount(null) } }
  if (browserChrome) { window.wallet?.onLocked?.(onLocked); void syncBrowserOwner() }
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', refresh)
  return () => { off(); clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); if (browserChrome) window.wallet?.offLocked?.(onLocked) }
}
