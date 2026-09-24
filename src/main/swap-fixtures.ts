/**
 * swap-fixtures.ts — TEST SUPPORT ONLY. Nothing in the app imports this, so it
 * is never bundled; it lives under src/main so it typechecks against the real
 * types rather than a copy that can drift from them.
 *
 * Every swap test needs a quote that carries a VALID app fee, because the
 * execution gate now refuses anything else. Building that record by hand in each
 * test would mean each test quietly encoding its own idea of what a correct fee
 * looks like — and a fixture that drifts from the policy makes the tests agree
 * with themselves instead of with the code.
 *
 * So the fee here is derived from the policy the app actually ships: the rate
 * comes from APP_FEE_BPS, the recipient from the beneficiary table, and the
 * amount from the same integer arithmetic the checker uses. Change the policy
 * and these fixtures follow it.
 */

import {
  APP_FEE_BPS, SWAP_FEE_POLICY_VERSION, SWAP_FEE_BENEFICIARIES, SWAP_FEE_PROVIDERS,
  feeAmountForBps, type AppFeeRecord,
} from '../shared/swap-fee-policy'

/**
 * A fee record that passes the policy, for a given provider and sell amount.
 *
 * `base: 'input'` is used throughout: it makes the expected amount a plain
 * percentage of `sellAmountRaw`, with no gross/net reconstruction, so a fixture
 * cannot accidentally test the arithmetic it is supposed to be a backdrop for.
 * The output-base path is exercised directly in swap-fee.test.ts.
 */
export function validAppFee(
  provider: string,
  chain: string,
  sellAmountRaw: string,
  over: Partial<AppFeeRecord> = {},
): AppFeeRecord {
  const cap = SWAP_FEE_PROVIDERS[provider]
  const recipientKind = cap?.recipientKind ?? 'onchain-address'
  const recipient = recipientKind === 'registered-integrator'
    ? SWAP_FEE_BENEFICIARIES.lifiIntegrator
    : recipientKind === 'referral-token-account'
      ? 'DN8Mb7gyodGADTFQDDqrLLueeJs5tFPchkSALMETrea2'   // real USDC referral ATA
      : SWAP_FEE_BENEFICIARIES.evm
  return {
    policyVersion: SWAP_FEE_POLICY_VERSION,
    provider,
    requestedBps: APP_FEE_BPS,
    appliedBps: APP_FEE_BPS,
    base: 'input',
    chain,
    tokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    tokenSymbol: 'ETH',
    tokenDecimals: 18,
    amountRaw: feeAmountForBps(sellAmountRaw, APP_FEE_BPS) ?? '0',
    recipient,
    recipientKind,
    collection: cap?.collection ?? 'in-swap',
    providerSharePct: cap?.providerSharePct ?? null,
    verification: 'applied-verified',
    evidence: ['fixture: policy-derived'],
    ...over,
  }
}

/**
 * EVM calldata with the fee recipient's bytes embedded.
 *
 * An address-recipient provider only passes `checkFeeBoundInPayload` when the
 * beneficiary is present in the payload that would execute, so a fixture whose
 * calldata omitted it would fail for the right reason at the wrong time.
 */
export function calldataWithFeeRecipient(prefix = '0x1234'): string {
  return `${prefix}${SWAP_FEE_BENEFICIARIES.evm.slice(2).toLowerCase()}0000`
}
