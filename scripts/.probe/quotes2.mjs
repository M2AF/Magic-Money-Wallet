const ADDR = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'
const CHAINS = { robinhood: 4663, arc: 5042, abstract: 2741, worldchain: 480, soneium: 1868,
  apechain: 33139, ronin: 2020, blast: 81457, gnosis: 100 }

async function tokensFor(id) {
  const r = await fetch(`https://li.quest/v1/tokens?minPriceUSD=0&chains=${id}`, { headers: { accept: 'application/json' } })
  const d = await r.json().catch(() => null)
  return (d?.tokens?.[String(id)]) || []
}
async function quote(label, fromChain, fromToken, toChain, toToken, amount) {
  const p = new URLSearchParams({ fromChain: String(fromChain), toChain: String(toChain), fromToken, toToken,
    fromAmount: amount, fromAddress: ADDR, toAddress: ADDR, slippage: '0.01', integrator: 'ChainLens', fee: '0.01' })
  const r = await fetch(`https://li.quest/v1/quote?${p}`, { headers: { accept: 'application/json' } })
  const d = await r.json().catch(() => null)
  if (!r.ok) { console.log(`  ${label}: HTTP ${r.status} ${(d?.message || '').slice(0, 95)}`); return }
  const e = d.estimate || {}
  const split = (e.feeCosts || [])[0]?.feeSplit
  const steps = (d.includedSteps || []).map(s => `${s.type}:${s.tool}`).join('>')
  console.log(`  ${label}: OK tool=${d.tool} out=${e.toAmount} min=${e.toAmountMin} fee=${split?.integratorFee ?? 'none'} [${steps}]`)
}

for (const [name, id] of Object.entries(CHAINS)) {
  const list = await tokensFor(id)
  const native = list.find(t => t.address === '0x0000000000000000000000000000000000000000')
  const usdc = list.find(t => (t.symbol || '').toUpperCase() === 'USDC' && t.address !== '0x0000000000000000000000000000000000000000')
  console.log(`\n### ${name} (${id})  tokens=${list.length} native=${native?.symbol}/${native?.decimals}d usdc=${usdc?.address ?? 'none'}`)
  if (!native) continue
  const unit = 10n ** BigInt(native.decimals || 18)
  const amt = String(unit / 100n)
  if (usdc) await quote('same-chain native->USDC', id, native.address, id, usdc.address, amt)
  await quote('x-chain OUT -> Base USDC', id, native.address, 8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amt)
  await quote('x-chain IN  <- Base ETH ', 8453, '0x0000000000000000000000000000000000000000', id, native.address, '10000000000000000')
}
