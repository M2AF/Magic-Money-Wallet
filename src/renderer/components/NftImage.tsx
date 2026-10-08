import { useEffect, useRef, useState } from 'react'
import { nftImageCandidates } from '../lib/nft-media'
import { nftImageLoader } from '../lib/nft-image-loader'
import './NftImage.css'

export function NftImage({ src, fallbackSrc, imageSources = [], artworkStatus, alt, eager = false }: {
  src: string | null | undefined
  fallbackSrc?: string | null
  imageSources?: string[]
  artworkStatus?: 'missing-metadata'
  alt: string
  eager?: boolean
}) {
  // A metadata reveal/source change gets fresh retry and decode state immediately.
  return <Media key={JSON.stringify([src, fallbackSrc,imageSources,artworkStatus])} urls={nftImageCandidates(src, fallbackSrc,imageSources)} alt={alt} eager={eager} unpublished={artworkStatus==='missing-metadata'} />
}

function Media({ urls, alt, eager, unpublished }: { urls: string[]; alt: string; eager: boolean; unpublished: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const [active, setActive] = useState(eager)
  const [status,setStatus] = useState<'loading'|'loaded'|'failed'>('loading')
  const [retry,setRetry] = useState(0)
  const loaded=status==='loaded', failed=status==='failed'
  const signature=JSON.stringify(urls)

  useEffect(() => {
    if (active) return
    if (eager || typeof IntersectionObserver === 'undefined') { setActive(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setActive(true); observer.disconnect() }
    }, { rootMargin: '200px' })
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [active, eager])

  useEffect(() => {
    if (!active || !image.current) return
    return nftImageLoader.load(JSON.parse(signature),image.current,result=>setStatus(result.status))
  }, [active, signature, retry])

  return (
    <div ref={container} className="nft-media" data-state={failed ? 'failed' : loaded ? 'loaded' : active ? 'loading' : 'pending'}>
      {!loaded && <div className={failed ? 'nft-media-fallback' : 'nft-media-placeholder'} role={failed ? 'img' : undefined} aria-label={failed ? `${alt}: ${unpublished ? 'no artwork URI published by this token' : 'image unavailable'}` : undefined} title={failed && unpublished ? 'The contract returned an empty artwork URI. A future portfolio refresh will check again.' : undefined} aria-hidden={!failed}>🖼{failed && unpublished && <span className="nft-media-unpublished">No artwork published</span>}</div>}
      {active && <img
        ref={image} alt={alt} width={400} height={400}
        decoding="async"
        className="nft-media-image" style={{ opacity: loaded ? 1 : 0 }}
      />}
      {failed && urls.length>0 && <button type="button" className="nft-media-retry" aria-label={`Retry artwork for ${alt}`} onClick={e=>{e.stopPropagation(); setRetry(n=>n+1)}}>Retry artwork</button>}
    </div>
  )
}
