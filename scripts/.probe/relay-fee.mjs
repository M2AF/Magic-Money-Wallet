const ADDR = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'
const EMO = '0x81a224f8a62f52bde942dbf23a56df77a10b7777'
const PIXL = '0x427A03Fb96D9A94A6727fbcfbBA143444090dd64'
async function q(label, extra) {
  const body = { user: ADDR, recipient: ADDR, originChainId: 143, originCurrency: EMO,
    destinationChainId: 1, destinationCurrency: PIXL,
    amount: (10n ** 18n * 1000000n).toString(), tradeType: 'EXACT_INPUT', ...extra }
  const r = await fetch('https://api.relay.link/quote', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => null)
  console.log(`\n### ${label} -> HTTP ${r.status}`)
  if (!r.ok) { console.log('   ', JSON.stringify(d).slice(0, 250)); return }
  console.log('   app fee:', JSON.stringify(d.fees?.app))
  const st = (d.steps || [])[0]
  const item = st?.items?.[0]
  console.log('   step:', st?.id, st?.kind, '| chainId:', item?.data?.chainId)
  console.log('   tx.to:', item?.data?.to, '| value:', item?.data?.value, '| dataLen:', (item?.data?.data || '').length)
  console.log('   check endpoint:', JSON.stringify(item?.check ?? null).slice(0, 160))
  console.log('   requestId:', d.steps?.[0]?.requestId ?? d.requestId ?? 'n/a')
}
await q('no appFees')
// Relay app fees: array of { recipient, fee } where fee is BPS as a string.
await q('appFees 100 bps to our EVM treasury', {
  appFees: [{ recipient: ADDR, fee: '100' }],
})
