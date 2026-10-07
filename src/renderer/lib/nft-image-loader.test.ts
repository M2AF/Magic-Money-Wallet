import { afterEach, expect, it, vi } from 'vitest'
import { createNftImageLoader } from './nft-image-loader'
function target() {
  return {src:'',onload:null,onerror:null,removeAttribute(this: {src:string}){this.src=''},decode:()=>Promise.resolve()} as unknown as HTMLImageElement
}
afterEach(()=>vi.useRealTimers())
it('limits displayed requests, releases cancelled slots, and remembers successful fallbacks',async()=>{
  const loader=createNftImageLoader(1),a=target(),b=target(),c=target(),report=vi.fn()
  const cancel=loader.load(['bad','good'],a,report)
  loader.load(['queued'],b,vi.fn())
  expect(a.src).toBe('bad'); expect(b.src).toBe('')
  a.onerror!(new Event('error')); expect(a.src).toBe('good')
  a.onload!(new Event('load')); await Promise.resolve()
  expect(report).toHaveBeenLastCalledWith({status:'loaded',url:'good'}); expect(b.src).toBe('queued')
  cancel(); b.onload!(new Event('load')); await Promise.resolve()
  loader.load(['bad','good'],c,vi.fn()); expect(c.src).toBe('good')
})
it('stalled visible sources advance on deadline and unmount frees the next card',()=>{
  vi.useFakeTimers(); const loader=createNftImageLoader(1,100),a=target(),b=target()
  const cancel=loader.load(['stalled','next'],a,vi.fn()); loader.load(['queued'],b,vi.fn())
  vi.advanceTimersByTime(101); expect(a.src).toBe('next')
  cancel(); expect(a.src).toBe(''); expect(b.src).toBe('queued')
  vi.advanceTimersByTime(101)
})
