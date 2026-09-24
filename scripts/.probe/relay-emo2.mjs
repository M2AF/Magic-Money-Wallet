const ADDR = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'
const EMO = '0x81a224f8a62f52bde942dbf23a56df77a10b7777'
const PIXL = '0x427A03Fb96D9A94A6727fbcfbBA143444090dd64'
for (const units of ['100000', '1000000', '10000000']) {
  const body = { user: ADDR, recipient: ADDR, originChainId: 143, originCurrency: EMO,
    destinationChainId: 1, destinationCurrency: PIXL,
    amount: (10n ** 18n * BigInt(units)).toString(), tradeType: 'EXACT_INPUT' }
  const r = await fetch('https://api.relay.link/quote', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => null)
  console.log(`\n=== ${units} EMO -> HTTP ${r.status}`)
  if (!r.ok) { console.log('   ', JSON.stringify(d).slice(0, 200)); continue }
  const det = d.details || {}
  console.log('   steps:', (d.steps || []).map(s => `${s.id}/${s.kind}`).join(' | '))
  const chains = new Set()
  for (const s of (d.steps || [])) for (const it of (s.items || [])) chains.add(it.data?.chainId)
  console.log('   TX CHAIN IDS REQUIRED TO SIGN:', [...chains].join(', '))
  console.log('   in :', det.currencyIn?.currency?.symbol, det.currencyIn?.amount)
  console.log('   out:', det.currencyOut?.currency?.symbol, det.currencyOut?.amount, '| minimumAmount:', det.currencyOut?.minimumAmount)
  console.log('   slippage dest:', JSON.stringify(det.slippageTolerance?.destination ?? null))
  console.log('   timeEstimate:', det.timeEstimate, 's  | fees:', Object.keys(d.fees || {}).join(','))
  console.log('   appFees echo:', JSON.stringify(d.fees?.app ?? null))
}
