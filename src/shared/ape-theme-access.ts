import { readOwnedApes, type OwnedApe } from './ape-theme-core'
export interface ApeAccessState { status:'locked'|'checking'|'owned'|'error'; apes:OwnedApe[]; selected:OwnedApe|null; image:string|null; checkedAt:number; complete:boolean }
/** No persisted entitlement. Only a verified owner's token preference is stored. */
export function createApeAccess(options: { prefix:string; changed:()=>void; currentOwners?:()=>Promise<string[]> }) {
  let owners:string[] = [], generation = 0, pending:Promise<void>|null = null, controller:AbortController|null = null
  let state:ApeAccessState = {status:'locked',apes:[],selected:null,image:null,checkedAt:0,complete:true}
  const allowed = () => state.status === 'owned' && !!state.selected && !!state.image && state.apes.some(a=>a.owner===state.selected?.owner && a.id===state.selected?.id) && Date.now()-state.checkedAt < 90000
  const publish = (next:ApeAccessState) => { state = next; options.changed() }
  const key = (owner:string) => options.prefix+'.'+owner
  const activeKey = () => options.prefix+'.active.'+owners.join(',')
  const preferred = () => {
    try { const saved=JSON.parse(localStorage.getItem(activeKey()) || 'null'); const ape=state.apes.find(a=>a.owner===saved?.owner && a.id===saved?.id); if(ape)return ape } catch { /* Invalid preference grants no access. */ }
    for (const owner of owners) { const id=localStorage.getItem(key(owner)); const ape=state.apes.find(a=>a.owner===owner && a.id===id); if(ape) return ape }
    return state.apes[0] || null
  }
  async function artwork(ape:OwnedApe, signal:AbortSignal):Promise<string> {
    for (const url of ape.images) {
      try {
        await new Promise<void>((resolve,reject)=>{
          const img=new Image(), timer=setTimeout(()=>finish(Error('Image timed out')),8000)
          const abort=()=>finish(Error('Aborted'))
          const finish=(error?:Error)=>{clearTimeout(timer); signal.removeEventListener('abort',abort); img.onload=null;img.onerror=null;if(error){img.src='';reject(error)}else resolve()}
          img.onload=()=>img.naturalWidth>0 ? finish() : finish(Error('Invalid image'))
          img.onerror=()=>finish(Error('Image unavailable'))
          signal.addEventListener('abort',abort,{once:true}); if(signal.aborted)abort();else img.src=url
        })
        return url
      } catch { if (signal.aborted) throw Error('Aborted') }
    }
    throw Error('Ape artwork unavailable')
  }
  async function refresh():Promise<void> {
    if (pending) return pending
    if (!owners.length) return
    const ticket=++generation, expected=owners.slice(), abort=new AbortController(); controller=abort
    const timer=setTimeout(()=>{
      if(ticket===generation){++generation;abort.abort();pending=null;publish({...state,status:'error',image:null,checkedAt:0})}
    },45000)
    publish({...state,status:allowed()?'owned':'checking'})
    pending=(async()=>{
      try {
        const result=await readOwnedApes(expected,abort.signal)
        if(ticket!==generation)return
        if(options.currentOwners){const current=(await options.currentOwners()).map(a=>a.toLowerCase()).sort();if(JSON.stringify(current)!==JSON.stringify(expected)){bind(current);return}}
        publish({...state,apes:result.apes,checkedAt:result.checkedAt,complete:result.complete})
        const selected=preferred()
        const image=selected ? await artwork(selected,abort.signal) : null
        if(ticket!==generation)return
        publish({...state,status:selected?'owned':'locked',selected,image})
      } catch {if(ticket===generation)publish({...state,status:'error',image:null,checkedAt:0})}
      finally{clearTimeout(timer);if(ticket===generation)pending=null}
    })()
    return pending
  }
  function bind(next:string[]) {
    const normalized=[...new Set(next.map(a=>a.toLowerCase()))].sort()
    ++generation;controller?.abort();pending=null;owners=normalized
    publish({status:normalized.length?'checking':'locked',apes:[],selected:null,image:null,checkedAt:0,complete:true})
    if(normalized.length)void refresh()
  }
  async function select(owner:string,id:string):Promise<void> {
    const ape=state.apes.find(a=>a.owner===owner && a.id===id)
    if(!ape || !owners.includes(owner))return
    localStorage.setItem(key(owner),id)
    localStorage.setItem(activeKey(),JSON.stringify({owner,id}))
    // Selection rechecks all on-chain ownership; an old tile cannot grant access.
    controller?.abort();++generation;pending=null
    await refresh()
  }
  const timer=setInterval(()=>{
    if(document.hidden)return
    if(state.status==='owned' && !allowed())options.changed()
    if(owners.length && document.documentElement.getAttribute('data-theme')==='ape-society' || owners.length && document.documentElement.getAttribute('data-cl-art-theme')==='ape-society')void refresh()
  },30000)
  const focus=()=>{if(!document.hidden && owners.length){if(!allowed())options.changed();void refresh()}}
  window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus)
  return {get:()=>state,allowed,bind,refresh,select,dispose:()=>{++generation;controller?.abort();clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus)}}
}
