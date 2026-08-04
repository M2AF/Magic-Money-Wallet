/**
 * solana-siws.ts — Sign In With Solana (SIWS), the `solana:signIn` Wallet
 * Standard feature.
 *
 * Why this matters more than it looks: without SIWS, dApps authenticate by
 * handing the wallet an opaque string through `signMessage`. The wallet has no
 * idea what it is signing, and — critically — no way to tell that the message
 * says "sign in to good-dapp.com" while the page actually asking is
 * evil-phishing.io. The user reads the message, the wallet learns nothing, and
 * the signature is replayable against the real site.
 *
 * SIWS makes the fields structured, which lets the WALLET do the check the user
 * cannot: compare the `domain` the dApp claims against the origin that actually
 * sent the request. `checkSiwsDomain` below is the whole point of this module —
 * everything else is message construction.
 *
 * Message format follows the SIWS spec (derived from EIP-4361 / CAIP-122).
 */

export interface SiwsInput {
  domain?: string
  address?: string
  statement?: string
  uri?: string
  version?: string
  chainId?: string
  nonce?: string
  issuedAt?: string
  expirationTime?: string
  notBefore?: string
  requestId?: string
  resources?: string[]
}

/**
 * Build the exact message text to sign.
 *
 * Field ORDER and spacing are load-bearing: the dApp verifies the signature by
 * reconstructing this string itself, so any deviation makes every sign-in fail
 * verification. Optional fields are omitted entirely rather than emitted empty.
 */
export function buildSiwsMessage(input: SiwsInput, address: string): string {
  const domain = input.domain ?? ''
  const lines: string[] = [
    `${domain} wants you to sign in with your Solana account:`,
    input.address || address,
  ]

  if (input.statement) lines.push('', input.statement)

  const fields: string[] = []
  if (input.uri)            fields.push(`URI: ${input.uri}`)
  if (input.version)        fields.push(`Version: ${input.version}`)
  if (input.chainId)        fields.push(`Chain ID: ${input.chainId}`)
  if (input.nonce)          fields.push(`Nonce: ${input.nonce}`)
  if (input.issuedAt)       fields.push(`Issued At: ${input.issuedAt}`)
  if (input.expirationTime) fields.push(`Expiration Time: ${input.expirationTime}`)
  if (input.notBefore)      fields.push(`Not Before: ${input.notBefore}`)
  if (input.requestId)      fields.push(`Request ID: ${input.requestId}`)
  if (input.resources?.length) {
    fields.push('Resources:')
    for (const r of input.resources) fields.push(`- ${r}`)
  }

  if (fields.length > 0) lines.push('', ...fields)
  return lines.join('\n')
}

/** First line of a SIWS message: `<domain> wants you to sign in with your Solana account:` */
const SIWS_HEADER = /^(\S+) wants you to sign in with your Solana account:\s*$/

/**
 * Recognise a SIWS message that arrived through plain `signMessage`.
 *
 * This matters more than the `solana:signIn` path it complements. Most dApps —
 * Magic Eden among them — still authenticate by formatting a SIWS message
 * themselves and pushing it through `signMessage`, which hands the wallet an
 * opaque string and no way to check anything. Parsing the domain back out lets
 * the SAME phishing check run: a site can print "magiceden.io wants you to sign
 * in" all it likes, but it cannot change the origin the request came from.
 *
 * Returns null for anything that isn't SIWS-shaped, so ordinary messages are
 * unaffected.
 */
export function parseSiwsMessage(text: string): SiwsInput | null {
  const lines = text.split('\n')
  const header = SIWS_HEADER.exec(lines[0] ?? '')
  if (!header) return null

  const input: SiwsInput = { domain: header[1] }
  if (lines[1]?.trim()) input.address = lines[1].trim()

  const resources: string[] = []
  let inResources = false
  const statement: string[] = []
  let seenField = false

  for (const raw of lines.slice(2)) {
    const line = raw.trim()
    if (inResources) {
      if (line.startsWith('- ')) { resources.push(line.slice(2)); continue }
      inResources = false
    }
    if (line === 'Resources:')            { inResources = true; seenField = true; continue }
    const field = /^([A-Za-z ]+):\s*(.*)$/.exec(line)
    if (field) {
      const [, key, value] = field
      switch (key) {
        case 'URI':             input.uri = value; seenField = true; continue
        case 'Version':         input.version = value; seenField = true; continue
        case 'Chain ID':        input.chainId = value; seenField = true; continue
        case 'Nonce':           input.nonce = value; seenField = true; continue
        case 'Issued At':       input.issuedAt = value; seenField = true; continue
        case 'Expiration Time': input.expirationTime = value; seenField = true; continue
        case 'Not Before':      input.notBefore = value; seenField = true; continue
        case 'Request ID':      input.requestId = value; seenField = true; continue
      }
    }
    // Anything before the first recognised field is the human statement.
    if (!seenField && line) statement.push(line)
  }

  if (statement.length) input.statement = statement.join(' ')
  if (resources.length) input.resources = resources
  return input
}

export interface SiwsDomainCheck {
  ok: boolean
  /** Present when the check fails — shown to the user as a warning. */
  warning?: string
  /** The host we compared against, for display. */
  originHost: string
}

/**
 * Compare the domain a dApp claims against the origin that actually asked.
 *
 * A mismatch is the signature of a phishing page: the message the user reads
 * names a site they trust, while the request came from somewhere else. We
 * surface it loudly rather than silently signing.
 *
 * Subdomains of the requesting host are accepted (app.foo.com asking to sign in
 * to foo.com is normal); anything else is a mismatch.
 */
export function checkSiwsDomain(claimedDomain: string | undefined, origin: string): SiwsDomainCheck {
  let originHost = ''
  try { originHost = new URL(origin).host } catch { originHost = origin }

  if (!claimedDomain) {
    // The spec allows omitting it; we then bind to the real origin ourselves.
    return { ok: true, originHost }
  }

  // The claimed domain may carry a port or a scheme — normalise both sides.
  let claimed = claimedDomain.trim().toLowerCase()
  try { if (claimed.includes('://')) claimed = new URL(claimed).host } catch { /* use as-is */ }
  const actual = originHost.toLowerCase()

  if (claimed === actual) return { ok: true, originHost }

  // Allow the host to be a subdomain of the claimed domain, and vice versa.
  const claimedHost = claimed.split(':')[0]
  const actualHost = actual.split(':')[0]
  if (actualHost === claimedHost) return { ok: true, originHost }
  if (actualHost.endsWith(`.${claimedHost}`) || claimedHost.endsWith(`.${actualHost}`)) {
    return { ok: true, originHost }
  }

  return {
    ok: false,
    originHost,
    warning: `This site is ${actualHost}, but it is asking you to sign in to "${claimedHost}". `
           + 'That mismatch is how phishing sites steal sign-ins — do not continue unless you know why.',
  }
}

/** Human-readable body for the sign-in approval prompt. */
export function formatSiws(input: SiwsInput, address: string, check: SiwsDomainCheck): string {
  const lines: string[] = []
  const pad = (l: string): string => l.padEnd(14, ' ')

  lines.push(`${pad('Sign in to')}${input.domain || check.originHost}`)
  lines.push(`${pad('Account')}${address}`)
  if (input.statement)      lines.push('', input.statement, '')
  if (input.uri)            lines.push(`${pad('URI')}${input.uri}`)
  if (input.chainId)        lines.push(`${pad('Network')}${input.chainId}`)
  if (input.nonce)          lines.push(`${pad('Nonce')}${input.nonce}`)
  if (input.issuedAt)       lines.push(`${pad('Issued')}${input.issuedAt}`)
  if (input.expirationTime) lines.push(`${pad('Expires')}${input.expirationTime}`)
  if (input.resources?.length) {
    lines.push(`${pad('Resources')}${input.resources.length}`)
    for (const r of input.resources.slice(0, 4)) lines.push(`  - ${r}`)
  }

  lines.push('')
  lines.push('Signing in proves you control this account. It cannot move funds.')
  return lines.join('\n')
}

/** Warnings for the approval band. */
export function siwsWarnings(input: SiwsInput, check: SiwsDomainCheck): string[] {
  const w: string[] = []
  if (check.warning) w.push(check.warning)

  if (input.expirationTime) {
    const exp = Date.parse(input.expirationTime)
    if (!Number.isNaN(exp) && exp < Date.now()) {
      w.push('This sign-in request has already expired')
    }
  }
  if (!input.nonce) {
    // Without a nonce the signature can be replayed by anyone who sees it.
    w.push('This sign-in request has no nonce, so the signature could be reused')
  }
  return w
}
