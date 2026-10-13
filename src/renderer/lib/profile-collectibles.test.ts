import {beforeEach,expect,it,vi} from 'vitest'
const result={items:[],fetchedAt:1,error:null,chainResults:{}}
beforeEach(()=>{vi.resetModules();vi.unstubAllGlobals()})
it('reuses portfolio inventory and joins its in-flight request without scanning twice',async()=>{
  let finish:(value:typeof result)=>void=()=>{}
  const get=vi.fn(()=>new Promise<typeof result>(resolve=>finish=resolve))
  vi.stubGlobal('window',{wallet:{getCollectibles:get}})
  const {loadProfileCollectibles:load}=await import('./profile-collectibles')
  const a=load('alice:0:false',[],true),b=load('alice:0:false')
  expect(get).toHaveBeenCalledTimes(1);finish(result);await Promise.all([a,b]);await load('alice:0:false');expect(get).toHaveBeenCalledTimes(1)
})
it('isolates accounts and networks and retries failed scans',async()=>{
  const get=vi.fn().mockResolvedValue(result);vi.stubGlobal('window',{wallet:{getCollectibles:get}})
  const {loadProfileCollectibles:load}=await import('./profile-collectibles')
  await load('alice:0:false');await load('bob:0:false');await load('bob:0:true');expect(get).toHaveBeenCalledTimes(3)
  get.mockRejectedValueOnce(new Error('Offline'));await expect(load('carol:0:false')).rejects.toThrow('Offline');await load('carol:0:false');expect(get).toHaveBeenCalledTimes(5)
})
it('clearing a locked session prevents a late scan from repopulating the picker',async()=>{
  let finish:(value:typeof result)=>void=()=>{}
  const get=vi.fn().mockImplementationOnce(()=>new Promise<typeof result>(resolve=>finish=resolve)).mockResolvedValue(result)
  vi.stubGlobal('window',{wallet:{getCollectibles:get}})
  const {loadProfileCollectibles:load,clearProfileCollectibles:clear}=await import('./profile-collectibles')
  const request=load('alice:0:false');clear();finish(result);await request;await load('alice:0:false');expect(get).toHaveBeenCalledTimes(2)
})
