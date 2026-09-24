const ADDR = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'
const EMO = '0x81a224f8a62f52bde942dbf23a56df77a10b7777'   // Monad 143, exact address
const PIXL = '0x427A03Fb96D9A94A6727fbcfbBA143444090dd64'  // Ethereum 1
const body = {
  user: ADDR, recipient: ADDR,
  originChainId: 143, originCurrency: EMO,
  destinationChainId: 1, destinationCurrency: PIXL,
  amount: (10n ** 18n * 100n).toString(),
  tradeType: 'EXACT_INPUT',
}
const r = await fetch('https://api.relay.link/quote', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const d = await r.json().catch(() => null)
console.log('Relay /quote HTTP', r.status)
if (!r.ok) { console.log(JSON.stringify(d).slice(0, 700)); }
else {
  console.log('  steps:', (d.steps || []).map(s => `${s.id}(${s.kind}) items=${(s.items||[]).length}`).join(' | '))
  for (const s of (d.steps || [])) {
    for (const it of (s.items || [])) {
      console.log(`    ${s.id}: chainId=${it.data?.chainId} to=${String(it.data?.to).slice(0,12)} hasData=${!!it.data?.data}`)
    }
  }
  const det = d.details || {}
  console.log('  currencyIn:', det.currencyIn?.currency?.symbol, det.currencyIn?.amount)
  console.log('  currencyOut:', det.currencyOut?.currency?.symbol, det.currencyOut?.amount, 'minOut:', det.currencyOut?.minimumAmount)
  console.log('  slippageTolerance dest:', JSON.stringify(det.slippageTolerance?.destination))
  console.log('  fees:', JSON.stringify(d.fees ?? {}).slice(0, 300))
}
