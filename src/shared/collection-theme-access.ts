/** Read-only collection gates shared by every wallet renderer and ChainLens. */
export const COLLECTION_GATES = {
  'mallard-order': { chain: 'cardano', contract: '901ba6e9831b078e131a1cc403d6139af21bda255cea6c9f770f4834', requirement: 'Mallard Order holders · Cardano' },
  'sappy-seals-art': { chain: 'evm', contract: '0x364C828eE171616a39897688A831c2499aD972ec', requirement: 'Sappy Seals holders · Ethereum' },
  sealuminati: { chain: 'evm', contract: '0xaEAA920165fD7ce58a0E0772Ffc97F06626572cD', requirement: 'Sealuminati holders · Monad' },
  r3tards: { chain: 'evm', contract: '0x200723A706de0013316E5cd8EBa2b3f53DD90c29', requirement: 'r3tards holders · Monad' },
  emonad: { chain: 'evm', contract: '0x81A224F8A62f52BdE942dBF23A56df77A10b7777', requirement: '10,000 EMONAD minimum · Monad' },
} as const
export type CollectionThemeId = keyof typeof COLLECTION_GATES
export type ThemeOwner = { chain: 'evm' | 'cardano'; address: string }
export type CollectionState = { status: 'locked' | 'checking' | 'owned' | 'error'; checking: boolean; checkedAt: number }
export const isCollectionTheme = (id: string): id is CollectionThemeId => Object.prototype.hasOwnProperty.call(COLLECTION_GATES, id)
const IDS = Object.keys(COLLECTION_GATES) as CollectionThemeId[]
const FRESH_MS = 90_000
const inactive = (): CollectionState => ({ status: 'locked', checking: false, checkedAt: 0 })
export const validThemeOwner = (owner: ThemeOwner) => owner.chain === 'evm' ? /^0x[0-9a-f]{40}$/i.test(owner.address) : /^addr1[023456789acdefghjklmnpqrstuvwxyz]{50,120}$/.test(owner.address)
const normalize = (owners: ThemeOwner[]) => [...new Map(owners.filter(validThemeOwner).map(o => {const owner={...o,address:o.address.toLowerCase()};return [`${owner.chain}:${owner.address}`,owner] as const})).values()].sort((a,b)=>`${a.chain}:${a.address}`.localeCompare(`${b.chain}:${b.address}`))

export async function readCollectionOwnership(id: CollectionThemeId, owners: ThemeOwner[], signal?: AbortSignal, request: typeof fetch = fetch, cardanoBase = 'https://www.chainlensnft.info'): Promise<boolean> {
  const gate=COLLECTION_GATES[id]
  const addresses=normalize(owners).filter(o=>o.chain===gate.chain).map(o=>o.address)
  if (!addresses.length) return false
  if (id === 'mallard-order') {
    for (const address of addresses) {
      const response=await request(`${cardanoBase}/api/theme-holder/mallard?address=${encodeURIComponent(address)}`,{signal,cache:'no-store'})
      if (!response.ok) throw new Error('Cardano ownership unavailable')
      const result=await response.json() as {address?:unknown;policy?:unknown;quantity?:unknown}
      if(result.address!==address || result.policy!==gate.contract || typeof result.quantity!=='string' || !/^\d+$/.test(result.quantity))throw new Error('Invalid policy proof')
      if(BigInt(result.quantity)>0n)return true
    }
    return false
  }
  const ethereum=id==='sappy-seals-art'
  const rpcUrl=ethereum?'https://ethereum-rpc.publicnode.com':'https://rpc.monad.xyz'
  let counter=0
  const rpc=async(method:string,params:unknown[])=>{
    const requestId=++counter
    const response=await request(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal,cache:'no-store'})
    if(!response.ok)throw new Error('Collection network unavailable')
    const data=await response.json() as {id?:unknown;jsonrpc?:unknown;result?:unknown;error?:unknown}
    if(data.id!==requestId || data.jsonrpc!=='2.0' || data.error || typeof data.result!=='string')throw new Error('Invalid RPC response')
    return data.result
  }
  const chain=await rpc('eth_chainId',[])
  if(!/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain)!==(ethereum?1n:143n))throw new Error('Wrong chain')
  const block=await rpc('eth_blockNumber',[])
  if(!/^0x[0-9a-f]+$/i.test(block))throw new Error('Invalid block')
  const call=async(data:string)=>{
    const result=await rpc('eth_call',[{to:gate.contract,data},block])
    if(!/^0x[0-9a-f]{64}$/i.test(result))throw new Error('Invalid contract response')
    return BigInt(result)
  }
  // NFT collections must prove ERC-721 support. Emonad is a fungible ERC-20.
  if(id!=='emonad' && await call('0x01ffc9a780ac58cd'+'0'.repeat(56))!==1n)throw new Error('Not ERC-721')
  if(id==='emonad' && await call('0x313ce567')!==18n)throw new Error('Unexpected EMONAD decimals')
  const minimum=id==='emonad' ? 10_000n * 10n**18n : 1n
  for(const owner of addresses)if(await call('0x70a08231'+owner.slice(2).padStart(64,'0'))>=minimum)return true
  return false
}

export function createCollectionAccess(options: {changed:()=>void;currentOwners?:()=>Promise<ThemeOwner[]>;request?:typeof fetch;cardanoBase?:string}) {
  let owners:ThemeOwner[]=[],generation=0
  const states=Object.fromEntries(IDS.map(id=>[id,inactive()])) as Record<CollectionThemeId,CollectionState>
  const pending=new Map<CollectionThemeId,{controller:AbortController;promise:Promise<void>}>()
  const get=(id:string):CollectionState=>isCollectionTheme(id)?states[id]:inactive()
  const allowed=(id:string)=>!isCollectionTheme(id) || states[id].status==='owned' && Date.now()-states[id].checkedAt<FRESH_MS
  const publish=(id:CollectionThemeId,next:CollectionState)=>{states[id]=next;options.changed()}
  function bind(next:ThemeOwner[]) {
    const normalized=normalize(next)
    if(JSON.stringify(normalized)===JSON.stringify(owners))return
    ++generation;for(const job of pending.values())job.controller.abort();pending.clear();owners=normalized
    for(const id of IDS)states[id]=inactive()
    options.changed()
    for(const id of IDS)if(owners.some(o=>o.chain===COLLECTION_GATES[id].chain))void refresh(id)
  }
  function refresh(id:CollectionThemeId):Promise<void> {
    if(pending.has(id))return pending.get(id)!.promise
    if(!owners.some(o=>o.chain===COLLECTION_GATES[id].chain))return Promise.resolve()
    const epoch=generation,expected=owners.slice(),controller=new AbortController()
    let expired=false
    publish(id,{...states[id],status:allowed(id)?'owned':'checking',checking:true})
    const timer=setTimeout(()=>{expired=true;controller.abort();if(epoch===generation){pending.delete(id);publish(id,{...inactive(),status:'error'})}},15_000)
    const promise=(async()=>{
      try{
        const owned=await readCollectionOwnership(id,expected,controller.signal,options.request,options.cardanoBase)
        if(epoch!==generation || expired)return
        if(options.currentOwners){const current=normalize(await options.currentOwners());if(epoch!==generation || expired)return;if(JSON.stringify(current)!==JSON.stringify(expected)){bind(current);return}}
        publish(id,{status:owned?'owned':'locked',checking:false,checkedAt:Date.now()})
      }catch{if(epoch===generation && !expired)publish(id,{...inactive(),status:'error'})}
      finally{clearTimeout(timer);if(epoch===generation && !expired)pending.delete(id)}
    })()
    pending.set(id,{controller,promise})
    return promise
  }
  const tick=()=>{
    if(document.hidden)return
    for(const id of IDS){if(states[id].status==='owned' && !allowed(id))options.changed();if(document.documentElement.getAttribute('data-theme')===id || document.documentElement.getAttribute('data-cl-art-theme')===id)void refresh(id)}
  }
  const timer=setInterval(tick,30_000)
  const focus=()=>{if(document.hidden)return;for(const id of IDS){if(!allowed(id))options.changed();void refresh(id)}}
  window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus)
  return {get,allowed,bind,refresh,dispose:()=>{++generation;for(const job of pending.values())job.controller.abort();pending.clear();clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus)}}
}
