/**
 * chainlens-rp.cjs — a local stand-in for ChainLens's passkey routes
 *
 * The ceremony code here is lifted from chainlens/backend-server.js: the same
 * @simplewebauthn/server version, the same generateRegistrationOptions /
 * verifyRegistrationResponse arguments (attestationType 'none', residentKey
 * 'required', userVerification 'preferred', requireUserVerification false), and
 * the same four routes the site's page calls. The served page reuses
 * chainlensnft.info's own toCreateOptions / regToJSON / authToJSON helpers
 * verbatim, so the browser side is byte-for-byte what production runs.
 *
 * WHY LOCAL. `/api/auth/passkey/register-options` is behind requireAuth, so
 * registering against the deployed site needs a real ChainLens session AND
 * writes a row to the production cl_passkeys table. An e2e must not do that.
 * Serving the identical logic on http://localhost keeps every byte the wallet
 * produces under test while leaving the live service alone —
 * `passkey-browser.spec.ts` separately probes the DEPLOYED routes read-only to
 * confirm the options they hand out are the ones this exercises.
 *
 * Storage is in-memory and single-user; it exists to answer "did the RP verify
 * what the wallet signed?", nothing more.
 */

const http = require('http')
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server')

const RP_NAME = 'ChainLens'
const USER_ID = 'e2e-user-0001'
const USER_NAME = 'e2e@chainlensnft.info'

function page() {
  // Lifted from chainlens/public/index.html — the exact converters and
  // serialisers the real site uses around navigator.credentials.
  return `<!doctype html><html><head><meta charset="utf-8"><title>ChainLens passkey e2e</title></head>
<body style="font-family:system-ui;background:#0b1220;color:#e5e7eb;padding:24px">
<h1>ChainLens passkey</h1>
<button id="reg">Add a passkey</button>
<button id="login">Sign in with a passkey</button>
<pre id="out" style="white-space:pre-wrap;word-break:break-all">idle</pre>
<script>
const b64uToBuf = (s) => {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const bufToB64u = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
};
const toCreateOptions = (o) => ({
  ...o,
  challenge: b64uToBuf(o.challenge),
  user: { ...o.user, id: b64uToBuf(o.user.id) },
  excludeCredentials: (o.excludeCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) })),
});
const toGetOptions = (o) => ({
  ...o,
  challenge: b64uToBuf(o.challenge),
  allowCredentials: (o.allowCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) })),
});
const regToJSON = (cred) => ({
  id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
  authenticatorAttachment: cred.authenticatorAttachment || undefined,
  clientExtensionResults: cred.getClientExtensionResults(),
  response: {
    clientDataJSON: bufToB64u(cred.response.clientDataJSON),
    attestationObject: bufToB64u(cred.response.attestationObject),
    transports: cred.response.getTransports ? cred.response.getTransports() : [],
  },
});
const authToJSON = (cred) => ({
  id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
  authenticatorAttachment: cred.authenticatorAttachment || undefined,
  clientExtensionResults: cred.getClientExtensionResults(),
  response: {
    clientDataJSON: bufToB64u(cred.response.clientDataJSON),
    authenticatorData: bufToB64u(cred.response.authenticatorData),
    signature: bufToB64u(cred.response.signature),
    userHandle: cred.response.userHandle ? bufToB64u(cred.response.userHandle) : undefined,
  },
});
const out = (v) => { document.getElementById('out').textContent = typeof v === 'string' ? v : JSON.stringify(v); };
window.__mmResult = null;
const done = (v) => { window.__mmResult = v; out(v); };

document.getElementById('reg').onclick = async () => {
  done(null); out('registering…');
  try {
    const start = await (await fetch('/api/auth/passkey/register-options', { method: 'POST' })).json();
    const cred = await navigator.credentials.create({ publicKey: toCreateOptions(start.options) });
    if (!cred) throw new Error('No passkey was created');
    const res = await fetch('/api/auth/passkey/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: regToJSON(cred), ceremony: start.ceremony }),
    });
    const data = await res.json();
    done({ ok: res.ok, stage: 'register', ...data });
  } catch (e) { done({ ok: false, stage: 'register', name: e.name, error: String(e.message || e) }); }
};

document.getElementById('login').onclick = async () => {
  done(null); out('signing in…');
  try {
    const start = await (await fetch('/api/auth/passkey/login-options', { method: 'POST' })).json();
    const cred = await navigator.credentials.get({ publicKey: toGetOptions(start.options) });
    if (!cred) throw new Error('No passkey was selected');
    const res = await fetch('/api/auth/passkey/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: authToJSON(cred), ceremony: start.ceremony }),
    });
    const data = await res.json();
    done({ ok: res.ok, stage: 'login', ...data });
  } catch (e) { done({ ok: false, stage: 'login', name: e.name, error: String(e.message || e) }); }
};

window.__mmCaps = async () => ({
  hasCredentials: typeof navigator.credentials?.create === 'function',
  hasPublicKeyCredential: typeof window.PublicKeyCredential !== 'undefined',
  uvpaa: window.PublicKeyCredential
    ? await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    : false,
});
</script></body></html>`
}

/**
 * rpID must be the host the page is served from; localhost is the only one an
 * e2e can own. `port` is pinned only for device runs, where `adb reverse` needs
 * a number known in advance; the e2e leaves it 0 so parallel runs cannot clash.
 */
function start(rpId = 'localhost', port = 0) {
  const passkeys = []          // { credential_id, public_key(b64u), counter, transports }
  const challenges = new Map() // ceremony -> { challenge, type }

  const b64uEncode = (buf) => Buffer.from(buf).toString('base64url')
  const b64uDecode = (s) => new Uint8Array(Buffer.from(s, 'base64url'))

  const stash = (challenge, type) => {
    const ceremony = Math.random().toString(36).slice(2)
    challenges.set(ceremony, { challenge, type })
    return ceremony
  }
  const take = (ceremony, type) => {
    const e = challenges.get(ceremony)
    if (!e || e.type !== type) return null
    challenges.delete(ceremony)
    return e.challenge
  }

  const server = http.createServer(async (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const origin = `http://${rpId}:${server.address().port}`

    try {
      if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(page())
        return
      }

      const body = req.method === 'POST'
        ? await new Promise((resolve) => {
            let raw = ''
            req.on('data', c => { raw += c })
            req.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) } })
          })
        : {}

      if (req.url === '/api/auth/passkey/register-options') {
        const options = await generateRegistrationOptions({
          rpName: RP_NAME,
          rpID: rpId,
          userID: new TextEncoder().encode(USER_ID),
          userName: USER_NAME,
          userDisplayName: 'ChainLens e2e',
          attestationType: 'none',
          excludeCredentials: passkeys.map(p => ({ id: p.credential_id, transports: p.transports || undefined })),
          authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        })
        return send(200, { options, ceremony: stash(options.challenge, 'register') })
      }

      if (req.url === '/api/auth/passkey/register') {
        const expectedChallenge = take(body.ceremony, 'register')
        if (!expectedChallenge) return send(400, { error: 'That request expired' })
        const verification = await verifyRegistrationResponse({
          response: body.response,
          expectedChallenge,
          expectedOrigin: origin,
          expectedRPID: rpId,
          requireUserVerification: false,
        })
        if (!verification.verified) return send(400, { error: 'Passkey could not be verified' })
        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
        passkeys.push({
          credential_id: credential.id,
          public_key: b64uEncode(credential.publicKey),
          counter: credential.counter || 0,
          transports: credential.transports || null,
        })
        return send(200, {
          success: true,
          verified: true,
          aaguid: verification.registrationInfo.aaguid,
          deviceType: credentialDeviceType,
          backedUp: !!credentialBackedUp,
          count: passkeys.length,
        })
      }

      if (req.url === '/api/auth/passkey/login-options') {
        // No allowCredentials: the site offers whichever passkeys the device
        // holds and the user picks — the discoverable path.
        const options = await generateAuthenticationOptions({ rpID: rpId, userVerification: 'preferred' })
        return send(200, { options, ceremony: stash(options.challenge, 'login') })
      }

      if (req.url === '/api/auth/passkey/login') {
        const expectedChallenge = take(body.ceremony, 'login')
        if (!expectedChallenge) return send(400, { error: 'That request expired' })
        const stored = passkeys.find(p => p.credential_id === body.response?.id)
        if (!stored) return send(404, { error: 'Unknown passkey' })
        const verification = await verifyAuthenticationResponse({
          response: body.response,
          expectedChallenge,
          expectedOrigin: origin,
          expectedRPID: rpId,
          requireUserVerification: false,
          credential: {
            id: stored.credential_id,
            publicKey: b64uDecode(stored.public_key),
            counter: stored.counter,
            transports: stored.transports || undefined,
          },
        })
        if (!verification.verified) return send(400, { error: 'Passkey sign-in failed' })
        stored.counter = verification.authenticationInfo.newCounter
        return send(200, {
          success: true,
          verified: true,
          token: 'e2e-session-token',
          userVerified: verification.authenticationInfo.userVerified,
          credentialId: verification.authenticationInfo.credentialID,
        })
      }

      send(404, { error: 'not found' })
    } catch (e) {
      send(500, { error: String(e && e.message ? e.message : e) })
    }
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        // Must be the literal hostname "localhost" so it matches rpID.
        url: `http://${rpId}:${server.address().port}/`,
        port: server.address().port,
        passkeys,
        close: () => new Promise(r => server.close(r)),
      })
    })
  })
}

module.exports = { start }
