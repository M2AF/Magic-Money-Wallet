// src/shared/ape-theme-core.ts
var APE_CONTRACT = "0xF08Acc2f16Ddf2f5d047fcc4D39A6c528A9645af";
var APE_RPC = "https://ethereum-rpc.publicnode.com";
var address = (value) => /^0x[0-9a-f]{40}$/i.test(value);
var word = (value) => value.toString(16).padStart(64, "0");
function uint(value) {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) throw Error("Invalid ABI integer");
  return BigInt(value);
}
function decodeApeUri(value) {
  if (!/^0x(?:[0-9a-f]{2}){64,131072}$/i.test(value)) throw Error("Invalid ABI string");
  const bytes = Uint8Array.from(value.slice(2).match(/../g), (byte) => parseInt(byte, 16));
  const offset = Number(uint("0x" + value.slice(2, 66)));
  if (offset !== 32) throw Error("Invalid ABI offset");
  const length = Number(uint("0x" + value.slice(66, 130)));
  if (!Number.isSafeInteger(length) || length > 65536 || offset + 32 + length > bytes.length) throw Error("Invalid ABI length");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(offset + 32, offset + 32 + length));
}
function apeImageUrls(uri) {
  if (typeof uri !== "string" || uri.length > 4096) return [];
  const path = uri.replace(/^ipfs:\/\/(?:ipfs\/)?/i, "");
  if (/^ipfs:\/\//i.test(uri) && /^[a-z0-9]+(?:\/[^?#\s]*)?$/i.test(path) && !path.includes("..")) {
    return ["https://gateway.pinata.cloud/ipfs/", "https://dweb.link/ipfs/", "https://ipfs.io/ipfs/"].map((base) => base + path);
  }
  try {
    const url = new URL(uri);
    return url.protocol === "https:" && !url.username && !url.password ? [url.href] : [];
  } catch {
    return [];
  }
}
async function readOwnedApes(owners, signal, request = fetch) {
  const list = [...new Set(owners.map((owner) => owner.toLowerCase()))];
  if (!list.length || list.some((owner) => !address(owner))) throw Error("Invalid owner");
  let id = 0;
  const rpc = async (method, params) => {
    const callId = ++id;
    const res = await request(APE_RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: callId, method, params }), signal, cache: "no-store" });
    const data = res.ok ? await res.json() : null;
    if (!data || data.error || data.jsonrpc !== "2.0" || data.id !== callId || typeof data.result !== "string") throw Error("Ownership RPC unavailable");
    return data.result;
  };
  const chain = await rpc("eth_chainId", []);
  if (!/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 1n) throw Error("Wrong chain");
  const block = await rpc("eth_blockNumber", []);
  if (!/^0x[0-9a-f]+$/i.test(block)) throw Error("Invalid block");
  const checkedAt = Date.now();
  const call = (data) => rpc("eth_call", [{ to: APE_CONTRACT, data }, block]);
  const apes = [];
  let complete = true;
  for (const owner of list) {
    const balance = uint(await call("0x70a08231" + owner.slice(2).padStart(64, "0")));
    if (balance === 0n) continue;
    if (balance > 7000n) throw Error("Invalid collection balance");
    let params = { holder_address_hash: owner };
    const candidates = /* @__PURE__ */ new Set(), cursors = /* @__PURE__ */ new Set();
    for (let page = 0; page < 150; page++) {
      const url = `https://eth.blockscout.com/api/v2/tokens/${APE_CONTRACT}/instances?${new URLSearchParams(params)}`;
      const res = await request(url, { signal, cache: "no-store" });
      const data = res.ok ? await res.json() : null;
      if (!data || !Array.isArray(data.items)) throw Error("Ape discovery unavailable");
      for (const item of data.items) {
        if (/^\d{1,78}$/.test(String(item.id)) && BigInt(item.id) < 2n ** 256n) candidates.add(BigInt(item.id).toString());
      }
      if (!data.next_page_params) break;
      const next = { holder_address_hash: owner };
      for (const [key, value] of Object.entries(data.next_page_params)) if (typeof value === "string" || typeof value === "number") next[key] = String(value);
      next.holder_address_hash = owner;
      const cursor = JSON.stringify(next);
      if (cursors.has(cursor)) throw Error("Invalid discovery cursor");
      cursors.add(cursor);
      params = next;
      if (page === 149) throw Error("Discovery exceeds collection bounds");
    }
    let verified = 0n;
    for (const tokenId of candidates) {
      const ownedBy = await call("0x6352211e" + word(BigInt(tokenId)));
      uint(ownedBy);
      if (ownedBy.slice(2, 26) !== "0".repeat(24)) throw Error("Invalid ABI owner");
      if ("0x" + ownedBy.slice(-40).toLowerCase() !== owner) continue;
      verified++;
      const uri = decodeApeUri(await call("0xc87b56dd" + word(BigInt(tokenId))));
      let metadata;
      if (uri.startsWith("data:application/json;base64,")) {
        const raw = atob(uri.slice(29));
        if (raw.length > 65536) throw Error("Metadata exceeds bounds");
        metadata = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))));
      } else {
        const locations = apeImageUrls(uri);
        if (!locations.length) throw Error("Unsupported metadata URI");
        const res = await request(locations[0], { signal, cache: "no-store" });
        if (!res.ok) throw Error("Metadata unavailable");
        const text = await res.text();
        if (text.length > 65536) throw Error("Metadata exceeds bounds");
        metadata = JSON.parse(text);
      }
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw Error("Invalid metadata");
      apes.push({ id: tokenId, owner, name: typeof metadata.name === "string" ? metadata.name.slice(0, 100) : `Ape #${tokenId}`, images: apeImageUrls(metadata.image) });
    }
    if (verified !== balance) complete = false;
    if (balance > 0n && verified === 0n) throw Error("Owned apes not indexed yet");
  }
  return { apes, checkedAt, complete };
}
export {
  APE_CONTRACT,
  APE_RPC,
  apeImageUrls,
  decodeApeUri,
  readOwnedApes
};
