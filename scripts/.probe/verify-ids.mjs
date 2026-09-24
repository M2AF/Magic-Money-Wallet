// Verify chain IDs and native decimals against the chains themselves + LI.FI.
const RPCS = {
  robinhood: 'https://rpc.robinhood.com',
  arc: 'https://rpc.arc.network',
  abstract: 'https://api.mainnet.abs.xyz',
  hyperevm: 'https://rpc.hyperliquid.xyz/evm',
  zora: 'https://rpc.zora.energy',
  worldchain: 'https://worldchain-mainnet.g.alchemy.com/public',
  soneium: 'https://rpc.soneium.org',
  ronin: 'https://api.roninchain.com/rpc',
  apechain: 'https://rpc.apechain.com',
  blast: 'https://rpc.blast.io',
  gnosis: 'https://rpc.gnosischain.com',
}
const EXPECTED = { robinhood: 4663, arc: 5042, abstract: 2741, hyperevm: 998, zora: 7777777,
  worldchain: 480, soneium: 1868, ronin: 2020, apechain: 33139, blast: 81457, gnosis: 100 }
for (const [name, url] of Object.entries(RPCS)) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(9000) })
    const d = await r.json().catch(() => null)
    const got = d?.result ? parseInt(d.result, 16) : null
    const exp = EXPECTED[name]
    console.log(`${name.padEnd(12)} configured=${String(exp).padEnd(9)} rpc=${String(got).padEnd(9)} ${got === exp ? 'MATCH' : got == null ? '(unreachable)' : '*** MISMATCH ***'}`)
  } catch (e) {
    console.log(`${name.padEnd(12)} configured=${String(EXPECTED[name]).padEnd(9)} rpc=(error: ${String(e.message).slice(0, 40)})`)
  }
}
// Native token metadata straight from LI.FI's chain list.
const lifi = await (await fetch('https://li.quest/v1/chains')).json()
console.log('\nLI.FI native token metadata:')
for (const id of [4663, 5042, 2741, 480, 999, 33139, 2020, 1868, 143]) {
  const c = (lifi.chains || []).find(x => x.id === id)
  if (c) console.log(`  ${String(id).padEnd(8)} ${c.name.padEnd(18)} native=${c.nativeToken?.symbol} decimals=${c.nativeToken?.decimals} addr=${c.nativeToken?.address}`)
}
