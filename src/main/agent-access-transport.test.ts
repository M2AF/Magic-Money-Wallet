import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentAccessCore, type AgentReadPort } from './agent-access-core'
import { startAgentHttp } from './agent-access-http'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { request as httpRequest } from 'node:http'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
async function fixture() {
  const addresses = vi.fn(async () => ({ evm: 'public-address-only' }))
  const core = new AgentAccessCore({ context: () => ({ key: 'test', accountIndex: 0, environment: 'mainnet' }),
    addresses, record() {}, networks: async () => [], balances: async () => ({}), tokens: async () => [], sessions: async () => [],
    search: async () => [], transfer: async () => { throw new Error('unused') }, quote: async () => { throw new Error('unused') }, balance: async () => null } satisfies AgentReadPort)
  core.setEnabled(true)
  const { token } = core.pair('Test', false)
  const server = await startAgentHttp(core)
  cleanups.push(server.close)
  const call = (headers: Record<string, string> = {}, body = JSON.stringify({ tool: 'wallet_addresses', args: {} })) => fetch(server.endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers }, body,
  })
  return { core, server, call, token, addresses }
}

describe('agent loopback transport', () => {
  it('requires authentication, exact Host, no browser Origin or fetch metadata, JSON and exact route', async () => {
    const s = await fixture()
    const invalidHeaders: Record<string, string>[] = [{ Authorization: '' }, { Authorization: `Bearer ${'b'.repeat(64)}` },
      { Origin: 'https://evil.example' }, { Origin: 'null' },
      { 'Sec-Fetch-Site': 'same-origin' }, { 'Content-Type': 'text/plain' }]
    for (const headers of invalidHeaders) {
      const response = await s.call(headers)
      expect(response.ok, JSON.stringify(headers)).toBe(false)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
    expect(s.addresses).not.toHaveBeenCalled()
    // fetch normalizes Host; use a raw HTTP request to test rebinding on the wire.
    const badHost = await new Promise<number | undefined>((resolveStatus, reject) => {
      const req = httpRequest(s.server.endpoint, { method: 'POST', headers: { Host: 'evil.example',
        'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` } }, response => { response.resume(); resolveStatus(response.statusCode) })
      req.on('error', reject); req.end(JSON.stringify({ tool: 'wallet_addresses', args: {} }))
    })
    expect(badHost).toBe(403)
    expect((await fetch(s.server.endpoint)).status).toBe(404)
    expect((await fetch(s.server.endpoint.replace('/rpc', '/wallet'), { method: 'POST' })).status).toBe(404)
    const good = await s.call()
    expect(good.status).toBe(200)
    expect(await good.json()).toEqual({ result: { evm: 'public-address-only' } })
    expect(good.headers.get('cache-control')).toBe('no-store')
  })
  it('rejects oversized, malformed, unknown and signer requests without reflecting secrets', async () => {
    const s = await fixture()
    const tooLarge = await s.call({}, 'x'.repeat(8193))
    expect(tooLarge.status).toBe(413)
    for (const body of ['not-json', '{}', '[]', JSON.stringify({ tool: 'wallet_addresses', args: {}, url: 'https://evil' }),
      JSON.stringify({ tool: 'wallet_sign', args: { secret: 'dont-reflect-me' } })]) {
      const response = await s.call({}, body)
      expect(response.ok).toBe(false)
      expect(await response.text()).not.toContain('dont-reflect-me')
    }
    expect(s.addresses).not.toHaveBeenCalled()
  })
  it('does not apply the body-upload timeout to a slower provider read', async () => {
    const s = await fixture()
    s.addresses.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 5200))
      return { evm: 'public-address-only' }
    })
    const response = await s.call()
    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ result: { evm: 'public-address-only' } })
  }, 10_000)
  it('runs exported CLI and stdio MCP against the real restricted server', async () => {
    const s = await fixture()
    const folder = mkdtempSync(join(tmpdir(), 'mm-agent-unit-'))
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }))
    const path = join(folder, 'connection.json')
    writeFileSync(path, JSON.stringify({ version: 1, endpoint: s.server.endpoint, token: s.token }))
    const adapter = resolve('resources/agent-access.mjs')
    const run = (command: string, lines = '') => new Promise<{ code: number | null; out: string; err: string }>((resolveRun, reject) => {
      const child = spawn(process.execPath, [adapter, '--connection', path, command], { stdio: 'pipe' })
      cleanups.push(() => child.kill())
      let out = '', err = ''
      child.stdout.on('data', data => { out += data.toString() })
      child.stderr.on('data', data => { err += data.toString() })
      child.on('error', reject)
      child.on('close', code => resolveRun({ code, out, err }))
      child.stdin.end(lines)
    })
    const cli = await run('addresses')
    expect(cli.code).toBe(0); expect(JSON.parse(cli.out)).toEqual({ evm: 'public-address-only' })
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'wallet_addresses', arguments: {} } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'wallet_propose_transfer', arguments: {} } },
    ]
    const mcp = await run('mcp', messages.map(m => JSON.stringify(m)).join('\n') + '\n')
    expect(mcp.code).toBe(0); expect(mcp.err).toBe('')
    const replies = mcp.out.trim().split('\n').map(line => JSON.parse(line))
    expect(replies.map(r => r.id)).toEqual([1, 2, 3, 4])
    expect(replies[0].result.protocolVersion).toBe('2025-11-25')
    expect(replies[1].result.tools.some((t: { name: string }) => t.name === 'wallet_propose_transfer')).toBe(false)
    expect(JSON.parse(replies[2].result.content[0].text)).toEqual({ evm: 'public-address-only' })
    expect(replies[3].result.isError).toBe(true)
    expect(mcp.out).not.toContain(s.token)
  }, 15_000)
  it('negotiates initialization and rejects tool use before initialized without calling the wallet', async () => {
    const adapterUrl = pathToFileURL(resolve('resources/agent-access.mjs')).href
    const { createMcpHandler, readConnection } = await import(/* @vite-ignore */ adapterUrl)
    const call = vi.fn(async () => [])
    const handle = createMcpHandler(call)
    expect((await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).error.code).toBe(-32002)
    expect((await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: 'unknown', capabilities: {}, clientInfo: {} } })).result.protocolVersion).toBe('2025-11-25')
    expect((await handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).error.code).toBe(-32002)
    await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect((await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'wallet_addresses' } })).result.isError).toBeUndefined()
    expect(call).toHaveBeenCalledWith('wallet_addresses', {})
    expect((await handle({ jsonrpc: '2.0', id: 4, method: 'unknown' })).error.code).toBe(-32601)
    expect((await handle([])).error.code).toBe(-32600)
    expect(call).toHaveBeenCalledTimes(1)
    const folder = mkdtempSync(join(tmpdir(), 'mm-agent-bad-'))
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }))
    const file = join(folder, 'bad.json')
    for (const endpoint of ['https://evil.example/rpc', 'http://127.0.0.1.evil.example:123/rpc', 'http://localhost:123/rpc', 'http://127.0.0.1:65536/rpc', 'http://127.0.0.1:123/rpc?token=secret']) {
      writeFileSync(file, JSON.stringify({ version: 1, endpoint, token: 'a'.repeat(64) }))
      expect(() => readConnection(file)).toThrow()
    }
  })
})
