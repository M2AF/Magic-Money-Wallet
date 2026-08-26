/**
 * personal-sign.ts — one reading of an `eth_personal_sign` payload.
 *
 * Shared by every host that signs one (the extension service worker, Electron
 * main, and both WalletConnect clients) so the four can never drift apart on
 * what a dApp actually asked us to sign.
 *
 * EIP-191 `personal_sign` nominally takes params[0] as a hex-encoded byte
 * string, but plenty of dApps pass the literal UTF-8 text instead and every
 * major wallet accepts both — MetaMask decides by inspecting the value, so we
 * must too.
 *
 * ⚠ The failure this exists to prevent is SILENT. Handing viem
 * `{ raw: <plain text> }` does not throw: viem takes a string `raw` as hex
 * verbatim, derives the EIP-191 length prefix from the CHARACTER count, and
 * hashes a digest that has nothing to do with the message. The signature comes
 * back looking perfectly well-formed and recovers to an unrelated address —
 * which is what ChainLens reported as "EVM signature mismatch".
 */

/** True when `value` is a 0x-prefixed, even-length run of hex digits. */
export function isHexPayload(value: string): boolean {
  return /^0x([0-9a-fA-F]{2})*$/.test(value)
}

/**
 * The `message` argument for viem's `signMessage`, read the way MetaMask reads
 * params[0]: hex means "sign exactly these bytes", anything else is UTF-8 text.
 *
 * A plain string is returned as-is because that is viem's own UTF-8 form —
 * do NOT wrap it back into `{ raw }` at the call site.
 */
export function personalSignMessage(payload: string): { raw: `0x${string}` } | string {
  return isHexPayload(payload) ? { raw: payload as `0x${string}` } : payload
}

/**
 * The human-readable text behind params[0], for the approval prompt.
 *
 * Non-hex payloads are already text. Hex that does not decode to valid UTF-8
 * (a digest, a blob) is shown as the hex itself rather than replacement
 * characters — the user should see something faithful, not mojibake.
 */
export function personalSignPreview(payload: string): string {
  if (!isHexPayload(payload)) return payload
  const hex = payload.slice(2)
  const bytes = new Uint8Array((hex.match(/.{2}/g) ?? []).map(b => parseInt(b, 16)))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return payload
  }
}
