// Keyless provider coverage probe. Read-only.
const WALLET = {
  ethereum: 1, arbitrum: 42161, optimism: 10, base: 8453, polygon: 137,
  avalanche: 43114, blast: 81457, gnosis: 100, monad: 143, abstract: 2741,
  apechain: 33139, robinhood: 4663, arc: 5042, ronin: 2020, soneium: 1868,
  worldchain: 480, zora: 7777777, hyperevm: 998,
}
const lifi = await (await fetch('https://li.quest/v1/chains', { headers: { accept: 'application/json' } })).json()
const lifiIds = new Map((lifi.chains || []).map(c => [c.id, c]))
let relayIds = new Map()
try {
  const r = await (await fetch('https://api.relay.link/chains', { headers: { accept: 'application/json' } })).json()
  relayIds = new Map((r.chains || []).map(c => [c.id, c]))
} catch (e) { console.log('relay chains failed:', e.message) }

console.log('chain          id        LI.FI                Relay')
console.log('-'.repeat(78))
for (const [name, id] of Object.entries(WALLET)) {
  const l = lifiIds.get(id)
  const rl = relayIds.get(id)
  const lstr = l ? `yes (${l.name}, ${l.nativeToken?.symbol ?? '?'})` : 'NO'
  const rstr = rl ? `yes (${rl.displayName ?? rl.name})` : 'NO'
  console.log(`${name.padEnd(14)} ${String(id).padEnd(9)} ${lstr.padEnd(20)} ${rstr}`)
}
console.log('\nLI.FI total chains:', lifiIds.size, ' Relay total:', relayIds.size)
// Any LI.FI/Relay chain we do NOT have in the wallet? (informational)
const missingFromWallet = [...lifiIds.values()].filter(c => !Object.values(WALLET).includes(c.id) && c.chainType === 'EVM').slice(0, 12)
console.log('LI.FI EVM chains absent from our registry (first 12):', missingFromWallet.map(c => `${c.name}(${c.id})`).join(', '))
