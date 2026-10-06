/**
 * journey-store.ts — durable storage for multi-leg journeys (privileged layer),
 * over each platform's one persisted map (Electron: atomic file; extension:
 * chrome.storage.local; native: Capacitor Preferences). Values are the JSON
 * that src/shared/stablecoin-journey.ts produces and parses.
 *
 * Guarantees:
 *   - One write queue per process: every save is a whole-map read-modify-write,
 *     so concurrent saves cannot drop each other's records.
 *   - An unreadable map throws (the platform loaders refuse to read damaged
 *     data as empty), and an unreadable RECORD is reported and kept — never
 *     dropped or overwritten — so evidence of a sent transaction cannot vanish.
 *   - A save may only move a journey forward: a recorded transaction hash or
 *     bridge reference is never replaced or cleared, a confirmed or measured
 *     step never changes, and a finished journey stays finished.
 *   - Active journeys are restored on every start regardless of age (the
 *     ordinary swap-session lifetime does not apply).
 */

import { parseJourney, JourneyError, journeyKeepsAlive, type StablecoinJourney } from '../shared/stablecoin-journey'

export interface JourneyWriteQueue { tail: Promise<unknown> }
export const createJourneyWriteQueue = (): JourneyWriteQueue => ({ tail: Promise.resolve() })

/** The one queue for this process's journey map. */
export const JOURNEY_WRITES = createJourneyWriteQueue()

export class JourneyStoreError extends Error {}

export interface JourneyListing {
  journeys: StablecoinJourney[]
  /** Keys whose stored record could not be parsed. Kept untouched for review. */
  unreadable: string[]
}

export interface JourneyStore {
  list(): Promise<JourneyListing>
  get(id: string): Promise<StablecoinJourney | null>
  /** Persist a journey. Refuses any regression against the stored copy. */
  put(journey: StablecoinJourney): Promise<void>
}

const ID = /^[A-Za-z0-9_-]{1,80}$/

/** Throws unless `next` only moves `prev` forward. */
export function assertJourneyProgress(prev: StablecoinJourney, next: StablecoinJourney): void {
  const fail = (why: string): never => { throw new JourneyStoreError(why) }
  if (prev.id !== next.id || prev.walletId !== next.walletId || prev.bridge !== next.bridge
      || prev.recipient !== next.recipient || prev.createdAt !== next.createdAt) fail('A stored journey\'s identity cannot change.')
  if (prev.status !== 'active' && next.status !== prev.status) fail('A finished journey cannot be reopened.')
  if (prev.authorization && JSON.stringify(prev.authorization) !== JSON.stringify(next.authorization)) {
    fail('Authorized transfer terms never change; changed terms need a new approval.')
  }
  prev.legs.forEach((p, i) => {
    const n = next.legs[i]
    if (JSON.stringify(p.input) !== JSON.stringify(n.input) || JSON.stringify(p.output) !== JSON.stringify(n.output)) fail('A step\'s assets cannot change.')
    if (p.txHash && n.txHash !== p.txHash) fail('A recorded transaction hash is never replaced or cleared.')
    if (p.providerRef && n.providerRef !== p.providerRef) fail('A recorded bridge reference is never replaced or cleared.')
    if (p.approvalTxHash && n.approvalTxHash !== p.approvalTxHash) fail('A recorded approval transaction is never replaced or cleared.')
    if (p.approvedInputRaw && n.approvedInputRaw !== p.approvedInputRaw) fail('An approved amount cannot change.')
    if (p.state === 'confirmed' && (n.state !== 'confirmed' || n.measuredOutputRaw !== p.measuredOutputRaw)) fail('A confirmed step cannot change.')
    if (p.state === 'skipped' && n.state !== 'skipped') fail('A skipped step cannot be revived.')
  })
}

export function journeyMapStore(
  load: () => Promise<Record<string, string>>,
  save: (map: Record<string, string>) => Promise<void>,
  queue: JourneyWriteQueue = JOURNEY_WRITES,
): JourneyStore {
  const read = async (): Promise<{ map: Record<string, string>; listing: JourneyListing }> => {
    const map = await load()
    const journeys: StablecoinJourney[] = []
    const unreadable: string[] = []
    for (const [key, json] of Object.entries(map)) {
      try {
        const j = parseJourney(json)
        if (j.id !== key) throw new JourneyError('key mismatch')
        journeys.push(j)
      } catch { unreadable.push(key) }
    }
    journeys.sort((a, b) => a.createdAt - b.createdAt)
    return { map, listing: { journeys, unreadable } }
  }
  return {
    async list() { return (await read()).listing },
    async get(id) {
      const { map, listing } = await read()
      if (listing.unreadable.includes(id)) throw new JourneyStoreError('This journey\'s stored record is unreadable; it was left untouched.')
      return Object.prototype.hasOwnProperty.call(map, id) ? listing.journeys.find(j => j.id === id) ?? null : null
    },
    put(journey) {
      const run = queue.tail.then(async () => {
        if (!ID.test(journey.id)) throw new JourneyStoreError('Invalid journey id.')
        const json = JSON.stringify(journey)
        parseJourney(json) // never persist what could not be read back
        const { map, listing } = await read()
        if (listing.unreadable.includes(journey.id)) throw new JourneyStoreError('The stored copy of this journey is unreadable; it was left untouched.')
        const prev = listing.journeys.find(j => j.id === journey.id)
        if (prev) assertJourneyProgress(prev, journey)
        await save({ ...map, [journey.id]: json })
      })
      queue.tail = run.catch(() => { /* the caller sees this failure; later writes still run */ })
      return run
    },
  }
}

export interface RestoredJourneys {
  /** Active journeys, oldest first: these are resumed on start. */
  active: StablecoinJourney[]
  /** Active steps whose outcome must be read from the chain by their recorded hash — never re-sent. */
  awaitingEvidence: Array<{ journeyId: string; role: string; txHash: string; providerRef: string | null }>
  finished: StablecoinJourney[]
  unreadable: string[]
}

/** What a start-up must resume. Read-only. */
export async function restoreJourneys(store: JourneyStore): Promise<RestoredJourneys> {
  const { journeys, unreadable } = await store.list()
  const active = journeys.filter(journeyKeepsAlive)
  return {
    active,
    awaitingEvidence: active.flatMap(j => [
      ...j.legs
        .filter(l => l.txHash && (l.state === 'submitted' || l.state === 'uncertain'))
        .map(l => ({ journeyId: j.id, role: l.role, txHash: l.txHash as string, providerRef: l.providerRef })),
      // An approval sent before an interruption, with the step itself not yet sent.
      ...j.legs
        .filter(l => l.approvalTxHash && !l.txHash && l.state === 'approved')
        .map(l => ({ journeyId: j.id, role: `${l.role}:approval`, txHash: l.approvalTxHash as string, providerRef: null })),
    ]),
    finished: journeys.filter(j => !journeyKeepsAlive(j)),
    unreadable,
  }
}
