// Read-only manual probe. Public addresses from the checked-in beneficiary table.
// No vault, seed, wallet key, execution or broadcast call is used.
import { getSwapQuote, setSwapFetch } from '../../src/main/swap-proxy'
import { setSettlementTrackingActive } from '../../src/main/swap-policy'
import { readFileSync, writeFileSync } from 'node:fs'

async function main() {
  const chain = process.argv[2] === 'ethereum' ? 'ethereum' : 'base'
  const replay = process.argv.includes('--replay-rejected')
  const nativeFetch = globalThis.fetch
  let initial = true
  const calls: { host: string; denied: string[] }[] = []
  setSwapFetch(async (input, init) => {
    const url = new URL(input)
    calls.push({ host: url.host, denied: url.searchParams.getAll('denyBridges') })
    if (url.hostname === 'li.quest' && replay && initial) {
      initial = false
      // A real unsigned payload observed failing FastMCTP 6001, not a mocked RPC.
      return new Response(readFileSync('.local-artifacts/sol-crosschain/lifi-base-alternative.json', 'utf8'))
    }
    const response = await nativeFetch(input, init)
    if (url.hostname === 'li.quest') {
      writeFileSync(`.local-artifacts/sol-crosschain/live-${chain}-${calls.length}.json`, await response.clone().text())
    }
    return response
  })
  setSettlementTrackingActive(true)
  const result = await getSwapQuote({
    fromChain: 'solana', toChain: chain, fromToken: 'So11111111111111111111111111111111111111112',
    toToken: '0x0000000000000000000000000000000000000000', fromSymbol: 'SOL', toSymbol: 'ETH',
    sellAmountRaw: '1000000000', slippageBps: 50,
    taker: '3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d',
    toAddress: '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13',
  }, { swapProxyUrl: 'https://api.magicmoney.dev', clientToken: 'magicmoney-wallet-v1' } as never)
  const summary = {
    chain, replay, calls, error: result.error, tool: result.quote?.bridgeTool,
    simulation: (result.quote?.solanaCost as { simulationStatus?: string })?.simulationStatus,
    cost: result.quote?.solanaCost, routing: result.routing,
    sellAmountRaw: result.quote?.sellAmountRaw, recipient: result.quote?.toAddress,
    minBuyAmountRaw: result.quote?.minBuyAmountRaw, fee: result.quote?.appFee,
  }
  writeFileSync(`.local-artifacts/sol-crosschain/app-path-${chain}${replay ? '-replay' : ''}.json`, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  if (!result.quote) process.exitCode = 1
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
