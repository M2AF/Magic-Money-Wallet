import { useEffect, useRef, useState } from 'react'
import { nftImageCandidates } from '../lib/nft-media'
import './NftImage.css'

export function NftImage({ src, fallbackSrc, alt, eager = false }: {
  src: string | null | undefined
  fallbackSrc?: string | null
  alt: string
  eager?: boolean
}) {
  // A metadata reveal/source change gets fresh retry and decode state immediately.
  return <Media key={JSON.stringify([src, fallbackSrc])} urls={nftImageCandidates(src, fallbackSrc)} alt={alt} eager={eager} />
}

function Media({ urls, alt, eager }: { urls: string[]; alt: string; eager: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(eager)
  const [index, setIndex] = useState(0)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const loaded = loadedUrl === urls[index]
  const failed = index >= urls.length

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
    if (!active || loaded || failed) return
    // A gateway that never answers must not leave a visible card spinning forever.
    const timeout = setTimeout(() => setIndex(i => i === index ? i + 1 : i), 12_000)
    return () => clearTimeout(timeout)
  }, [active, index, loaded, failed])

  return (
    <div ref={container} className="nft-media" data-state={failed ? 'failed' : loaded ? 'loaded' : active ? 'loading' : 'pending'}>
      {!loaded && <div className={failed ? 'nft-media-fallback' : 'nft-media-placeholder'} role={failed ? 'img' : undefined} aria-label={failed ? `${alt}: image unavailable` : undefined} aria-hidden={!failed}>🖼</div>}
      {active && !failed && <img
        key={urls[index]} src={urls[index]} alt={alt} width={400} height={400}
        loading={eager ? 'eager' : 'lazy'} decoding="async"
        className="nft-media-image" style={{ opacity: loaded ? 1 : 0 }}
        onLoad={() => setLoadedUrl(urls[index])}
        onError={() => setIndex(i => i === index ? i + 1 : i)}
      />}
    </div>
  )
}
