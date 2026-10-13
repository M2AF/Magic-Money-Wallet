import type { CollectiblesResult } from '../types/wallet'
import { mergeCollectiblesUpdate } from './collectibles-updates'

// Shared by the mounted portfolio and profile picker; no second inventory scan.
let cache: {owner: string; result: CollectiblesResult; at: number} | null = null
const pending = new Map<string, Promise<CollectiblesResult>>()
let epoch=0
export function clearProfileCollectibles(){epoch++;cache=null;pending.clear()}
export const profileCollectionOwner = (address: string, account: number, testnet: boolean) => `${address.toLowerCase()}:${account}:${testnet}`
export function rememberProfileCollectibles(owner: string, result: CollectiblesResult) {
  if(result.ownerAddress && result.ownerAddress.toLowerCase() !== owner.split(':')[0])return
  cache = {owner, result:mergeCollectiblesUpdate(cache?.owner===owner ? cache.result : null,result), at: Date.now()}
}
export async function loadProfileCollectibles(owner: string, exclude: string[] = [], refresh = false): Promise<CollectiblesResult> {
  if (!refresh && cache?.owner === owner && Date.now()-cache.at < 5*60*1000) return cache.result
  const existing = pending.get(owner)
  if (existing) return existing
  const generation=epoch
  const request = window.wallet.getCollectibles(exclude).then(result=>{
    if(generation===epoch)rememberProfileCollectibles(owner,result); return result
  }).finally(()=>{if(pending.get(owner)===request)pending.delete(owner)})
  pending.set(owner,request)
  return request
}
