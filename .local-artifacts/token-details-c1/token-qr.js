// src/shared/token-qr.ts
async function parseTokenQr(input, context, validateAddress) {
  const key = context.key;
  const chainId = context.chainId;
  const fail = (code, reason) => ({ ok: false, key, code, reason });
  if (typeof input !== "string" || !input.trim()) return fail("empty", "No address was scanned.");
  if (input.length > 2048 || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/.test(input)) {
    return fail("malformed", "The scanned code contains invalid or oversized address data.");
  }
  const address = input.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(address) || /[/?#=&%]/.test(address)) {
    return fail("unsupported-format", "Payment links and transaction requests are not supported here. Scan or paste an address only.");
  }
  if (/\s/.test(address) || !key || !chainId) return fail("malformed", "The scanned code is not a plain recipient address.");
  try {
    const result = await validateAddress(chainId, address);
    if (result?.valid !== true) return fail("invalid-address", result?.reason || "This address is not valid for the selected network.");
  } catch {
    return fail("validation-failed", "Could not validate the scanned address. Try again or paste the address.");
  }
  return {
    ok: true,
    key,
    address,
    format: "address",
    notice: "Address only \u2014 confirm the selected token and network before sending."
  };
}
export {
  parseTokenQr
};
