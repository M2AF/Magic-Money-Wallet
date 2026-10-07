import { expect, it } from 'vitest'
import { nftImageCandidates } from './nft-media'
import { nftMetadataImages, nftMetadataText, nftUriCandidates } from '../../shared/nft-media'

it('tries the preview first and full artwork next without duplicate requests', () => {
  expect(nftImageCandidates('https://cdn.example/small.webp', 'https://cdn.example/full.png')).toEqual(['https://cdn.example/small.webp', 'https://cdn.example/full.png'])
  expect(nftImageCandidates('https://cdn.example/full.png', 'https://cdn.example/full.png')).toHaveLength(1)
})
it('preserves a supplied IPFS gateway and normalizes ipfs://ipfs/ paths', () => {
  expect(nftImageCandidates('https://custom.example/ipfs/Qm123/image.png')[0]).toBe('https://custom.example/ipfs/Qm123/image.png')
  expect(nftImageCandidates('ipfs://ipfs/Qm123/image.png')[0]).toBe('https://ipfs.blockfrost.dev/ipfs/Qm123/image.png')
})
it('supports embedded image artwork and rejects executable URLs', () => {
  expect(nftImageCandidates('data:image/svg+xml;base64,abc')).toHaveLength(1)
  expect(nftImageCandidates('javascript:alert(1)')).toEqual([])
  expect(nftImageCandidates(null)).toEqual([])
})
it('decodes split Cardano CBOR media, accepts real raw CIDs, and ignores website/video fields', () => {
  const uri='ipfs://QmYwAPJzv5CZsnAzt8auVZRnGiRApHjHAEg6j2zuJAY6fX/art.png'
  const cbor='78'+uri.length.toString(16).padStart(2,'0')+Array.from(uri,c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('')
  expect(nftMetadataText(cbor)).toBe(uri)
  const expected='https://ipfs.blockfrost.dev/ipfs/'+uri.slice(7)
  expect(nftMetadataImages({image:[uri.slice(0,24),uri.slice(24)]})[0]).toBe(expected)
  expect(nftMetadataImages({image:cbor})[0]).toBe(expected)
  expect(nftUriCandidates(uri.slice(7))[0]).toBe(expected)
  expect(nftUriCandidates('a'.repeat(64))).toEqual([])
  expect(nftMetadataImages({url:'https://website.example',files:[{mediaType:'video/mp4',src:'https://video.example'},{mediaType:['image/','png'],src:uri}]})).toContain(expected)
})
it('resolves metadata-relative artwork and skips retired path/subdomain gateways', () => {
  expect(nftMetadataImages({image:'../art/9.png'},'ipfs://collection/meta/9.json')[0]).toBe('https://ipfs.blockfrost.dev/ipfs/collection/art/9.png')
  expect(nftUriCandidates('https://cloudflare-ipfs.com/ipfs/hash/9.png')[0]).toBe('https://ipfs.blockfrost.dev/ipfs/hash/9.png')
  expect(nftUriCandidates('https://hash.ipfs.dweb.link/9.png')[0]).toBe('https://ipfs.blockfrost.dev/ipfs/hash/9.png')
})
