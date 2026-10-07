import { nftUriCandidates } from '../../shared/nft-media'

export function nftImageCandidates(src: string | null | undefined, fallback?: string | null, extras: string[] = []): string[] {
  return [...new Set([src,fallback,...extras].flatMap(value=>nftUriCandidates(value)))]
}
