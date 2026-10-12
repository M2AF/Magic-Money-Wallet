// Pixi v5.3.12's MIT-licensed static uniform synchronizer. No eval permission.
import {syncUniforms} from './syncUniforms'
const PIXI=(window as any).PIXI
Object.assign(PIXI.systems.ShaderSystem.prototype,{
  systemCheck(){},
  syncUniforms(group:any,glProgram:any){
    const {shader,renderer}=this as any
    syncUniforms(group,shader.program.uniformData,glProgram.uniformData,group.uniforms,renderer)
  }
})
