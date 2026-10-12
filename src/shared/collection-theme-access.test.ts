import {it,expect,vi,afterEach} from 'vitest'
import {readCollectionOwnership,createCollectionAccess,COLLECTION_GATES,type ThemeOwner} from './collection-theme-access'
const owners:ThemeOwner[]=[{chain:'evm',address:'0x1111111111111111111111111111111111111111'}]
const cardano:ThemeOwner={chain:'cardano',address:'addr1vyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygatvcjl'}
function rpc(balance:bigint,chain='0x8f'){
  const request=vi.fn(async(_url:unknown,init:any)=>{
    const call=JSON.parse(init.body),data=call.params[0]?.data||''
    const result=call.method==='eth_chainId'?chain:call.method==='eth_blockNumber'?'0xabc':'0x'+(data.startsWith('0x313ce567')?18n:data.startsWith('0x01ffc9a7')?1n:balance).toString(16).padStart(64,'0')
    return new Response(JSON.stringify({jsonrpc:'2.0',id:call.id,result}))
  })
  return request
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
it('EMONAD requires exactly 10,000 whole tokens, not a dust holding',async()=>{
  expect(await readCollectionOwnership('emonad',owners,undefined,rpc(10_000n*10n**18n) as typeof fetch)).toBe(true)
  expect(await readCollectionOwnership('emonad',owners,undefined,rpc(10_000n*10n**18n-1n) as typeof fetch)).toBe(false)
})
it('NFT gates use the supplied contracts, chain143 and measured block',async()=>{
  for(const id of ['sealuminati','r3tards'] as const){
    const request=rpc(1n);expect(await readCollectionOwnership(id,owners,undefined,request as typeof fetch)).toBe(true)
    const calls=request.mock.calls.map(c=>JSON.parse(c[1].body)).filter(c=>c.method==='eth_call')
    expect(calls.every(c=>c.params[0].to===COLLECTION_GATES[id].contract && c.params[1]==='0xabc')).toBe(true)
    expect(await readCollectionOwnership(id,owners,undefined,rpc(0n) as typeof fetch)).toBe(false)
    await expect(readCollectionOwnership(id,owners,undefined,rpc(1n,'0x1') as typeof fetch)).rejects.toThrow('Wrong chain')
  }
})
it('Mallard requires the exact mainnet policy and payment address, not ADA or another policy',async()=>{
  const response=(quantity:string,policy:string=COLLECTION_GATES['mallard-order'].contract,address=cardano.address)=>vi.fn(async()=>new Response(JSON.stringify({quantity,policy,address}))) as unknown as typeof fetch
  expect(await readCollectionOwnership('mallard-order',[cardano],undefined,response('1'))).toBe(true)
  expect(await readCollectionOwnership('mallard-order',[cardano],undefined,response('0'))).toBe(false)
  await expect(readCollectionOwnership('mallard-order',[cardano],undefined,response('1','f'.repeat(56)))).rejects.toThrow('Invalid policy')
  await expect(readCollectionOwnership('mallard-order',[cardano],undefined,response('1',undefined,'addr1other'))).rejects.toThrow('Invalid policy')
  expect(await readCollectionOwnership('mallard-order',owners,undefined,response('1'))).toBe(false)
})
it('rejects malformed RPC responses instead of unlocking',async()=>{
  const request=vi.fn(async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:999,result:'0x8f'}))) as unknown as typeof fetch
  await expect(readCollectionOwnership('emonad',owners,undefined,request)).rejects.toThrow('Invalid RPC')
})
function dom(){
  vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()})
  vi.stubGlobal('document',{hidden:false,documentElement:{getAttribute:()=>null},addEventListener:vi.fn(),removeEventListener:vi.fn()})
}
it('lock/account reset discards late responses and cannot persist entitlement',async()=>{
  dom();const resolves:Array<(r:Response)=>void>=[]
  let late=false;const normal=rpc(1n);const request=vi.fn((url:any,init:any)=>late ? normal(url,init) : new Promise<Response>(r=>{resolves.push(r)}))
  const access=createCollectionAccess({changed:vi.fn(),request:request as typeof fetch})
  access.bind(owners);const job=access.refresh('sealuminati');access.bind([])
  late=true;for(const resolve of resolves)resolve(new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x8f'})));await job
  expect(access.allowed('sealuminati')).toBe(false);expect(access.get('emonad').status).toBe('locked');access.dispose()
})
it('checks the current account again before granting access and expires after 90 seconds',async()=>{
  dom();vi.useFakeTimers();let current=owners
  const access=createCollectionAccess({changed:vi.fn(),request:rpc(10_000n*10n**18n) as typeof fetch,currentOwners:async()=>current})
  access.bind(owners);await access.refresh('emonad');expect(access.allowed('emonad')).toBe(true)
  Object.defineProperty(document,'hidden',{value:true,configurable:true});await vi.advanceTimersByTimeAsync(90_001);expect(access.allowed('emonad')).toBe(false)
  current=[];await access.refresh('emonad');expect(access.get('emonad').status).toBe('locked');access.dispose()
})
it('a hung provider fails closed at the timeout',async()=>{
  dom();vi.useFakeTimers();const access=createCollectionAccess({changed:vi.fn(),request:(()=>new Promise(()=>{})) as typeof fetch})
  access.bind(owners);await vi.advanceTimersByTimeAsync(15_000);expect(access.get('sealuminati').status).toBe('error');expect(access.allowed('sealuminati')).toBe(false);access.dispose()
})

it('Sappy Seals proves Ethereum ERC721 ownership against the supplied contract and fails closed on Monad',async()=>{
  const request=rpc(1n,'0x1')
  expect(await readCollectionOwnership('sappy-seals-art',owners,undefined,request as typeof fetch)).toBe(true)
  expect(request.mock.calls.every(c=>c[0]==='https://ethereum-rpc.publicnode.com')).toBe(true)
  const calls=request.mock.calls.map(c=>JSON.parse(c[1].body)).filter(c=>c.method==='eth_call')
  expect(calls.every(c=>c.params[0].to===COLLECTION_GATES['sappy-seals-art'].contract && c.params[1]==='0xabc')).toBe(true)
  expect(await readCollectionOwnership('sappy-seals-art',owners,undefined,rpc(0n,'0x1') as typeof fetch)).toBe(false)
  await expect(readCollectionOwnership('sappy-seals-art',owners,undefined,rpc(1n) as typeof fetch)).rejects.toThrow('Wrong chain')
})
