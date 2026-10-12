var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/shared/collection-theme-access.ts
var collection_theme_access_exports = {};
__export(collection_theme_access_exports, {
  COLLECTION_GATES: () => COLLECTION_GATES,
  createCollectionAccess: () => createCollectionAccess,
  isCollectionTheme: () => isCollectionTheme,
  readCollectionOwnership: () => readCollectionOwnership,
  validThemeOwner: () => validThemeOwner
});
module.exports = __toCommonJS(collection_theme_access_exports);
var COLLECTION_GATES = {
  "mallard-order": { chain: "cardano", contract: "901ba6e9831b078e131a1cc403d6139af21bda255cea6c9f770f4834", requirement: "Mallard Order holders \xB7 Cardano" },
  sealuminati: { chain: "evm", contract: "0xaEAA920165fD7ce58a0E0772Ffc97F06626572cD", requirement: "Sealuminati holders \xB7 Monad" },
  r3tards: { chain: "evm", contract: "0x200723A706de0013316E5cd8EBa2b3f53DD90c29", requirement: "r3tards holders \xB7 Monad" },
  emonad: { chain: "evm", contract: "0x81A224F8A62f52BdE942dBF23A56df77A10b7777", requirement: "10,000 EMONAD minimum \xB7 Monad" }
};
var isCollectionTheme = (id) => Object.prototype.hasOwnProperty.call(COLLECTION_GATES, id);
var IDS = Object.keys(COLLECTION_GATES);
var FRESH_MS = 9e4;
var inactive = () => ({ status: "locked", checking: false, checkedAt: 0 });
var validThemeOwner = (owner) => owner.chain === "evm" ? /^0x[0-9a-f]{40}$/i.test(owner.address) : /^addr1[023456789acdefghjklmnpqrstuvwxyz]{50,120}$/.test(owner.address);
var normalize = (owners) => [...new Map(owners.filter(validThemeOwner).map((o) => {
  const owner = { ...o, address: o.address.toLowerCase() };
  return [`${owner.chain}:${owner.address}`, owner];
})).values()].sort((a, b) => `${a.chain}:${a.address}`.localeCompare(`${b.chain}:${b.address}`));
async function readCollectionOwnership(id, owners, signal, request = fetch, cardanoBase = "https://www.chainlensnft.info") {
  const gate = COLLECTION_GATES[id];
  const addresses = normalize(owners).filter((o) => o.chain === gate.chain).map((o) => o.address);
  if (!addresses.length) return false;
  if (id === "mallard-order") {
    for (const address of addresses) {
      const response = await request(`${cardanoBase}/api/theme-holder/mallard?address=${encodeURIComponent(address)}`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("Cardano ownership unavailable");
      const result = await response.json();
      if (result.address !== address || result.policy !== gate.contract || typeof result.quantity !== "string" || !/^\d+$/.test(result.quantity)) throw new Error("Invalid policy proof");
      if (BigInt(result.quantity) > 0n) return true;
    }
    return false;
  }
  let counter = 0;
  const rpc = async (method, params) => {
    const requestId = ++counter;
    const response = await request("https://rpc.monad.xyz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }), signal, cache: "no-store" });
    if (!response.ok) throw new Error("Monad unavailable");
    const data = await response.json();
    if (data.id !== requestId || data.jsonrpc !== "2.0" || data.error || typeof data.result !== "string") throw new Error("Invalid RPC response");
    return data.result;
  };
  const chain = await rpc("eth_chainId", []);
  if (!/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 143n) throw new Error("Wrong chain");
  const block = await rpc("eth_blockNumber", []);
  if (!/^0x[0-9a-f]+$/i.test(block)) throw new Error("Invalid block");
  const call = async (data) => {
    const result = await rpc("eth_call", [{ to: gate.contract, data }, block]);
    if (!/^0x[0-9a-f]{64}$/i.test(result)) throw new Error("Invalid contract response");
    return BigInt(result);
  };
  if (id !== "emonad" && await call("0x01ffc9a780ac58cd" + "0".repeat(56)) !== 1n) throw new Error("Not ERC-721");
  if (id === "emonad" && await call("0x313ce567") !== 18n) throw new Error("Unexpected EMONAD decimals");
  const minimum = id === "emonad" ? 10000n * 10n ** 18n : 1n;
  for (const owner of addresses) if (await call("0x70a08231" + owner.slice(2).padStart(64, "0")) >= minimum) return true;
  return false;
}
function createCollectionAccess(options) {
  let owners = [], generation = 0;
  const states = Object.fromEntries(IDS.map((id) => [id, inactive()]));
  const pending = /* @__PURE__ */ new Map();
  const get = (id) => isCollectionTheme(id) ? states[id] : inactive();
  const allowed = (id) => !isCollectionTheme(id) || states[id].status === "owned" && Date.now() - states[id].checkedAt < FRESH_MS;
  const publish = (id, next) => {
    states[id] = next;
    options.changed();
  };
  function bind(next) {
    const normalized = normalize(next);
    if (JSON.stringify(normalized) === JSON.stringify(owners)) return;
    ++generation;
    for (const job of pending.values()) job.controller.abort();
    pending.clear();
    owners = normalized;
    for (const id of IDS) states[id] = inactive();
    options.changed();
    for (const id of IDS) if (owners.some((o) => o.chain === COLLECTION_GATES[id].chain)) void refresh(id);
  }
  function refresh(id) {
    if (pending.has(id)) return pending.get(id).promise;
    if (!owners.some((o) => o.chain === COLLECTION_GATES[id].chain)) return Promise.resolve();
    const epoch = generation, expected = owners.slice(), controller = new AbortController();
    let expired = false;
    publish(id, { ...states[id], status: allowed(id) ? "owned" : "checking", checking: true });
    const timer2 = setTimeout(() => {
      expired = true;
      controller.abort();
      if (epoch === generation) {
        pending.delete(id);
        publish(id, { ...inactive(), status: "error" });
      }
    }, 15e3);
    const promise = (async () => {
      try {
        const owned = await readCollectionOwnership(id, expected, controller.signal, options.request, options.cardanoBase);
        if (epoch !== generation || expired) return;
        if (options.currentOwners) {
          const current = normalize(await options.currentOwners());
          if (epoch !== generation || expired) return;
          if (JSON.stringify(current) !== JSON.stringify(expected)) {
            bind(current);
            return;
          }
        }
        publish(id, { status: owned ? "owned" : "locked", checking: false, checkedAt: Date.now() });
      } catch {
        if (epoch === generation && !expired) publish(id, { ...inactive(), status: "error" });
      } finally {
        clearTimeout(timer2);
        if (epoch === generation && !expired) pending.delete(id);
      }
    })();
    pending.set(id, { controller, promise });
    return promise;
  }
  const tick = () => {
    if (document.hidden) return;
    for (const id of IDS) {
      if (states[id].status === "owned" && !allowed(id)) options.changed();
      if (document.documentElement.getAttribute("data-theme") === id || document.documentElement.getAttribute("data-cl-art-theme") === id) void refresh(id);
    }
  };
  const timer = setInterval(tick, 3e4);
  const focus = () => {
    if (document.hidden) return;
    for (const id of IDS) {
      if (!allowed(id)) options.changed();
      void refresh(id);
    }
  };
  window.addEventListener("focus", focus);
  document.addEventListener("visibilitychange", focus);
  return { get, allowed, bind, refresh, dispose: () => {
    ++generation;
    for (const job of pending.values()) job.controller.abort();
    pending.clear();
    clearInterval(timer);
    window.removeEventListener("focus", focus);
    document.removeEventListener("visibilitychange", focus);
  } };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COLLECTION_GATES,
  createCollectionAccess,
  isCollectionTheme,
  readCollectionOwnership,
  validThemeOwner
});
