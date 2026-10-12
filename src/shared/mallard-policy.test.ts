import {it,expect,vi} from 'vitest'
import {readCurrentMallardOwnership,readMallardPolicy,mallardStakeAddress,MALLARD_POLICY} from './mallard-policy'
const address='addr1vyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygatvcjl'
const proofRequest=()=>vi.fn(async(_url:unknown,init:any)=>{
  expect(JSON.parse(init.body)).toEqual({_addresses:[address]})
  return new Response(JSON.stringify([{address,policy_id:MALLARD_POLICY,asset_name:'01',quantity:'1'}]))
})
it('reads the unlocked current payment address directly and reconfirms the session',async()=>{
  const session=vi.fn(async()=>({unlocked:true,address})),request=proofRequest()
  expect(await readCurrentMallardOwnership(session,request as typeof fetch)).toEqual({address,policy:MALLARD_POLICY,quantity:'1'})
  expect(session).toHaveBeenCalledTimes(2)
  expect(String(request.mock.calls[0][0])).toContain('https://api.koios.rest/api/v1/address_assets?policy_id=eq.'+MALLARD_POLICY)
})
it('a locked wallet never queries the policy or grants access',async()=>{
  const request=proofRequest()
  await expect(readCurrentMallardOwnership(async()=>({unlocked:false,address}),request as typeof fetch)).rejects.toThrow('Unlock')
  expect(request).not.toHaveBeenCalled()
})
it('locking or switching accounts during a read invalidates its result',async()=>{
  for(const after of [{unlocked:false,address},{unlocked:true,address:null}]){
    let calls=0
    await expect(readCurrentMallardOwnership(async()=>++calls===1?{unlocked:true,address}:after,proofRequest() as typeof fetch)).rejects.toThrow('Wallet account changed')
  }
})
const holder='addr1q950qv0ks9t29mavulaa5jr3sk2s50r5jfsddydjs0pazrfh32tdpt7zttt4mhl6t9purm4c9rv555z7r5mulq78aleqcg9c9h'
const stake='stake1uymc49ks4lp9446amla9js7pa6uz3k222p0p6d70s0r7lusa2awnr'
it('includes Mallard3348 associated with the wallet stake account when the first payment address has none',async()=>{
  expect(mallardStakeAddress(holder)).toBe(stake)
  const calls:string[]=[]
  const request=vi.fn(async(url:unknown,init:any)=>{
    calls.push(String(url))
    if(String(url).includes('/address_assets'))return new Response('[]')
    expect(JSON.parse(init.body)).toEqual({_stake_addresses:[stake]})
    return new Response(JSON.stringify([{stake_address:stake,policy_id:MALLARD_POLICY,asset_name:'4d616c6c6172644f7264657233333438',quantity:'1'}]))
  })
  expect((await readMallardPolicy(holder,request as typeof fetch)).quantity).toBe('1')
  expect(calls).toHaveLength(2)
})
it('does not accept a provider-selected stake account or another policy as eligibility',async()=>{
  for(const wrong of [{stake_address:'stake1other',policy_id:MALLARD_POLICY},{stake_address:stake,policy_id:'f'.repeat(56)}]){
    const request=vi.fn(async(url:unknown)=>new Response(String(url).includes('/address_assets')?'[]':JSON.stringify([{...wrong,asset_name:'01',quantity:'1'}]))) as unknown as typeof fetch
    if(wrong.stake_address!==stake)await expect(readMallardPolicy(holder,request)).rejects.toThrow('Invalid asset balance')
    else expect((await readMallardPolicy(holder,request)).quantity).toBe('0')
  }
})
it('mainnet checksum/network validation rejects malformed and testnet addresses',async()=>{
  expect(()=>mallardStakeAddress(holder.slice(0,-1)+'q')).toThrow()
  await expect(readMallardPolicy('addr_test1incorrect')).rejects.toThrow('Invalid mainnet')
  expect(mallardStakeAddress(address)).toBe(null)
})
