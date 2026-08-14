import { describe, it, expect } from 'vitest'
import type { SendAsset as MainSendAsset, NftStandard as MainNftStandard } from '../main/tx-sender'
import type { SendAsset as RendererSendAsset, NftStandard as RendererNftStandard, WalletToken } from '../renderer/types/wallet'
import { EVM_CHAINS as CONFIG_CHAINS, NON_EVM_CHAINS } from '../main/chain-config'
import { canSendToken } from '../renderer/lib/asset-send'

/**
 * SendAsset is declared twice on purpose: the renderer can't import from
 * src/main (tsconfig.web.json scopes it to src/renderer), so it mirrors the
 * definition the way it already mirrors WalletToken and WalletCollectible.
 *
 * The renderer BUILDS these objects and the main-process router consumes them
 * with a bare `as SendAsset` cast — an unchecked boundary. If the two
 * definitions drift, that cast silently lies and the mismatch surfaces as a
 * malformed transaction, not a compile error.
 *
 * This file lives under src/extension because tsconfig.extension.json is the
 * only project that typechecks BOTH sides (it pulls in src/main through
 * wallet-handlers and src/renderer through ExtApp). The assertions below are
 * type-level: they fail `npm run typecheck`, not at runtime.
 */

// Assignability asserted in BOTH directions, so neither side can gain, lose or
// change a member unnoticed. These are never called — the return statements are
// the assertions, and they are checked by `npm run typecheck`.
function _mainToRenderer(x: MainSendAsset): RendererSendAsset { return x }
function _rendererToMain(x: RendererSendAsset): MainSendAsset { return x }
function _standardMainToRenderer(x: MainNftStandard): RendererNftStandard { return x }
function _standardRendererToMain(x: RendererNftStandard): MainNftStandard { return x }

void _mainToRenderer; void _rendererToMain
void _standardMainToRenderer; void _standardRendererToMain

describe('SendAsset renderer/main contract', () => {
  it('accepts every variant the UI can build on both sides', () => {
    // Each literal is typed as the RENDERER's shape and read back as MAIN's —
    // the exact direction the bridge cast performs at runtime.
    const cases: RendererSendAsset[] = [
      { kind: 'token', contractAddress: '0xabc', decimals: 6 },
      { kind: 'token', contractAddress: '0xabc', decimals: 18, symbol: 'USDC' },
      { kind: 'nft', contractAddress: '0xabc', tokenId: '1', standard: 'erc721' },
      { kind: 'nft', contractAddress: '0xabc', tokenId: '1', standard: 'erc1155', quantity: '3' },
      { kind: 'nft', contractAddress: 'Mint', tokenId: 'Mint', standard: 'spl' },
      { kind: 'nft', contractAddress: 'policy', tokenId: 'name', standard: 'cardano' },
    ]
    const asMain: MainSendAsset[] = cases
    expect(asMain).toHaveLength(6)
  })

  it('covers every NftStandard the renderer can produce', () => {
    const all: RendererNftStandard[] = ['erc721', 'erc1155', 'spl', 'cardano']
    const asMain: MainNftStandard[] = all
    expect(new Set(asMain).size).toBe(4)
  })
})

/**
 * Token-send capability parity — the same "anything advertised must be sendable"
 * invariant chain-parity.test.ts pins for native sends, one level up.
 *
 * The Tokens tab shows a Send button purely on canSendToken()'s say-so, so that
 * predicate must agree with what tx-sender can actually encode. The dangerous
 * direction is a chain silently falling through getChainType's EVM default:
 * that is exactly how Polkadot — which has no send path whatsoever — first
 * acquired a Send button.
 *
 * Lives here rather than beside chain-parity.test.ts because tsconfig.node.json
 * is a composite project scoped to src/main, and src/extension is the only
 * project that legitimately spans both main and renderer.
 */
describe('token-send capability parity', () => {
  const asToken = (chain: string): WalletToken => ({
    contractAddress: '0xaaaa', name: 'T', symbol: 'T', decimals: 6,
    balance: '1', rawBalance: '1000000', usdValue: null, nativeEquivalent: null,
    nativeSymbol: 'ETH', logoUri: null, chain, chainLabel: chain, chainColor: '#fff',
  })

  it('every EVM chain that can send natively can also send tokens', () => {
    for (const def of CONFIG_CHAINS) {
      expect(canSendToken(asToken(def.id)), `Tokens tab refuses '${def.id}'`).toBe(true)
    }
  })

  it('user-added custom chains are token-sendable (they are EVM)', () => {
    expect(canSendToken(asToken('custom-9999'))).toBe(true)
  })

  it('offers token send on exactly the non-EVM chains that implement it', () => {
    // Cardano native assets, Solana SPL and Tron TRC-20 have transfer paths.
    // The rest deliberately do not — see the gating rationale in asset-send.ts.
    const IMPLEMENTED = new Set(['solana', 'cardano', 'tron'])
    for (const def of NON_EVM_CHAINS) {
      expect(
        canSendToken(asToken(def.id)),
        `token-send capability for '${def.id}' disagrees with what tx-sender implements`
      ).toBe(IMPLEMENTED.has(def.id))
    }
  })
})
