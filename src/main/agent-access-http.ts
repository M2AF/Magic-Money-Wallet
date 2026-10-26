import { createServer, type Server } from 'node:http'
import { AgentAccessCore, agentArgs, agentText } from './agent-access-core'

/** Private loopback RPC, not an HTTP MCP endpoint. MCP is served by the stdio adapter. */
export async function startAgentHttp(core: AgentAccessCore): Promise<{ endpoint: string; close(): void }> {
  let server: Server
  server = createServer({ maxHeaderSize: 4096 }, async (req, res) => {
    const reply = (status: number, body: unknown) => {
      if (res.destroyed) return
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'close' })
      res.end(JSON.stringify(body))
    }
    const address = server.address()
    const host = typeof address === 'object' && address ? `127.0.0.1:${address.port}` : ''
    // No browser origins, CORS, cookies, arbitrary hostnames, proxying or redirects.
    if (req.headers.host !== host || req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) {
      reply(403, { error: 'Browser access is not allowed.' }); return
    }
    if (req.method !== 'POST' || req.url !== '/rpc') { reply(404, { error: 'Not found.' }); return }
    if (req.headers['content-type'] !== 'application/json') { reply(415, { error: 'Expected application/json.' }); return }
    const auth = req.headers.authorization
    if (!auth || !/^Bearer [a-f0-9]{64}$/.test(auth)) { reply(401, { error: 'Agent access denied.' }); return }
    if (Number(req.headers['content-length'] ?? 0) > 8192) { reply(413, { error: 'Request too large.' }); return }
    req.setTimeout(5000, () => req.destroy())
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 8192) { reply(413, { error: 'Request too large.' }); return }
        chunks.push(chunk)
      }
      // The five-second timeout protects BODY upload only. Provider reads can
      // legitimately take longer; do not destroy their socket while awaiting them.
      req.setTimeout(0)
      const envelope = agentArgs(JSON.parse(Buffer.concat(chunks).toString('utf8')), ['tool', 'args'], ['tool', 'args'])
      const result = await core.call(auth.slice(7), agentText(envelope.tool, 'tool', 64), envelope.args)
      reply(200, { result })
    } catch {
      // Provider errors may contain URLs, credentials, request bodies or local paths.
      reply(400, { error: 'Request denied or unavailable. Check pairing, permissions, arguments, account, expiry and wallet unlock; retry later if busy.' })
    }
  })
  server.maxConnections = 8
  server.requestTimeout = 10_000
  server.headersTimeout = 5000
  server.keepAliveTimeout = 1000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') { server.close(); throw new Error('Agent listener unavailable.') }
  return { endpoint: `http://127.0.0.1:${address.port}/rpc`, close() { server.closeAllConnections(); server.close() } }
}
