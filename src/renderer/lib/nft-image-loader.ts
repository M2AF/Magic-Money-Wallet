type Result = { status: 'loading' | 'loaded' | 'failed'; url: string }
// The displayed element owns the request: no throwaway Image preloader/download.
export function createNftImageLoader(limit = 6, timeoutMs = 12_000) {
  const queue: Array<() => void> = [], successful = new Map<string,string>()
  let active = 0
  const drain = () => { while (active < limit && queue.length) queue.shift()!() }
  return {
    load(candidates: string[], image: HTMLImageElement, listener: (result: Result) => void) {
      const signature=JSON.stringify(candidates), previous=successful.get(signature)
      const urls=previous ? [previous,...candidates.filter(url=>url!==previous)] : candidates
      let cancelled=false, finished=false, started=false, index=0, timer: ReturnType<typeof setTimeout>
      const finish=(url: string) => {
        if (finished) return
        finished=true; clearTimeout(timer); image.onload=image.onerror=null
        if (url) { successful.set(signature,url); if (successful.size>3000) successful.delete(successful.keys().next().value!) }
        else image.removeAttribute('src')
        if (started) active--
        if (!cancelled) listener({status:url ? 'loaded' : 'failed',url})
        drain()
      }
      const next=() => {
        clearTimeout(timer); image.onload=image.onerror=null; image.removeAttribute('src')
        if (cancelled || index>=Math.min(urls.length,9)) return finish('')
        const attempt=++index, url=urls[attempt-1]
        image.onload=() => {
          const done=() => { if (!finished && index===attempt) finish(url) }
          const fail=() => { if (!finished && index===attempt) next() }
          if (image.decode) image.decode().then(done,fail); else done()
        }
        image.onerror=next; timer=setTimeout(next,timeoutMs); image.src=url
      }
      const start=() => { if (cancelled) return; started=true; active++; next() }
      listener({status:'loading',url:''}); queue.push(start); drain()
      return () => { cancelled=true; if (started && !finished) finish('') }
    },
  }
}
export const nftImageLoader = createNftImageLoader()
