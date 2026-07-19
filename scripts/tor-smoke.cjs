/** Manual Electron smoke test for the managed Tor runtime. */
const { app, session } = require('electron')
const net = require('net')
if (process.env.MM_TOR_SMOKE_USERDATA) app.setPath('userData', process.env.MM_TOR_SMOKE_USERDATA)
const { ensureManagedTor, stopManagedTor, managedTorInfo } = require('../out/tor-smoke-manager.cjs')

function portIsFree(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port }, () => server.close(() => resolve(true)))
  })
}

async function main() {
  const requestedPort = Number(process.env.MM_TOR_SMOKE_PORT || 9050)
  const candidates = [...new Set([requestedPort, 9150, 19050])]
  let port = null
  for (const candidate of candidates) {
    if (await portIsFree(candidate)) { port = candidate; break }
  }
  if (!port) throw new Error('No free local port was available for the Tor smoke test')
  if (port !== requestedPort) console.log(`[tor-smoke] port ${requestedPort} is busy; using ${port}`)
  console.log('[tor-smoke] release', managedTorInfo())
  await ensureManagedTor(port, message => console.log('[tor-smoke]', message))
  const torSession = session.fromPartition('tor-smoke')
  await torSession.setProxy({
    mode: 'fixed_servers',
    proxyRules: `socks5://127.0.0.1:${port}`,
    proxyBypassRules: '<-loopback>',
  })
  await torSession.closeAllConnections()
  const response = await torSession.fetch('https://check.torproject.org/api/ip', { cache: 'no-store' })
  const result = await response.json()
  console.log('[tor-smoke] verification', result)
  if (result.IsTor !== true) throw new Error('Tor Project did not recognize the managed exit as Tor')
}

app.whenReady().then(main).then(
  () => { stopManagedTor(); app.quit() },
  error => { console.error('[tor-smoke] failed', error); stopManagedTor(); app.exit(1) },
)
