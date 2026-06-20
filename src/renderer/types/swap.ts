/**
 * swap.ts — shared swap-mode types.
 *
 * The Swap page has two modes: an on-chain DEX aggregator ('dex') and the
 * off-chain SimpleSwap cross-chain exchange ('crosschain'). They are distinct
 * flows with separate types — this file only holds the shared mode discriminator.
 */

export type SwapMode = 'dex' | 'crosschain'
