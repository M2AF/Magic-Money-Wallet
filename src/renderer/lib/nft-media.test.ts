import { expect, it } from 'vitest'
import { nftImageCandidates } from './nft-media'

it('tries the preview first and full artwork next without duplicate requests', () => {
  expect(nftImageCandidates('https://cdn.example/small.webp', 'https://cdn.example/full.png')).toEqual(['https://cdn.example/small.webp', 'https://cdn.example/full.png'])
  expect(nftImageCandidates('https://cdn.example/full.png', 'https://cdn.example/full.png')).toHaveLength(1)
})
it('preserves a supplied IPFS gateway and normalizes ipfs://ipfs/ paths', () => {
  expect(nftImageCandidates('https://dweb.link/ipfs/Qm123/image.png')[0]).toBe('https://dweb.link/ipfs/Qm123/image.png')
  expect(nftImageCandidates('ipfs://ipfs/Qm123/image.png')[0]).toBe('https://ipfs.io/ipfs/Qm123/image.png')
})
it('supports embedded image artwork and rejects executable URLs', () => {
  expect(nftImageCandidates('data:image/svg+xml;base64,abc')).toHaveLength(1)
  expect(nftImageCandidates('javascript:alert(1)')).toEqual([])
  expect(nftImageCandidates(null)).toEqual([])
})
