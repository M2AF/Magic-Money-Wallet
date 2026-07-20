import { afterEach, describe, expect, it, vi } from 'vitest'
import { installProviders, type ProviderTransport } from './provider-core'

function makeWindow(cardano: Record<string, unknown> = {}) {
  const events = new EventTarget()
  return Object.assign(events, { cardano })
}

function makeTransport(calls: Array<{ type: string; args: unknown[] }>): ProviderTransport {
  return {
    send<T = unknown>(type: string, args: unknown[]): Promise<T> {
      calls.push({ type, args })
      return Promise.resolve(undefined as T)
    },
    onEvent() { /* no push events needed for provider installation */ },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Cardano provider compatibility keys', () => {
  it('exposes the same MagicMoney provider at magicmoney and vespr', async () => {
    const calls: Array<{ type: string; args: unknown[] }> = []
    const pageWindow = makeWindow()
    vi.stubGlobal('window', pageWindow)

    installProviders(makeTransport(calls))

    const cardano = pageWindow.cardano as Record<string, {
      name: string
      enable(): Promise<unknown>
    }>
    expect(cardano.magicmoney).toBe(cardano.vespr)
    expect(cardano.magicmoney.name).toBe('MagicMoney Wallet')

    await cardano.magicmoney.enable()
    await cardano.vespr.enable()
    expect(calls.filter(({ type }) => type === 'cardano:enable')).toHaveLength(2)
  })

  it('does not overwrite a genuine VESPR provider', () => {
    const genuineVespr = { name: 'VESPR' }
    const pageWindow = makeWindow({ vespr: genuineVespr })
    vi.stubGlobal('window', pageWindow)

    installProviders(makeTransport([]))

    expect(pageWindow.cardano.vespr).toBe(genuineVespr)
    expect(pageWindow.cardano.magicmoney).toMatchObject({ name: 'MagicMoney Wallet' })
  })
})
