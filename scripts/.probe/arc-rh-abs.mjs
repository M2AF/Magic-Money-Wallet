const ADDR = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'
async function toks(id) {
  const d = await (await fetch(`https://li.quest/v1/tokens?minPriceUSD=0&chains=${id}`)).json()
  return d?.tokens?.[String(id)] || []
}
async function quote(label, fromChain, fromToken, toChain, toToken, amount) {
  const p = new URLSearchParams({ fromChain: String(fromChain), toChain: String(toChain), fromToken, toToken,
    fromAmount: amount, fromAddress: ADDR, toAddress: ADDR, slippage: '0.01', integrator: 'ChainLens', fee: '0.01' })
  const r = await fetch(`https://li.quest/v1/quote?${p}`)
  const d = await r.json().catch(() => null)
  if (!r.ok) { console.log(`  ${label}: HTTP ${r.status} ${(d?.message||'').slice(0,90)}`); return null }
  const e = d.estimate || {}
  console.log(`  ${label}: OK tool=${d.tool} out=${e.toAmount} min=${e.toAmountMin} steps=[${(d.includedSteps||[]).map(s=>s.type+':'+s.tool).join('>')}]`)
  return d
}
// --- Arc: native IS USDC at the 0x3600 mirror ---
const arc = await toks(5042)
console.log('### Arc (5042) tokens:', arc.length)
console.log('  first 6:', arc.slice(0,6).map(t=>`${t.symbol}@${t.address.slice(0,10)}/${t.decimals}d`).join(' '))
const arcUsdc = '0x3600000000000000000000000000000000000000'
const arcOther = arc.find(t => t.address.toLowerCase() !== arcUsdc.toLowerCase())
if (arcOther) await quote(`same-chain USDC->${arcOther.symbol}`, 5042, arcUsdc, 5042, arcOther.address, '1000000')
await quote('x-chain OUT Arc USDC -> Base USDC', 5042, arcUsdc, 8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '1000000')
await quote('x-chain IN  Base USDC -> Arc USDC', 8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 5042, arcUsdc, '1000000')

// --- Robinhood + Abstract same-chain against their own listed tokens ---
for (const [name, id] of [['robinhood', 4663], ['abstract', 2741]]) {
  const list = await toks(id)
  const native = list.find(t => t.address === '0x0000000000000000000000000000000000000000')
  const alt = list.filter(t => t.address !== '0x0000000000000000000000000000000000000000').slice(0, 3)
  console.log(`\n### ${name} (${id}) same-chain candidates:`, alt.map(t=>t.symbol).join(', '))
  for (const t of alt) await quote(`same-chain ${native.symbol}->${t.symbol}`, id, native.address, id, t.address, '10000000000000000')
}
