import { expect,it,vi,afterEach } from 'vitest'
import { APE_CONTRACT,readOwnedApes,decodeApeUri,apeImageUrls } from './ape-theme-core'
import { createApeAccess } from './ape-theme-access'
const OWNER='0x1111111111111111111111111111111111111111',OTHER='0x2222222222222222222222222222222222222222'
const word=(n:bigint)=>'0x'+n.toString(16).padStart(64,'0')
function fixture(options={balance:1,ids:['6637'],other:false,chain:'0x1'}){
  const calls:Array<{method:string;params:any[]}>=[]
  const request=vi.fn(async(url:any,init:any={})=>{
    if(String(url).includes('blockscout'))return new Response(JSON.stringify({items:options.ids.map(id=>({id})),next_page_params:null}))
    const call=JSON.parse(init.body),data=call.params?.[0]?.data || '';calls.push(call)
    let result=call.method==='eth_chainId'?options.chain:call.method==='eth_blockNumber'?'0xabc':word(BigInt(options.balance))
    if(data.startsWith('0x6352211e'))result='0x'+(options.other?OTHER:OWNER).slice(2).padStart(64,'0')
    if(data.startsWith('0xc87b56dd')){const meta={name:'Roch Edwards',image:'ipfs://bafyfixture/6637.jpg'};const b=Buffer.from('data:application/json;base64,'+Buffer.from(JSON.stringify(meta)).toString('base64'));result=word(32n)+word(BigInt(b.length)).slice(2)+b.toString('hex').padEnd(Math.ceil(b.length/32)*64,'0')}
    return new Response(JSON.stringify({jsonrpc:'2.0',id:call.id,result}))
  })
  return {request,calls}
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks()})
it('verifies candidate ownerOf and tokenURI at the same measured Ethereum block',async()=>{
  const f=fixture();const result=await readOwnedApes([OWNER],undefined,f.request as typeof fetch)
  expect(result.apes[0]).toMatchObject({id:'6637',owner:OWNER,name:'Roch Edwards'})
  expect(result.complete).toBe(true)
  for(const call of f.calls.filter(c=>c.method==='eth_call')){expect(call.params[0].to).toBe(APE_CONTRACT);expect(call.params[1]).toBe('0xabc')}
  expect(f.calls.some(c=>c.params[0]?.data?.startsWith('0x6352211e'))).toBe(true)
})
it('zero balance skips discovery and cannot unlock',async()=>{
  const f=fixture({balance:0,ids:['6637'],other:false,chain:'0x1'});expect((await readOwnedApes([OWNER],undefined,f.request as typeof fetch)).apes).toEqual([])
  expect(f.request.mock.calls.some(c=>String(c[0]).includes('blockscout'))).toBe(false)
})
it('wrong chain and false indexer ownership cannot grant access',async()=>{
  const wrong=fixture({balance:1,ids:['6637'],other:false,chain:'0x1237'})
  await expect(readOwnedApes([OWNER],undefined,wrong.request as typeof fetch)).rejects.toThrow('Wrong chain')
  const falseOwner=fixture({balance:1,ids:['6637'],other:true,chain:'0x1'})
  await expect(readOwnedApes([OWNER],undefined,falseOwner.request as typeof fetch)).rejects.toThrow('not indexed')
})
it('rejects malformed ABI strings and unsafe artwork schemes',()=>{
  for(const value of ['0x','0x1234',word(64n)+word(100n).slice(2)])expect(()=>decodeApeUri(value)).toThrow()
  expect(apeImageUrls('javascript:alert(1)')).toEqual([]);expect(apeImageUrls('file:///secret')).toEqual([])
  expect(apeImageUrls('ipfs://bafyfixture/6637.jpg')[0]).toContain('gateway.pinata.cloud')
})
it('session removal discards late discovery and account-owned preferences',async()=>{
  vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()})
  vi.stubGlobal('document',{hidden:false,documentElement:{getAttribute:()=>null},addEventListener:vi.fn(),removeEventListener:vi.fn()})
  const storage=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v)})
  let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve})
  vi.stubGlobal('fetch',vi.fn(async()=>{await blocked;throw Error('late')}))
  const access=createApeAccess({prefix:'test',changed:vi.fn()})
  try{access.bind([OWNER]);const pending=access.refresh();access.bind([]);release();await pending;expect(access.allowed()).toBe(false);expect(access.get().apes).toEqual([])}finally{access.dispose()}
})
it('a hung check loses access at the hard timeout',async()=>{
  vi.useFakeTimers();vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()})
  vi.stubGlobal('document',{hidden:false,documentElement:{getAttribute:()=>null},addEventListener:vi.fn(),removeEventListener:vi.fn()})
  vi.stubGlobal('fetch',()=>new Promise(()=>{}))
  const access=createApeAccess({prefix:'test',changed:vi.fn()})
  try{access.bind([OWNER]);await vi.advanceTimersByTimeAsync(45000);expect(access.get().status).toBe('error');expect(access.allowed()).toBe(false)}finally{access.dispose()}
})
it('a newer selection in a second verified wallet wins over the first wallet preference',async()=>{
  vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()})
  vi.stubGlobal('document',{hidden:false,documentElement:{getAttribute:()=>null},addEventListener:vi.fn(),removeEventListener:vi.fn()})
  const storage=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v)})
  vi.stubGlobal('Image',class {naturalWidth=1;onload:(()=>void)|null=null;onerror:(()=>void)|null=null;set src(value:string){if(value)queueMicrotask(()=>this.onload?.())}})
  vi.stubGlobal('fetch',vi.fn(async(url:any,init:any={})=>{
    if(String(url).includes('blockscout'))return new Response(JSON.stringify({items:[{id:String(url).includes(OTHER)?'6638':'6637'}],next_page_params:null}))
    const call=JSON.parse(init.body),data=call.params?.[0]?.data || ''
    let result=call.method==='eth_chainId'?'0x1':call.method==='eth_blockNumber'?'0xabc':word(1n)
    if(data.startsWith('0x6352211e'))result='0x'+(data.endsWith(6638n.toString(16).padStart(64,'0'))?OTHER:OWNER).slice(2).padStart(64,'0')
    if(data.startsWith('0xc87b56dd')){const b=Buffer.from('data:application/json;base64,'+Buffer.from(JSON.stringify({name:'Owned Ape',image:'https://example.com/ape.jpg'})).toString('base64'));result=word(32n)+word(BigInt(b.length)).slice(2)+b.toString('hex').padEnd(Math.ceil(b.length/32)*64,'0')}
    return new Response(JSON.stringify({jsonrpc:'2.0',id:call.id,result}))
  }))
  const access=createApeAccess({prefix:'test',changed:vi.fn()})
  try{
    access.bind([OWNER,OTHER]);await access.refresh();expect(access.allowed()).toBe(true)
    await access.select(OWNER,'6637');await access.select(OTHER,'6638');expect(access.get().selected?.owner).toBe(OTHER)
    await access.refresh();expect(access.get().selected?.id).toBe('6638')
    access.bind([OWNER]);await access.refresh();expect(access.get().selected?.owner).toBe(OWNER)
    vi.spyOn(Date,'now').mockReturnValue(access.get().checkedAt+90000);expect(access.allowed()).toBe(false)
  }finally{access.dispose()}
})
