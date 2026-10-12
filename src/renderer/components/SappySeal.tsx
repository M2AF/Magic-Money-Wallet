/// <reference types="vite/client" />
import {useEffect,useRef,useState} from 'react'
import coreUrl from '../assets/themes/sappy-seals/live2dcubismcore.min.js?url'
import pixiUrl from '../assets/themes/sappy-seals/pixi.min.js?url'
import cspUrl from '../assets/themes/sappy-seals/pixi-csp.js?url'
import displayUrl from '../assets/themes/sappy-seals/browser.js?url'
import mocUrl from '../assets/themes/sappy-seals/Seal Login.moc3?url'
import physicsUrl from '../assets/themes/sappy-seals/Seal Login.physics3.json?url'
import textureUrl from '../assets/themes/sappy-seals/Seal Login.4096/texture.png'
import alternateTextureUrl from '../assets/themes/sappy-seals/Seal Login.4096/texture_00.png'
import {alternateSeal,setAlternateSeal,SEAL_APPEARANCE_KEY,SEAL_APPEARANCE_EVENT} from '../lib/seal-appearance'
import fallbackUrl from '../assets/themes/sappy-seals/seal-head.786c8b01.png'

const motions=import.meta.glob('../assets/themes/sappy-seals/Motions/*.motion3.json',{eager:true,query:'?url',import:'default'}) as Record<string,string>
// Runtime globals stay private to this presentation module; wallet APIs are never passed in.
type Runtime={PIXI:any;Live2DCubismCore:any}
let loading:Promise<Runtime>|null=null
const script=(src:string)=>new Promise<void>((resolve,reject)=>{
  const node=document.createElement('script');node.src=src
  node.onload=()=>resolve();node.onerror=()=>{node.remove();reject(new Error('Seal runtime unavailable'))}
  document.head.appendChild(node)
})
async function runtime():Promise<Runtime>{
  if(!loading)loading=(async()=>{
    const scope=window as unknown as Runtime
    if(!scope.Live2DCubismCore)await script(coreUrl)
    if(!scope.PIXI)await script(pixiUrl)
    await script(cspUrl)
    if(!scope.PIXI.live2d)await script(displayUrl)
    return scope
  })().catch(error=>{loading=null;throw error})
  return loading
}
const clickMotions=['Enter','Excited_Enter','Excited_Constant','Excited_Exit','Wrong_Pass','Failed_Enter','Failed_Constant','Failed_Exit','Sleepy_Enter','Sleepy_Constant','Sleepy_Exit','Coffee','Exit'] as const
const selected=()=>document.documentElement.dataset.theme==='sappy-seals-art' && !document.documentElement.hasAttribute('data-derived')

function useAlternateSeal(){
  const [alternate,setAlternate]=useState(alternateSeal)
  useEffect(()=>{
    const changed=()=>setAlternate(alternateSeal())
    const storage=(event:StorageEvent)=>{if(event.key===SEAL_APPEARANCE_KEY || event.key===null)changed()}
    window.addEventListener(SEAL_APPEARANCE_EVENT,changed);window.addEventListener('storage',storage)
    return()=>{window.removeEventListener(SEAL_APPEARANCE_EVENT,changed);window.removeEventListener('storage',storage)}
  },[])
  return alternate
}
export function SappySealAppearance(){
  const alternate=useAlternateSeal()
  return <button type="button" className="sappy-seal-appearance" aria-label="Use alternate seal artwork" aria-pressed={alternate} title={`Alternate seal artwork: ${alternate?'On':'Off'}`} onClick={()=>setAlternateSeal(!alternate)}> <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 4 3 7l3 5 2-1v9h8v-9l2 1 3-5-5-3a4 4 0 0 1-8 0Z"/></svg></button>
}

/** One small, locally bundled Live2D scene above the portfolio's tab fence. */
export function SappySeal(){
  const [enabled,setEnabled]=useState(selected)
  const alternate=useAlternateSeal()
  const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const observer=new MutationObserver(()=>setEnabled(selected()))
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-derived']})
    return()=>observer.disconnect()
  },[])
  useEffect(()=>{
    if(!enabled || !host.current || !canvas.current)return
    const element=host.current,view=canvas.current,reduced=matchMedia('(prefers-reduced-motion: reduce)')
    delete element.dataset.ready
    let clickIndex=0,clickCount=0
    delete element.dataset.clickCount
    delete element.dataset.clickMotion
    let disposed=false,visible=true,app:any=null,model:any=null,lastPoint:{x:number;y:number}|null=null
    const running=()=>!disposed && visible && !document.hidden && !reduced.matches
    const sync=()=>{if(!app)return;if(model && running())app.start();else app.stop()}
    const focus=(event:PointerEvent)=>{if(running())lastPoint={x:event.clientX,y:event.clientY}}
    // Passive click handling also receives native touch taps and preserves wallet actions.
    const click=()=>{
      if(!model || !running())return
      const group=clickMotions[clickIndex++%clickMotions.length]
      void model.motion(group,0,3).catch(()=>{/* Keep the idle/focus scene if one motion fails. */})
    }
    const neutral=()=>{lastPoint=null;model?.focus(view.clientWidth/2,view.clientHeight/2,true)}
    const visibility=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??false;sync()})
    visibility.observe(element)
    const fit=()=>{
      if(!app || !model)return
      const w=view.clientWidth,h=view.clientHeight
      app.renderer.resize(w,h)
      model.scale.set(1)
      const scale=Math.min(w/model.width,h/model.height)
      model.scale.set(scale)
      model.anchor.set(.5,1);model.position.set(w/2,h+28)
      model.update(16);app.render()
    }
    const resize=new ResizeObserver(fit);resize.observe(view)
    window.addEventListener('pointermove',focus,{passive:true});window.addEventListener('pointerdown',focus,{passive:true})
    window.addEventListener('click',click,{passive:true})
    window.addEventListener('blur',neutral);document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync)
    void (async()=>{
      try{
        const {PIXI}=await runtime()
        if(disposed)return
        app=new PIXI.Application({view,width:220,height:160,transparent:true,backgroundAlpha:0,antialias:true,autoStart:false,resolution:Math.min(devicePixelRatio||1,1.5)})
        app.ticker.maxFPS=30
        const absolute=(url:string)=>new URL(url,window.location.href).href
        const groups:Record<string,Array<{File:string}>>={}
        const names=['Idle','Blinking','Enter','Exit','Failed_Enter','Failed_Constant','Failed_Exit','Wrong_Pass','Excited_Enter','Excited_Constant','Excited_Exit','Sleepy_Enter','Sleepy_Constant','Sleepy_Exit','Coffee']
        for(const [path,url]of Object.entries(motions)){
          const index=Number(path.substring(path.lastIndexOf('/')+1).split('.')[0])
          const group=index===0?'Idle':names[index+1]
          if(group)(groups[group]??=[]).push({File:absolute(url)})
        }
        const loaded=await PIXI.live2d.Live2DModel.from({url:absolute(mocUrl),Version:3,FileReferences:{Moc:absolute(mocUrl),Textures:[absolute(alternate?alternateTextureUrl:textureUrl)],Physics:absolute(physicsUrl),Motions:groups},Groups:[{Target:'Parameter',Name:'EyeBlink',Ids:[]},{Target:'Parameter',Name:'LipSync',Ids:[]}]},{autoInteract:false,autoUpdate:false})
        if(disposed){loaded.destroy({texture:true,baseTexture:true});return}
        model=loaded;app.stage.addChild(model);fit()
        model.internalModel.motionManager.on('motionStart',(group:string)=>{
          if(group!=='Idle' && !disposed){element.dataset.clickMotion=group;element.dataset.clickCount=String(++clickCount)}
        })
        if(!reduced.matches)void model.motion('Idle',0,1)
        // Cubism restores saved parameters after drawing; inspect the value used for deformation.
        model.internalModel.on('beforeModelUpdate',()=>{view.dataset.headAngle=String(model.internalModel.coreModel.getParameterValueById('ParamAngleX'))})
        app.ticker.add(()=>{
          if(lastPoint){const box=view.getBoundingClientRect();model.focus(lastPoint.x-box.left,lastPoint.y-box.top)}
          model.update(app.ticker.deltaMS)
        })
        element.dataset.artwork=alternate?'alternate':'original';element.dataset.ready='true';sync()
      }catch{if(!disposed)element.dataset.ready='fallback'}
    })()
    return()=>{
      disposed=true;visibility.disconnect();resize.disconnect()
      window.removeEventListener('pointermove',focus);window.removeEventListener('pointerdown',focus);window.removeEventListener('click',click);window.removeEventListener('blur',neutral)
      document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync)
      app?.stop();app?.destroy(false,{children:true,texture:true,baseTexture:true});app=null;model=null
    }
  },[enabled,alternate])
  return enabled ? <div ref={host} className="sappy-seal-peek" aria-hidden="true"><img className="sappy-seal-fallback" src={fallbackUrl} alt=""/><canvas ref={canvas} className="sappy-seal-canvas"/></div> : null
}
