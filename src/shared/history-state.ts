/**
 * The three outcomes a portfolio card's history must keep apart: the provider
 * answered with no activity, the provider is unavailable right now, or no
 * provider can index the network at all (tx-history.ts ChainHistory).
 */
export interface HistoryStateInput {
  records: readonly unknown[]
  error: string | null
  unsupported?: boolean
}

export function historyLabel(history: HistoryStateInput): string {
  if (history.unsupported) return 'History not available for this network'
  if (history.error) return 'History provider unavailable'
  return history.records.length === 0
    ? 'No recent activity'
    : `${history.records.length} recent transfer${history.records.length !== 1 ? 's' : ''}`
}
