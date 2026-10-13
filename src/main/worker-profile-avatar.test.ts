import {afterEach,expect,it,vi} from 'vitest'
import {privateKeyToAccount} from 'viem/accounts'
const account=privateKeyToAccount('0x'+'11'.repeat(32) as `0x${string}`)
const ID='ec18dcf5-3271-46fd-8029-41e5b2f39eed'
afterEach(()=>vi.unstubAllGlobals())
async function request(watchOnly=false,target=ID,badSignature=false){
  // @ts-expect-error -- untyped Worker module
  const {handleDb}=await import('../../cloudflare-worker/db.js')
  const patches:{url:string;body:unknown}[]=[]
  vi.stubGlobal('fetch',vi.fn(async(input:string,init:RequestInit)=>{
    if(init.method==='PATCH'){patches.push({url:input,body:JSON.parse(String(init.body))});return new Response('[]')}
    return new Response(JSON.stringify([{user_id:ID,watch_only:watchOnly}]))
  }))
  const address=account.address.toLowerCase(),ts=Date.now()
  const signature=badSignature?'0x00':await account.signMessage({message:`MagicMoney Wallet ownership\naction:profile-update\naddress:${address}\nts:${ts}`})
  const url=new URL('https://worker.example/profile/update')
  const response=await handleDb(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:target,address,ts,signature,avatar_url:'https://art.example/a.png',avatar_nft_key:'ethereum:n:0xabc:3'})}),url,{SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_KEY:'fixture-only'},{waitUntil(){}})
  return {response,patches}
}
it('signed verified EVM link can update an NFT avatar on a Solana/social-created profile',async()=>{
  const {response,patches}=await request()
  expect(response.status).toBe(200);expect(patches).toEqual([{url:`https://db.example/rest/v1/cl_users?id=eq.${ID}`,body:{avatar_url:'https://art.example/a.png',avatar_nft_key:'ethereum:n:0xabc:3'}}])
})
it('watch-only and unrelated profiles cannot be edited, and invalid signatures never write',async()=>{
  const cases:Array<[boolean,string,boolean]>=[[true,ID,false],[false,'3f2c6cb8-2a43-4b69-bf5e-099ef63be79f',false],[false,ID,true]]
  for(const [watchOnly,target,badSignature] of cases){
    const {response,patches}=await request(watchOnly,target,badSignature);expect(response.status).toBe(badSignature?401:403);expect(patches).toHaveLength(0)
  }
})
