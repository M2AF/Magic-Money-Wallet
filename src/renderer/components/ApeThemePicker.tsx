import { useEffect,useState } from 'react'
import { apeAccess,onApeAccess } from '../lib/ape-access'
export function ApeThemePicker(){
  const [state,setState]=useState(apeAccess.get)
  useEffect(()=>onApeAccess(()=>setState({...apeAccess.get()})),[])
  return <div className="ape-holder-picker" aria-live="polite">
    {state.apes.length>0 && <label>Theme ape<select aria-label="Theme ape" value={state.selected ? `${state.selected.owner}:${state.selected.id}` : ''} onChange={event=>{const [owner,id]=event.target.value.split(':');void apeAccess.select(owner,id)}}>
      {!state.selected && <option value="" disabled>Choose your ape</option>}
      {state.apes.map(ape=><option key={`${ape.owner}:${ape.id}`} value={`${ape.owner}:${ape.id}`}>{ape.name} · #{ape.id}</option>)}
    </select></label>}
    {!state.complete && <small>Showing verified apes. Refresh after recent transfers.</small>}
  </div>
}
