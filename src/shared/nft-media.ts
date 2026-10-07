// Content-addressed media normalization shared by provider mapping and the gallery.
const GATEWAYS = ['https://ipfs.blockfrost.dev/ipfs/', 'https://gateway.pinata.cloud/ipfs/', 'https://ipfs.filebase.io/ipfs/']
const RETIRED = ['cloudflare-ipfs.com', 'ipfs.io', 'dweb.link', 'w3s.link']

export function validNftCid(value: string): boolean {
  if (value.length > 128) return false
  const bytes: number[] = []
  if (/^(?:Qm|z)[1-9A-HJ-NP-Za-km-z]+$/.test(value)) {
    let n = 0n; const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    for (const char of value.startsWith('z') ? value.slice(1) : value) n = n * 58n + BigInt(alphabet.indexOf(char))
    while (n) { bytes.unshift(Number(n & 255n)); n >>= 8n }
    if (value.startsWith('Qm')) return bytes.length === 34 && bytes[0] === 18 && bytes[1] === 32
  } else if (/^b[a-z2-7]+$/.test(value)) {
    let bits = 0, buffer = 0; const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
    for (const char of value.slice(1)) { buffer = (buffer << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255) } }
    if (bits && (buffer & ((1 << bits)-1))) return false
  } else return false
  let index = 0
  const integer = () => { let n=0, factor=1; for (let i=0;i<7 && index<bytes.length;i++) { const byte=bytes[index++]; n+=(byte&127)*factor; if (!(byte&128)) return n; factor*=128 } return null }
  if (integer() !== 1 || !integer() || !integer()) return false
  const size = integer(); return size != null && size > 0 && size <= 64 && bytes.length-index === size
}

export function nftMetadataText(value: unknown): string {
  const text = Array.isArray(value) && value.every(v => typeof v === 'string') ? value.join('') : typeof value === 'string' ? value : ''
  // Decode only complete definite-length CBOR strings, never arbitrary asset hex.
  if (!/^(?:[0-9a-f]{2})+$/i.test(text)) return text
  const bytes = Uint8Array.from(text.match(/../g)!, b => parseInt(b,16)), major=bytes[0]>>5, extra=bytes[0]&31
  if (![2,3].includes(major)) return text
  let prefix=1, size=extra
  if (extra===24 && bytes.length>=2) { prefix=2; size=bytes[1] }
  else if (extra===25 && bytes.length>=3) { prefix=3; size=bytes[1]*256+bytes[2] }
  else if (extra>=24) return text
  if (size!==bytes.length-prefix) return text
  try { const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(prefix)); return /^[\x20-\x7e]+$/.test(decoded) ? decoded : text } catch { return text }
}

export function nftUriCandidates(value: unknown, base?: string): string[] {
  let uri = nftMetadataText(value).trim()
  if (!uri) return []
  if (base && !validNftCid(uri.split('/')[0]) && !/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
    try { uri=new URL(uri,nftUriCandidates(base)[0]).href } catch { return [] }
  }
  if (uri.startsWith('ar://')) return ['https://arweave.net/'+uri.slice(5)]
  let path: string | undefined, supplied = false
  if (uri.startsWith('ipfs://')) path=uri.slice(7).replace(/^ipfs\//,'')
  else if (validNftCid(uri.split('/')[0])) path=uri
  else {
    try {
      const parsed=new URL(uri)
      if (/^https?:$/.test(parsed.protocol)) {
        if (parsed.hostname.includes('.ipfs.')) path=parsed.hostname.split('.ipfs.')[0]+parsed.pathname+parsed.search
        else if (parsed.pathname.includes('/ipfs/')) path=parsed.pathname.split('/ipfs/')[1]+parsed.search
        supplied=!RETIRED.some(host => parsed.hostname===host || parsed.hostname.endsWith('.'+host))
      }
    } catch { /* unsupported scheme */ }
  }
  if (path) return [...new Set([...(supplied ? [uri] : []),...GATEWAYS.map(g=>g+path)])]
  return /^(https?:\/\/|data:image\/|blob:)/i.test(uri) ? [uri] : []
}

export function nftMetadataImages(meta: Record<string, unknown>, base?: string): string[] {
  const files=Array.isArray(meta.files) ? meta.files : []
  const svg=typeof meta.image_data==='string' && meta.image_data.trim().startsWith('<svg') ? 'data:image/svg+xml,'+encodeURIComponent(meta.image_data) : ''
  const values=[meta.image,meta.image_url,svg,...files.filter(f=>f && /^image\//i.test(nftMetadataText(f.mediaType || f.mimeType || f.mime))).map(f=>f.src || f.uri)]
  return [...new Set(values.flatMap(value=>nftUriCandidates(value,base)))]
}
