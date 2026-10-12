import { createCollectionAccess, isCollectionTheme, COLLECTION_GATES, type ThemeOwner, type CollectionThemeId } from '../../shared/collection-theme-access'
export { isCollectionTheme, COLLECTION_GATES }
const listeners=new Set<()=>void>()
let access:ReturnType<typeof createCollectionAccess>|null=null
export const collectionOwners=(current:{evm?:string;cardano?:string}|null|undefined):ThemeOwner[]=>current ? [...(current.evm?[{chain:'evm' as const,address:current.evm}]:[]),...(current.cardano?[{chain:'cardano' as const,address:current.cardano}]:[])] : []
const controller=()=>access??=createCollectionAccess({request:async(input,init)=>{
  const url=String(input)
  if(url.startsWith('https://www.chainlensnft.info/api/theme-holder/mallard?')){
    if(init?.signal?.aborted)throw new Error('Ownership check cancelled')
    const proof=await window.wallet.getMallardOwnership()
    if(init?.signal?.aborted)throw new Error('Ownership check cancelled')
    return new Response(JSON.stringify(proof),{headers:{'Content-Type':'application/json'}})
  }
  return fetch(input,init)
},changed:()=>{for(const listener of listeners)listener()},currentOwners:async()=>collectionOwners(await window.wallet?.getAddresses())})
export const collectionAccess={allowed:(id:string)=>access?.allowed(id)??!isCollectionTheme(id),get:(id:string)=>access?.get(id)??{status:'locked' as const,checking:false,checkedAt:0},bind:(owners:ThemeOwner[])=>controller().bind(owners),refresh:(id:CollectionThemeId)=>controller().refresh(id)}
export const onCollectionAccess=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}}
export function initCollectionAccess(repaint:()=>void):void {
  controller();onCollectionAccess(repaint)
  if(new URLSearchParams(window.location.search).has('browserChrome')){
    let epoch=0
    const sync=async()=>{const ticket=++epoch;try{const unlocked=await window.wallet?.isUnlocked();const current=unlocked?await window.wallet.getAddresses():null;if(ticket===epoch)collectionAccess.bind(collectionOwners(current))}catch{if(ticket===epoch)collectionAccess.bind([])}}
    window.wallet?.onLocked?.(()=>{++epoch;collectionAccess.bind([])})
    window.addEventListener('focus',()=>{void sync()});void sync()
  }
}
