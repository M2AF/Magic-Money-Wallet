import { describe, it, expect, vi } from 'vitest'
import { decodeFunctionData } from 'viem'
import {
  encodeErc20Transfer, encodeNftTransfer,
  resolveEvmNftStandard, assertEvmNftOwnership,
  ERC20_TRANSFER_ABI, ERC721_TRANSFER_ABI, ERC1155_TRANSFER_ABI,
} from './asset-transfer'

const HOLDER = '0x1111111111111111111111111111111111111111'
const DEST   = '0x2222222222222222222222222222222222222222'

/**
 * Minimal PublicClient stand-in. `readContract` is the only method the module
 * uses, so the fake answers by function name.
 */
function fakeClient(answers: Record<string, unknown | (() => unknown)>) {
  return {
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      const key = functionName === 'supportsInterface' ? `supportsInterface:${String(args[0])}` : functionName
      const a = answers[key]
      if (a === undefined) throw new Error(`unmocked call: ${key}`)
      return typeof a === 'function' ? (a as () => unknown)() : a
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const IFACE_721  = '0x80ac58cd'
const IFACE_1155 = '0xd9b67a26'

describe('ERC-20 transfer encoding', () => {
  it('encodes transfer(address,uint256) with the correct selector', () => {
    const data = encodeErc20Transfer(DEST, '1.5', 6)
    // transfer(address,uint256)
    expect(data.slice(0, 10)).toBe('0xa9059cbb')
    const decoded = decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data })
    expect(decoded.functionName).toBe('transfer')
    expect(decoded.args?.[0]).toBe(DEST)
    expect(decoded.args?.[1]).toBe(1_500_000n)
  })

  it('scales by the token’s own decimals, not by 18', () => {
    // The bug this pins: treating every token as 18-decimal would send
    // 1e18 base units of a 6-decimal token — a trillion times too much.
    expect(decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data: encodeErc20Transfer(DEST, '1', 6) }).args?.[1]).toBe(1_000_000n)
    expect(decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data: encodeErc20Transfer(DEST, '1', 18) }).args?.[1]).toBe(10n ** 18n)
    expect(decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data: encodeErc20Transfer(DEST, '7', 0) }).args?.[1]).toBe(7n)
  })

  it('keeps full precision on an 18-decimal amount', () => {
    const data = encodeErc20Transfer(DEST, '1.234567890123456789', 18)
    expect(decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data }).args?.[1]).toBe(1_234_567_890_123_456_789n)
  })
})

describe('NFT transfer encoding', () => {
  it('encodes ERC-721 safeTransferFrom(from,to,tokenId)', () => {
    const data = encodeNftTransfer({ standard: 'erc721', from: HOLDER, to: DEST, tokenId: '42' })
    expect(data.slice(0, 10)).toBe('0x42842e0e')
    const decoded = decodeFunctionData({ abi: ERC721_TRANSFER_ABI, data })
    expect(decoded.functionName).toBe('safeTransferFrom')
    expect(decoded.args).toEqual([HOLDER, DEST, 42n])
  })

  it('encodes ERC-1155 safeTransferFrom(from,to,id,amount,data)', () => {
    const data = encodeNftTransfer({ standard: 'erc1155', from: HOLDER, to: DEST, tokenId: '7', quantity: '3' })
    expect(data.slice(0, 10)).toBe('0xf242432a')
    const decoded = decodeFunctionData({ abi: ERC1155_TRANSFER_ABI, data })
    expect(decoded.args).toEqual([HOLDER, DEST, 7n, 3n, '0x'])
  })

  it('defaults ERC-1155 quantity to 1', () => {
    const data = encodeNftTransfer({ standard: 'erc1155', from: HOLDER, to: DEST, tokenId: '7' })
    expect(decodeFunctionData({ abi: ERC1155_TRANSFER_ABI, data }).args?.[3]).toBe(1n)
  })

  it('handles a uint256-max token id without loss', () => {
    const big = (2n ** 256n - 1n).toString()
    const data = encodeNftTransfer({ standard: 'erc721', from: HOLDER, to: DEST, tokenId: big })
    expect(decodeFunctionData({ abi: ERC721_TRANSFER_ABI, data }).args?.[2]).toBe(2n ** 256n - 1n)
  })

  it('rejects a zero or negative ERC-1155 quantity', () => {
    expect(() => encodeNftTransfer({ standard: 'erc1155', from: HOLDER, to: DEST, tokenId: '1', quantity: '0' }))
      .toThrow(/at least 1/)
  })
})

describe('resolveEvmNftStandard', () => {
  it('trusts the chain over the renderer’s hint', async () => {
    // Hint says 721, chain says 1155 — the chain wins, because encoding a 721
    // transfer against a 1155 contract would revert (or worse, hit a fallback).
    const client = fakeClient({
      [`supportsInterface:${IFACE_721}`]: false,
      [`supportsInterface:${IFACE_1155}`]: true,
    })
    await expect(resolveEvmNftStandard(client, '0xabc', 'erc721')).resolves.toBe('erc1155')
  })

  it('detects ERC-721', async () => {
    const client = fakeClient({
      [`supportsInterface:${IFACE_721}`]: true,
      [`supportsInterface:${IFACE_1155}`]: false,
    })
    await expect(resolveEvmNftStandard(client, '0xabc')).resolves.toBe('erc721')
  })

  it('falls back to the hint for pre-ERC-165 contracts', async () => {
    const client = fakeClient({
      [`supportsInterface:${IFACE_721}`]: () => { throw new Error('execution reverted') },
      [`supportsInterface:${IFACE_1155}`]: () => { throw new Error('execution reverted') },
    })
    await expect(resolveEvmNftStandard(client, '0xabc', 'erc721')).resolves.toBe('erc721')
  })

  it('refuses when neither interface is claimed and there is no hint', async () => {
    const client = fakeClient({
      [`supportsInterface:${IFACE_721}`]: false,
      [`supportsInterface:${IFACE_1155}`]: false,
    })
    await expect(resolveEvmNftStandard(client, '0xabc')).rejects.toThrow(/doesn.t identify itself/)
  })

  it('refuses a contract claiming BOTH standards rather than guessing', async () => {
    const client = fakeClient({
      [`supportsInterface:${IFACE_721}`]: true,
      [`supportsInterface:${IFACE_1155}`]: true,
    })
    await expect(resolveEvmNftStandard(client, '0xabc', 'erc721')).rejects.toThrow(/both ERC-721 and ERC-1155/)
  })
})

describe('assertEvmNftOwnership', () => {
  it('passes when ownerOf matches, case-insensitively', async () => {
    const client = fakeClient({ ownerOf: HOLDER.toUpperCase().replace('0X', '0x') })
    await expect(assertEvmNftOwnership({
      client, standard: 'erc721', contract: '0xabc', tokenId: '1', owner: HOLDER,
    })).resolves.toBeUndefined()
  })

  it('catches a stale index — NFT already sold', async () => {
    const client = fakeClient({ ownerOf: DEST })
    await expect(assertEvmNftOwnership({
      client, standard: 'erc721', contract: '0xabc', tokenId: '1', owner: HOLDER,
    })).rejects.toThrow(/no longer owns/)
  })

  it('rejects sending more ERC-1155 editions than are held', async () => {
    const client = fakeClient({ balanceOf: 2n })
    await expect(assertEvmNftOwnership({
      client, standard: 'erc1155', contract: '0xabc', tokenId: '1', owner: HOLDER, quantity: '5',
    })).rejects.toThrow(/only hold 2/)
  })

  it('allows an ERC-1155 send within the held balance', async () => {
    const client = fakeClient({ balanceOf: 5n })
    await expect(assertEvmNftOwnership({
      client, standard: 'erc1155', contract: '0xabc', tokenId: '1', owner: HOLDER, quantity: '5',
    })).resolves.toBeUndefined()
  })

  it('reports a zero ERC-1155 balance as no longer owned', async () => {
    const client = fakeClient({ balanceOf: 0n })
    await expect(assertEvmNftOwnership({
      client, standard: 'erc1155', contract: '0xabc', tokenId: '1', owner: HOLDER,
    })).rejects.toThrow(/no longer owns/)
  })
})
