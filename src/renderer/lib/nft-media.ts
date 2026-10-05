// Keep the provider's working gateway first; alternatives are tried only on failure.
const GATEWAYS = ['https://ipfs.io/ipfs/', 'https://gateway.pinata.cloud/ipfs/', 'https://dweb.link/ipfs/']

export function nftImageCandidates(src: string | null | undefined, fallback?: string | null): string[] {
  const urls: string[] = []
  for (const input of [src, fallback]) {
    if (!input) continue
    const uri = input.trim()
    const hash = uri.startsWith('ipfs://')
      ? uri.slice(7).replace(/^ipfs\//, '')
      : uri.match(/^https?:\/\/[^/]+\/ipfs\/(.+)$/)?.[1]
    if (hash) {
      if (/^https?:\/\//.test(uri)) urls.push(uri)
      urls.push(...GATEWAYS.map(g => g + hash))
    } else if (uri.startsWith('ar://')) {
      urls.push('https://arweave.net/' + uri.slice(5))
    } else if (/^(https?:\/\/|data:image\/|blob:)/.test(uri)) {
      urls.push(uri)
    }
  }
  return [...new Set(urls)]
}
