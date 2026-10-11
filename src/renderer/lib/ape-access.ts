import { createApeAccess, type ApeAccessState } from '../../shared/ape-theme-access'
const listeners=new Set<()=>void>()
let controller:ReturnType<typeof createApeAccess>|null=null
const inactive:ApeAccessState={status:'locked',apes:[],selected:null,image:null,checkedAt:0,complete:true}
const getController=()=>controller ??= createApeAccess({prefix:'mm.ape-theme',changed:()=>{for(const listener of listeners)listener()},currentOwners:async()=>{
  const current=await window.wallet?.getAddresses()
  return current?.evm ? [current.evm] : []
}})
export const apeAccess={get:()=>controller?.get() ?? inactive,allowed:()=>controller?.allowed() ?? false,bind:(owners:string[])=>getController().bind(owners),refresh:()=>getController().refresh(),select:(owner:string,id:string)=>getController().select(owner,id)}
export const onApeAccess=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}}
export function initApeAccess(repaint:()=>void):void {
  getController()
  onApeAccess(()=>{
    const state=apeAccess.get()
    document.documentElement.style.setProperty('--ape-portrait',apeAccess.allowed() && state.image ? `url(${JSON.stringify(state.image)})` : 'none')
    repaint()
  })
  const browser=new URLSearchParams(window.location.search).has('browserChrome')
  if(browser){
    let epoch=0
    const sync=async()=>{
      const ticket=++epoch
      try{const unlocked=await window.wallet?.isUnlocked();const owner=unlocked ? await window.wallet.getAddresses() : null;if(ticket===epoch)apeAccess.bind(owner?.evm ? [owner.evm] : [])}catch{if(ticket===epoch)apeAccess.bind([])}
    }
    window.wallet?.onLocked?.(()=>{++epoch;apeAccess.bind([])})
    window.addEventListener('focus',()=>{void sync()});void sync()
  }
  window.addEventListener('storage',event=>{if(event.key?.startsWith('mm.ape-theme.'))void apeAccess.refresh()})
}
