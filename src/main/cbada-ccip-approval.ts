/**
 * cbada-ccip-approval.ts — the user's approval of a Base -> Solana cbADA
 * transfer's exact terms (privileged layer). Nothing here signs or sends, and
 * nothing here reads a key: it reads live Base state, proposes ceilings, and —
 * only on the user's explicit approval of that proposal — stores the terms as
 * the journey's immutable authorization (authorizeCcipBridge).
 *
 *   reviewCbAdaTransfer     live fee, allowance, gas, balances, lane and rate
 *                           limit for THIS wallet's Base sender and Solana
 *                           address; returns the terms and a single-use
 *                           proposal id valid for PROPOSAL_TTL_MS
 *   authorizeCbAdaTransfer  given only that proposal id: creates the journey,
 *                           approves the bridge step for the amount, and stores
 *                           the authorization. The renderer cannot supply or
 *                           change any term — sender, recipient, amount and
 *                           ceilings all come from the proposal held here.
 *   cancelUnsentStoredJourney  stops this wallet's journey if it sent nothing
 *
 * CEILINGS are maxima the user approves, never expected costs:
 *   - CCIP fee: the live router quote plus FEE_HEADROOM_PCT;
 *   - network gas per transaction: gas units x (2 x the current max fee per gas).
 *     Units are the node's estimate x GAS_UNITS_HEADROOM_PCT. A send that needs
 *     an approval first cannot be estimated yet (the router's transferFrom
 *     would revert), so its units are SEND_GAS_UNITS_CAP.
 * The executor re-reads everything before each transaction and refuses
 * anything above these ceilings (cbada-ccip-execute.ts).
 *
 * Base also charges an L1 data fee per transaction. It is shown as an
 * estimate; it is NOT inside these gas ceilings.
 */

import { getAddress, parseAbi, type Hex, type PublicClient } from 'viem'
import { estimateL1Fee } from 'viem/op-stack'
import { CBADA, svmTokenTransferExtraArgs } from './cbada-ccip'
import { buildCbAdaBaseToSolana, validateCbAdaSendTxs, simulateCbAdaSend, type CbAdaSendTerms, type EvmTx } from './cbada-ccip-send'
import {
  createJourney, approveLeg, authorizeCcipBridge, cancelUnsentJourney, type StablecoinJourney,
} from '../shared/stablecoin-journey'
import type { ExactAsset } from '../shared/stablecoin-route'
import type { CbAdaTermsReview } from '../shared/journey-candidate'
import type { JourneyStore } from './journey-store'

export const PROPOSAL_TTL_MS = 120_000
export const FEE_HEADROOM_PCT = 110n
export const GAS_UNITS_HEADROOM_PCT = 150n
export const GAS_PRICE_HEADROOM_X = 2n
/** About twice the 222,219 gas a live Base -> Solana ccipSend used (__fixtures__/ccip/base-ccip-send-receipt.json). */
export const SEND_GAS_UNITS_CAP = 450_000n

export class CbAdaApprovalError extends Error {}
const fail = (why: string): never => { throw new CbAdaApprovalError(why) }

const ROUTER = parseAbi([
  'function getFee(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) view returns (uint256)',
])
const ERC20 = parseAbi(['function allowance(address owner, address spender) view returns (uint256)'])

/** This wallet, as the privileged layer derived it. Never from the renderer. */
export interface ApprovalWallet { walletId: string; evm: string; solana: string; accountIndex: number }

interface Proposal {
  review: CbAdaTermsReview
  wallet: ApprovalWallet
  cbAdaBalanceRaw: string
}

/** Proposals live only in this process, briefly, and are used at most once. */
const PROPOSALS = new Map<string, Proposal>()
const prune = (now: number) => { for (const [k, p] of PROPOSALS) if (p.review.expiresAt <= now) PROPOSALS.delete(k) }
// The one-active-journey check and save are one logical operation. Two windows
// can approve different proposals concurrently, so serialize that pair here.
let authorizationTail: Promise<unknown> = Promise.resolve()
const serializeAuthorization = <T>(work: () => Promise<T>): Promise<T> => {
  const run = authorizationTail.then(work)
  authorizationTail = run.catch(() => { /* a refusal must not block later approvals */ })
  return run
}

const randomId = (bytes: number) => {
  const b = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(b)
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

const cbBase: ExactAsset = { chain: 'base', address: CBADA.base.token, symbol: 'cbADA', decimals: CBADA.base.decimals }
const cbSol: ExactAsset = { chain: 'solana', address: CBADA.solana.token, symbol: 'cbADA', decimals: CBADA.solana.decimals }

async function l1Fee(client: PublicClient, sender: Hex, tx: EvmTx): Promise<bigint | null> {
  try {
    return await estimateL1Fee(client as never, { account: sender, to: tx.to as Hex, data: tx.data as Hex, value: BigInt(tx.value), chain: client.chain } as never)
  } catch { return null }
}

/** Read live Base state for this wallet and propose the exact terms. Read-only. */
export async function reviewCbAdaTransfer(amountRaw: unknown, wallet: ApprovalWallet, client: PublicClient, now: number): Promise<CbAdaTermsReview> {
  if (typeof amountRaw !== 'string' || !/^[1-9][0-9]{0,77}$/.test(amountRaw)) return fail('Invalid amount.')
  if (BigInt(amountRaw) > CBADA.laneCapacityRaw) fail('The amount exceeds the CCIP lane\'s transfer capacity.')
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet.evm) || !wallet.solana) fail('This account has no Base or Solana address.')
  const sender = getAddress(wallet.evm)
  const read = <T>(p: Promise<T>) => p.catch(() => null)

  const [fee, allowance, fees] = await Promise.all([
    read(client.readContract({
      address: getAddress(CBADA.base.router), abi: ROUTER, functionName: 'getFee',
      args: [CBADA.solana.selector, {
        receiver: ('0x' + '00'.repeat(32)) as Hex, data: '0x',
        tokenAmounts: [{ token: getAddress(CBADA.base.token), amount: BigInt(amountRaw) }],
        feeToken: '0x0000000000000000000000000000000000000000', extraArgs: svmTokenTransferExtraArgs(wallet.solana),
      }],
    })),
    read(client.readContract({ address: getAddress(CBADA.base.token), abi: ERC20, functionName: 'allowance', args: [sender, getAddress(CBADA.base.router)] })),
    read(client.estimateFeesPerGas()),
  ])
  if (fee === null || fee <= 0n) return fail('The live CCIP fee could not be read.')
  if (allowance === null) return fail('The current allowance could not be read.')
  if (!fees || fees.maxFeePerGas === undefined || fees.maxFeePerGas <= 0n) return fail('Base gas prices could not be read.')

  const terms: CbAdaSendTerms = { sender, solanaRecipient: wallet.solana, amountRaw, feeWei: fee.toString() }
  const maxCcipFeeWei = (fee * FEE_HEADROOM_PCT) / 100n
  const txs = buildCbAdaBaseToSolana(terms, allowance)
  validateCbAdaSendTxs(txs, terms, maxCcipFeeWei)
  // Always price an approval: if the allowance later falls short, the executor
  // may need one, and it may only spend within an approved ceiling.
  const approveTx = txs.approve ?? (buildCbAdaBaseToSolana(terms, 0n).approve as EvmTx)
  const needsApproval = txs.approve !== null

  const [approveUnits, sendUnits, approveL1, sendL1] = await Promise.all([
    read(client.estimateGas({ account: sender, to: approveTx.to as Hex, data: approveTx.data as Hex })),
    needsApproval ? Promise.resolve(null) : read(client.estimateGas({ account: sender, to: txs.send.to as Hex, data: txs.send.data as Hex, value: BigInt(txs.send.value) })),
    l1Fee(client, sender, approveTx),
    l1Fee(client, sender, txs.send),
  ])
  if (approveUnits === null) return fail('Gas for the approval could not be estimated.')
  if (!needsApproval && sendUnits === null) return fail('Gas for the transfer could not be estimated.')
  const perGasCeiling = fees.maxFeePerGas * GAS_PRICE_HEADROOM_X
  const approveCeilingUnits = (approveUnits * GAS_UNITS_HEADROOM_PCT) / 100n
  const sendCeilingUnits = sendUnits === null ? SEND_GAS_UNITS_CAP : (sendUnits * GAS_UNITS_HEADROOM_PCT) / 100n
  const maxApprovalGasWei = approveCeilingUnits * perGasCeiling
  const maxSendGasWei = sendCeilingUnits * perGasCeiling

  // Fail closed on lane, pool identity, rate limit, cbADA and ETH (fee ceiling
  // plus every gas ceiling still to be spent).
  const sim = await simulateCbAdaSend(client, txs, { ...terms, feeWei: maxCcipFeeWei.toString() },
    needsApproval ? maxApprovalGasWei + maxSendGasWei : maxSendGasWei)

  prune(now)
  const review: CbAdaTermsReview = {
    proposalId: randomId(16),
    quotedAt: now,
    expiresAt: now + PROPOSAL_TTL_MS,
    sender: sender.toLowerCase(),
    accountIndex: wallet.accountIndex,
    recipient: wallet.solana,
    amountRaw,
    baseToken: CBADA.base.token,
    solanaMint: CBADA.solana.token,
    router: CBADA.base.router,
    ccipFeeWei: fee.toString(),
    maxCcipFeeWei: maxCcipFeeWei.toString(),
    needsApproval,
    allowanceRaw: allowance.toString(),
    maxFeePerGasWei: fees.maxFeePerGas.toString(),
    approvalGas: { estimateUnits: approveUnits.toString(), ceilingUnits: approveCeilingUnits.toString(), maxWei: maxApprovalGasWei.toString(), l1FeeWei: approveL1?.toString() ?? null },
    sendGas: { estimateUnits: sendUnits?.toString() ?? null, ceilingUnits: sendCeilingUnits.toString(), maxWei: maxSendGasWei.toString(), l1FeeWei: sendL1?.toString() ?? null },
    totalMaxEthWei: (maxCcipFeeWei + (needsApproval ? maxApprovalGasWei : 0n) + maxSendGasWei).toString(),
    cbAdaBalanceRaw: sim.cbAdaBalance,
    ethBalanceWei: sim.ethBalance,
    outboundRateLimit: sim.outboundRateLimit,
    problems: sim.problems,
  }
  PROPOSALS.set(review.proposalId, { review, wallet, cbAdaBalanceRaw: sim.cbAdaBalance })
  return review
}

/**
 * Store the reviewed terms as a new journey's immutable authorization. Takes
 * only a proposal id from the caller; the proposal is consumed whether or not
 * this succeeds, so a changed situation always means a fresh review.
 */
export async function authorizeCbAdaTransfer(
  proposalId: unknown, wallet: ApprovalWallet, store: JourneyStore, now: number,
): Promise<StablecoinJourney> {
  prune(now)
  const p = typeof proposalId === 'string' ? PROPOSALS.get(proposalId) : undefined
  if (typeof proposalId === 'string') PROPOSALS.delete(proposalId)
  if (!p) return fail('These terms expired or were already used. Review the transfer again.')
  if (p.wallet.walletId !== wallet.walletId || p.wallet.evm.toLowerCase() !== wallet.evm.toLowerCase()
      || p.wallet.solana !== wallet.solana || p.wallet.accountIndex !== wallet.accountIndex) {
    fail('The active account changed since these terms were reviewed.')
  }
  const r = p.review
  if (r.problems.length) fail('These terms did not pass the live checks, so they cannot be approved.')
  return serializeAuthorization(async () => {
    const { journeys } = await store.list()
    if (journeys.some(j => j.walletId === wallet.walletId && j.bridge === 'ccip-cbada' && j.status === 'active')) {
      fail('This wallet already has a cbADA transfer in progress. Finish or cancel it first.')
    }
    let j = createJourney({
      id: `cbada-${randomId(12)}`, walletId: wallet.walletId, now, bridge: 'ccip-cbada', recipient: r.recipient,
      source: cbBase, usdcx: cbBase, usdc: cbSol, destination: cbSol,
    })
    j = approveLeg(j, 'bridge', r.amountRaw, now, p.cbAdaBalanceRaw)
    j = authorizeCcipBridge(j, {
      sender: r.sender, accountIndex: r.accountIndex,
      maxCcipFeeWei: r.maxCcipFeeWei, maxApprovalGasWei: r.approvalGas.maxWei, maxSendGasWei: r.sendGas.maxWei,
    }, now)
    await store.put(j)
    return j
  })
}

/** Stop this wallet's journey if nothing was sent for it. */
export async function cancelUnsentStoredJourney(journeyId: string, walletId: string, store: JourneyStore): Promise<StablecoinJourney> {
  const j = await store.get(journeyId)
  if (!j || j.walletId !== walletId) return fail('This journey does not belong to the current wallet.')
  const next = cancelUnsentJourney(j)
  await store.put(next)
  return next
}

/** Tests only. */
export const __clearProposals = () => PROPOSALS.clear()
