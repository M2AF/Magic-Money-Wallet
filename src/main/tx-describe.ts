/**
 * tx-describe.ts — MagicMoney Wallet
 *
 * One place that turns a dApp's signing request into the human-readable text
 * shown in the approval window — used by BOTH the in-app dApp browser
 * (ipc-handlers.ts) and WalletConnect (wc-client.ts) so the disclosure can't
 * drift between the two paths.
 *
 * Fixes:
 *   H-1 — native amounts were rendered with integer division (any value < 1 ETH
 *         showed "0 ETH", always labelled "ETH"). Now uses viem formatEther and
 *         the active chain's real native symbol.
 *   H-2 — EIP-712 approvals showed only the primaryType. Now the full message is
 *         rendered, with Permit/Permit2/approve spender+amount surfaced and an
 *         explicit UNLIMITED-allowance warning.
 */

import { formatEther } from 'viem'

const MAX_UINT256 = (2n ** 256n - 1n).toString()

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** Format a wei value (hex "0x.." or decimal string) as "<amount> <symbol>". */
export function formatNativeValue(value: string | undefined, symbol: string): string {
  if (!value || value === '0x' || value === '0x0') return `0 ${symbol}`
  let wei: bigint
  try { wei = BigInt(value) } catch { return `0 ${symbol}` }
  return `${trimZeros(formatEther(wei))} ${symbol}`
}

export interface EvmTxLike {
  to?: string
  value?: string
  data?: string
  gas?: string
}

/** Summary lines for an eth_sendTransaction approval on a given EVM chain. */
export function describeEvmSend(tx: EvmTxLike, nativeSymbol: string, chainName: string): string {
  const hasData = !!tx.data && tx.data !== '0x'
  return [
    `Network: ${chainName}`,
    `To: ${tx.to ?? '(contract creation)'}`,
    `Amount: ${formatNativeValue(tx.value, nativeSymbol)}`,
    hasData ? `Data: ${tx.data!.slice(0, 200)}${tx.data!.length > 200 ? '…' : ''}` : 'Data: none',
  ].join('\n')
}

/** One-line summary (for compact lists, e.g. the WalletConnect request row). */
export function summarizeEvmSend(tx: EvmTxLike, nativeSymbol: string): string {
  const hasData = !!tx.data && tx.data !== '0x'
  const to = tx.to ? `${tx.to.slice(0, 10)}…` : 'contract creation'
  return `Send ${formatNativeValue(tx.value, nativeSymbol)} to ${to}${hasData ? ' (contract call)' : ''}`
}

export interface TypedDataLike {
  domain?: Record<string, unknown>
  types?: Record<string, unknown>
  primaryType?: string
  message?: Record<string, unknown>
}

function isUnlimited(amount: string): boolean {
  return amount === MAX_UINT256 || /^0x[fF]{64}$/.test(amount) || amount.toLowerCase() === `0x${'f'.repeat(64)}`
}

function renderTree(obj: unknown, depth: number): string {
  if (depth > 3) return '  '.repeat(depth) + '…'
  if (obj == null || typeof obj !== 'object') return String(obj)
  const pad = '  '.repeat(depth)
  return Object.entries(obj as Record<string, unknown>)
    .map(([k, v]) =>
      v != null && typeof v === 'object'
        ? `${pad}${k}:\n${renderTree(v, depth + 1)}`
        : `${pad}${k}: ${String(v)}`
    )
    .join('\n')
}

/**
 * Full, readable rendering of an EIP-712 payload for the approval window.
 * Surfaces Permit/Permit2/approve spender + amount (with an UNLIMITED warning)
 * before dumping the complete message tree.
 */
export function describeTypedData(typed: TypedDataLike): string {
  const lines: string[] = []
  const primaryType = typed.primaryType || '(unknown)'
  lines.push(`Type: ${primaryType}`)
  if (typeof typed.domain?.name === 'string') lines.push(`Domain: ${typed.domain.name}`)
  if (typed.domain?.verifyingContract) lines.push(`Contract: ${String(typed.domain.verifyingContract)}`)

  // Approval heuristic — EIP-2612 Permit (spender/value) and Permit2 (details.amount).
  const msg = typed.message ?? {}
  const details = (msg.details ?? {}) as Record<string, unknown>
  const spender = msg.spender ?? details.spender
  const amountRaw = msg.value ?? msg.amount ?? details.amount
  if (spender != null || /permit/i.test(primaryType)) {
    lines.push('', '— Token approval —')
    if (spender != null) lines.push(`Spender: ${String(spender)}`)
    if (amountRaw != null) {
      const a = String(amountRaw)
      lines.push(`Amount: ${isUnlimited(a) ? '⚠ UNLIMITED — this site could spend your entire balance' : a}`)
    }
    const deadline = msg.deadline ?? msg.sigDeadline ?? details.expiration
    if (deadline != null) lines.push(`Deadline: ${String(deadline)}`)
  }

  lines.push('', '— Full message —', renderTree(typed.message ?? {}, 0))
  return lines.join('\n')
}
