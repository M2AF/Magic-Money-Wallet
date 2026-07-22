import { describe, expect, it } from 'vitest'
import { alchemyNftUrl, alchemyRpcUrl, proxyHeaders, proxyUrl } from './api-proxy'
import type { WalletConfig } from './secure-store'

const config: WalletConfig = {
  alchemyKey: '',
  ankrKey: '',
  heliusKey: '',
  blockfrostKey: '',
  tatumKey: '',
  moralisKey: '',
  openseaKey: '',
  ordiscanKey: '',
  anvilKey: '',
  supabaseUrl: '',
  supabaseKey: '',
  walletConnectProjectId: '',
  swapProxyUrl: 'https://proxy.example',
  clientToken: 'magicmoney-wallet-v1',
  simpleSwapApiKey: '',
  testnetMode: false,
  privacyMode: false,
  torBrowserEnabled: false,
  torBrowserPort: 9050,
  moneroRestoreHeight: 0,
  midnightNetwork: 'mainnet',
}

describe('api proxy client gate', () => {
  it('adds the public client tag to proxy URLs used as RPC endpoints', () => {
    expect(alchemyRpcUrl('eth-mainnet', config)).toBe('https://proxy.example/rpc/alchemy/eth-mainnet?mm_client=magicmoney-wallet-v1')
    expect(proxyUrl('https://proxy.example/tokens?chain=base', config)).toBe('https://proxy.example/tokens?chain=base&mm_client=magicmoney-wallet-v1')
  })

  it('keeps Alchemy NFT passthrough paths before the client query tag', () => {
    expect(alchemyNftUrl('eth-mainnet', 'getNFTsForOwner?owner=0xabc&withMetadata=true', config))
      .toBe('https://proxy.example/alchemy-nft/eth-mainnet/getNFTsForOwner?owner=0xabc&withMetadata=true&mm_client=magicmoney-wallet-v1')
  })

  it('adds the public client tag to fetch headers without dropping existing headers', () => {
    expect(proxyHeaders(config, { accept: 'application/json' })).toEqual({
      accept: 'application/json',
      'x-mm-client': 'magicmoney-wallet-v1',
    })
  })
})
