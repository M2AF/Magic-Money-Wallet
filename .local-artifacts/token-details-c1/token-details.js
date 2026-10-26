// src/shared/token-details.ts
function sourceOf(token) {
  return token.source ?? "eoa";
}
function ordinaryAddress(context) {
  switch (context.chainType) {
    case "evm":
      return context.addresses.evm || null;
    case "solana":
      return context.addresses.solana || null;
    case "cardano":
      return context.addresses.cardano || null;
    case "tron":
      return context.addresses.tron || null;
    default:
      return null;
  }
}
function tokenDetailsIdentity(token, context) {
  const source = sourceOf(token);
  return {
    accountIndex: context.accountIndex,
    accountAddress: context.accountAddress,
    mode: context.mode,
    chainId: token.chain,
    tokenIdentifier: token.contractAddress,
    source,
    sourceAddress: source === "agw" ? context.addresses.agw || null : source === "cip113" || token.programmable ? null : ordinaryAddress(context),
    deploymentId: token.programmable?.deploymentId ?? null
  };
}
function tokenDetailsKey(token, context) {
  const id = tokenDetailsIdentity(token, context);
  return JSON.stringify([
    id.accountAddress,
    id.accountIndex,
    id.mode,
    id.chainId,
    id.tokenIdentifier,
    id.source,
    id.sourceAddress,
    id.deploymentId,
    context.chainId,
    context.chainType,
    id.source === "agw" ? context.addresses.agwOwned === true : null
  ]);
}
function invalidContext(token, context) {
  if (!["mainnet", "testnet", "privacy"].includes(context.mode)) return "The wallet mode is unsupported.";
  if (token.source !== void 0 && !["eoa", "agw", "cip113"].includes(token.source)) return "The holding source is unsupported.";
  if (!context.accountAddress.trim() || !Number.isInteger(context.accountIndex) || context.accountIndex < 0 || context.accountIndex !== context.addresses.accountIndex) return "The active account has changed. Reopen token details.";
  if (token.chain !== context.chainId) return "The selected network does not match this token.";
  if (!token.contractAddress.trim()) return "The token identifier is unavailable.";
  const nonEvm = ["solana", "cardano", "tron", "bitcoin", "dogecoin", "polkadot", "monero", "zcash", "midnight"];
  if (nonEvm.includes(token.chain) && context.chainType !== token.chain) return "The network type does not match this token.";
  if (!nonEvm.includes(token.chain) && context.chainType !== "evm") return "The network type does not match this token.";
  return null;
}
var capability = (state, reason) => ({ state, reason });
async function resolveTokenReceive(token, context, validateAddress) {
  const identity = tokenDetailsIdentity(token, context);
  const base = { key: tokenDetailsKey(token, context), identity, address: null, qrPayload: null };
  const invalid = invalidContext(token, context);
  if (invalid) return { ...base, capability: capability("failed", invalid) };
  if (sourceOf(token) === "cip113" || token.programmable) {
    return { ...base, capability: capability("unsupported", "Receiving this programmable token needs a verified deployment-specific address.") };
  }
  if (sourceOf(token) === "agw" && (token.chain !== "abstract" || context.mode !== "mainnet" || context.addresses.agwOwned !== true)) {
    return { ...base, capability: capability("unsupported", "Receiving requires the owned Abstract smart account on mainnet.") };
  }
  if (!["evm", "solana", "cardano", "tron"].includes(context.chainType)) {
    return { ...base, capability: capability("unsupported", "This asset needs a dedicated receiving flow that is not supported yet.") };
  }
  const address = (sourceOf(token) === "agw" ? context.addresses.agw : ordinaryAddress(context))?.trim();
  if (!address) return { ...base, capability: capability("unknown", "The receive address is unavailable. Refresh the active account.") };
  const same = context.chainType === "evm" ? address.toLowerCase() === token.contractAddress.toLowerCase() : address === token.contractAddress;
  if (same) return { ...base, capability: capability("failed", "The receive address matches the token identifier. Check the account data.") };
  try {
    const validation = await validateAddress(context.chainId, address);
    if (validation?.valid !== true) return { ...base, capability: capability("failed", validation?.reason || "The receive address could not be validated.") };
  } catch {
    return { ...base, capability: capability("failed", "Could not check the receive address. Try again.") };
  }
  return { ...base, address, qrPayload: address, capability: capability("available", "Address only \u2014 select this token and network in the sending wallet.") };
}
function tokenDetailsCapabilities(token, context, input) {
  const activityScope = input.activityScope ?? "none";
  const result = {
    send: input.sendSupported ? capability("available", "") : capability("unsupported", "Sending this asset is not supported yet."),
    swap: input.swapSupported ? capability("available", "Route availability is checked on the Swap screen.") : capability("unsupported", "No supported swap flow is available for this holding."),
    receive: input.receive,
    activity: { ...capability(
      activityScope === "none" ? "unsupported" : "available",
      activityScope === "network" ? "Network activity \u2014 not filtered to this token." : activityScope === "token" ? "Token activity" : "Activity is unavailable for this asset."
    ), scope: activityScope }
  };
  const invalid = invalidContext(token, context);
  if (invalid) {
    result.send = result.swap = result.receive = capability("failed", invalid);
    result.activity = { ...capability("failed", invalid), scope: "none" };
    return result;
  }
  if (!/^\d+$/.test(token.rawBalance ?? "") || !/[1-9]/.test(token.rawBalance ?? "") || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimalsKnown === false) {
    result.send = capability("unsupported", "An exact balance and known token decimals are required to send.");
  }
  if (sourceOf(token) === "agw") {
    result.swap = capability("unsupported", "Swapping from this smart account is not supported yet.");
    if (token.chain !== "abstract" || context.mode !== "mainnet" || context.addresses.agwOwned !== true) {
      result.send = capability("unsupported", "The owned Abstract smart account is required to send.");
    }
  }
  if (sourceOf(token) === "cip113" || token.programmable) {
    const supplied = input.restrictions;
    const facts = supplied?.state === "ready" && (!token.programmable?.deploymentId || supplied.value.deploymentId !== token.programmable.deploymentId) ? void 0 : supplied;
    const state = facts?.state === "loading" ? "checking" : facts?.state === "error" ? "failed" : facts?.state !== "ready" ? "unknown" : facts.value.currentlyFrozen === true ? "restricted" : "unsupported";
    const reason = state === "restricted" ? "This holding is currently frozen." : state === "checking" ? "Checking programmable-token restrictions." : state === "failed" ? "Could not check programmable-token restrictions." : state === "unknown" ? "Programmable-token restrictions are unknown." : "Programmable-token execution is not supported yet.";
    result.send = result.swap = capability(state, reason);
    result.receive = capability("unsupported", "Receiving this programmable token needs a verified deployment-specific address.");
  }
  return result;
}
export {
  resolveTokenReceive,
  tokenDetailsCapabilities,
  tokenDetailsIdentity,
  tokenDetailsKey
};
