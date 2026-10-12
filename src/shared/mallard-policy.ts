/** Fixed-policy account read; native processes bypass Koios's browser CORS restriction. */
import {bech32} from '@scure/base'
export type MallardProof={address:string;policy:string;quantity:string}
export const MALLARD_POLICY='901ba6e9831b078e131a1cc403d6139af21bda255cea6c9f770f4834'
/** Derive the key stake credential from the address itself, never from provider input. */
export function mallardStakeAddress(address:string):string|null {
  const decoded=bech32.decode(address as `${string}1${string}`,200)
  const bytes=bech32.fromWords(decoded.words),type=bytes[0]>>4
  if(decoded.prefix!=='addr' || (bytes[0]&15)!==1 || ![0,1,2,3,4,5,6,7].includes(type))throw new Error('Invalid mainnet payment address')
  if((type===0 || type===1) && bytes.length===57)return bech32.encode('stake',bech32.toWords(Uint8Array.from([0xe1,...bytes.slice(29)])),200)
  if((type===6 || type===7) && bytes.length===29)return null
  // No stake-account expansion for pointer or script-stake credentials.
  if([2,3].includes(type) && bytes.length===57 || [4,5].includes(type) && bytes.length>=32)return null
  throw new Error('Invalid mainnet payment address')
}
export async function readMallardPolicy(address:string,request:typeof fetch=fetch):Promise<MallardProof> {
  if(typeof address!=='string' || !/^addr1[023456789acdefghjklmnpqrstuvwxyz]{50,120}$/.test(address))throw new Error('Invalid mainnet payment address')
  const stake=mallardStakeAddress(address),signal=AbortSignal.timeout(12000)
  async function holdings(kind:'address'|'account',owner:string):Promise<bigint> {
    let quantity=0n;const seen=new Set<string>()
    for(let page=0;page<100;page++){
      const response=await request(`https://api.koios.rest/api/v1/${kind}_assets?policy_id=eq.${MALLARD_POLICY}&limit=1000&offset=${page*1000}`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(kind==='address'?{_addresses:[owner]}:{_stake_addresses:[owner]}),signal,cache:'no-store'})
      if(!response.ok)throw new Error('Cardano provider unavailable')
      const assets=await response.json()
      if(!Array.isArray(assets) || assets.length>1000)throw new Error('Invalid asset response')
      for(const asset of assets){
        if((kind==='address'?asset.address:asset.stake_address)!==owner || typeof asset.policy_id!=='string' || !/^[0-9a-f]{56}$/.test(asset.policy_id) || typeof asset.asset_name!=='string' || !/^(?:[0-9a-f]{2}){0,32}$/.test(asset.asset_name) || typeof asset.quantity!=='string' || !/^\d+$/.test(asset.quantity))throw new Error('Invalid asset balance')
        const unit=asset.policy_id+asset.asset_name;if(seen.has(unit))throw new Error('Repeated asset page');seen.add(unit)
        if(asset.policy_id===MALLARD_POLICY)quantity+=BigInt(asset.quantity)
      }
      if(assets.length<1000)return quantity
    }
    throw new Error('Asset pagination incomplete')
  }
  const direct=await holdings('address',address)
  // Account-scoped NFT eligibility includes staking/script addresses sharing this
  // wallet's key stake credential, matching the existing collectible scanner.
  const quantity=direct>0n || !stake ? direct : await holdings('account',stake)
  return {address,policy:MALLARD_POLICY,quantity:quantity.toString()}
}

/** Reconfirm the unlocked account after the network read, including account switches. */
export async function readCurrentMallardOwnership(session:()=>Promise<{unlocked:boolean;address:string|null}>,request:typeof fetch=fetch):Promise<MallardProof> {
  const before=await session()
  if(!before.unlocked || !before.address)throw new Error('Unlock the wallet first')
  const proof=await readMallardPolicy(before.address,request)
  const after=await session()
  if(!after.unlocked || after.address!==before.address)throw new Error('Wallet account changed')
  return proof
}
