const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./native-DVo4siv2.js","../background.js"])))=>i.map(i=>d[i]);
import { L as LruMap, g as getTransactionCount, p as parseAbiParameter$1, m as modifiers, a as parseStructs, i as isStructSignature, I as InvalidAbiParameterError, b as getAction, r as readContract, s as simulateContract, c as createContractEventFilter, d as getContractEvents, w as watchContractEvent, e as writeContract, f as estimateContractGas, A as AbiEncodingLengthMismatchError, h as concatHex, j as isAddress, k as InvalidAddressError, l as pad, n as stringToHex, o as boolToHex, q as integerRegex, t as numberToHex, u as bytesRegex, B as BytesSizeMismatchError, v as arrayRegex, U as UnsupportedPackedAbiType, x as toBytes, y as getAddress, z as keccak256, C as slice, D as concat, E as toRlp, F as localBatchGatewayUrl, G as decodeFunctionResult, H as encodeFunctionData, J as decodeErrorResult, K as batchGatewayAbi, M as solidityError, N as HttpRequestError, O as InvalidHexValueError, P as hexToBytes, Q as createCursor, R as bytesToHex, S as BaseError, T as isHex, V as size, W as ripemd160$1, X as toHex, Y as createBatchScheduler, Z as withTimeout, _ as TimeoutError, $ as idCache, a0 as SocketClosedError, a1 as __vitePreload, a2 as WebSocketRequestError, a3 as sliceHex, a4 as validate, a5 as decodeAbiParameters, a6 as unwrap, a7 as recoverAddress, a8 as hashMessage, a9 as hashTypedData, aa as encodeAbiParameters, ab as wrap, ac as isAddressEqual, ad as hexToNumber, ae as InvalidSerializedTransactionTypeError, af as InvalidSerializedTransactionError, ag as hexToBigInt, ah as assertTransactionEIP1559, ai as assertTransactionEIP2930, aj as toBlobSidecars, ak as assertTransactionEIP4844, al as assertTransactionEIP7702, am as assertTransactionLegacy, an as InvalidLegacyVError, ao as trim, ap as padHex, aq as parseUnits, ar as gweiUnits, as as extract, at as formatTransactionRequest, au as createClient, av as createTransport, aw as TransactionRejectedRpcError, ax as UserRejectedRequestError, ay as WalletConnectSessionSettlementError, az as ExecutionRevertedError, aA as wait, aB as UrlRequiredError, aC as RpcRequestError, aD as AbiConstructorNotFoundError, aE as AbiConstructorParamsNotFoundError, aF as commitmentToVersionedHash, aG as EnsInvalidChainIdError, aH as secp256k1, aI as serializeTransaction, aJ as parseEther, aK as createWalletClient, aL as http } from "../background.js";
import { aM, aN, aO, aP, aQ, aR, aS, aT, aU, aV, aW, aX, aY, aZ, a_, a$, b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, ba, bb, bc, bd, be, bf, bg, bh, bi, bj, bk, bl, bm, bn, bo, bp, bq, br, bs, bt, bu, bv, bw, bx, by, bz, bA, bB, bC, bD, bE, bF, bG, bH, bI, bJ, bK, bL, bM, bN, bO, bP, bQ, bR, bS, bT, bU, bV, bW, bX, bY, bZ, b_, b$, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, ca, cb, cc, cd, ce, cf, cg, ch, ci, cj, ck, cl, cm, cn, co, cp, cq, cr, cs, ct, cu, cv, cw, cx, cy, cz, cA, cB, cC, cD, cE, cF, cG, cH, cI, cJ, cK, cL, cM, cN, cO, cP, cQ, cR, cS, cT, cU, cV, cW, cX, cY, cZ, c_, c$, d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, da, db, dc, dd, de, df, dg, dh, di, dj, di as di2, dk, dl, dm, dn, dp, dq, dr, ds, dt, du, dv, dw, dx, dy, dz, dA, dB, dC, dD, dE, dF, dG, dH, dI, dJ, dK, dL, dM, dN, dO, dP, dQ, dR, dS, dT, dU, dV, dW, dX, dY, dZ, d_, d$, e0, e1, e2, e3, e4, e5, e6, e7, e8, e9, ea, eb, ec, ed, ee, ef, eg, eh, ei, ej, ek, el, em, en, eo, ep, eq, er, es, et, eu, ev, ew, ex, ey, ez, eA, eB, eC, eD, eE, eF, eG, eH, eI, eJ, eK, eL, eM, eN, eO, eP, eQ, eR, eS, eT, eU, eV, eW, eX, eY, eZ, e_, e$, f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, fa, fb, fc, fd, fe, ff, fc as fc2, fg, fh, fi, fj, fk, dh as dh2, di as di3, fk as fk2, dj as dj2, di as di4, fl, fm, c$ as c$2, d0 as d02, fn, fo, fp, fq, fr, fs } from "../background.js";
import { ccipRequest } from "./ccip-DqswiKlF.js";
import { offchainLookup, offchainLookupAbiItem, offchainLookupSignature } from "./ccip-DqswiKlF.js";
function createNonceManager(parameters) {
  const { source } = parameters;
  const deltaMap = /* @__PURE__ */ new Map();
  const nonceMap = new LruMap(8192);
  const promiseMap = /* @__PURE__ */ new Map();
  const getKey = ({ address, chainId }) => `${address}.${chainId}`;
  const resetCache = (key) => {
    deltaMap.delete(key);
    promiseMap.delete(key);
  };
  return {
    async consume({ address, chainId, client }) {
      const key = getKey({ address, chainId });
      const promise = this.get({ address, chainId, client });
      this.increment({ address, chainId });
      const nonce = await promise;
      await source.set({ address, chainId }, nonce);
      nonceMap.set(key, nonce);
      return nonce;
    },
    async increment({ address, chainId }) {
      const key = getKey({ address, chainId });
      const delta = deltaMap.get(key) ?? 0;
      deltaMap.set(key, delta + 1);
    },
    async get({ address, chainId, client }) {
      const key = getKey({ address, chainId });
      let promise = promiseMap.get(key);
      if (!promise) {
        promise = (async () => {
          try {
            const nonce = await source.get({ address, chainId, client });
            const previousNonce = nonceMap.get(key) ?? 0;
            if (previousNonce > 0 && nonce <= previousNonce)
              return previousNonce + 1;
            nonceMap.delete(key);
            return nonce;
          } finally {
            resetCache(key);
          }
        })();
        promiseMap.set(key, promise);
      }
      const delta = deltaMap.get(key) ?? 0;
      return delta + await promise;
    },
    reset({ address, chainId }) {
      const key = getKey({ address, chainId });
      nonceMap.delete(key);
      resetCache(key);
    }
  };
}
function jsonRpc() {
  return {
    async get(parameters) {
      const { address, client } = parameters;
      return getTransactionCount(client, {
        address,
        blockTag: "pending"
      });
    },
    set() {
    }
  };
}
const nonceManager = /* @__PURE__ */ createNonceManager({
  source: jsonRpc()
});
function parseAbiParameter(param) {
  let abiParameter;
  if (typeof param === "string")
    abiParameter = parseAbiParameter$1(param, {
      modifiers
    });
  else {
    const structs = parseStructs(param);
    const length = param.length;
    for (let i = 0; i < length; i++) {
      const signature = param[i];
      if (isStructSignature(signature))
        continue;
      abiParameter = parseAbiParameter$1(signature, { modifiers, structs });
      break;
    }
  }
  if (!abiParameter)
    throw new InvalidAbiParameterError({ param });
  return abiParameter;
}
function getContract({ abi, address, client: client_ }) {
  const client = client_;
  const [publicClient, walletClient] = (() => {
    if (!client)
      return [void 0, void 0];
    if ("public" in client && "wallet" in client)
      return [client.public, client.wallet];
    if ("public" in client)
      return [client.public, void 0];
    if ("wallet" in client)
      return [void 0, client.wallet];
    return [client, client];
  })();
  const hasPublicClient = publicClient !== void 0 && publicClient !== null;
  const hasWalletClient = walletClient !== void 0 && walletClient !== null;
  const contract = {};
  let hasReadFunction = false;
  let hasWriteFunction = false;
  let hasEvent = false;
  for (const item of abi) {
    if (item.type === "function")
      if (item.stateMutability === "view" || item.stateMutability === "pure")
        hasReadFunction = true;
      else
        hasWriteFunction = true;
    else if (item.type === "event")
      hasEvent = true;
    if (hasReadFunction && hasWriteFunction && hasEvent)
      break;
  }
  if (hasPublicClient) {
    if (hasReadFunction)
      contract.read = new Proxy({}, {
        get(_, functionName) {
          return (...parameters) => {
            const { args, options } = getFunctionParameters(parameters);
            return getAction(publicClient, readContract, "readContract")({
              abi,
              address,
              functionName,
              args,
              ...options
            });
          };
        }
      });
    if (hasWriteFunction)
      contract.simulate = new Proxy({}, {
        get(_, functionName) {
          return (...parameters) => {
            const { args, options } = getFunctionParameters(parameters);
            return getAction(publicClient, simulateContract, "simulateContract")({
              abi,
              address,
              functionName,
              args,
              ...options
            });
          };
        }
      });
    if (hasEvent) {
      contract.createEventFilter = new Proxy({}, {
        get(_, eventName) {
          return (...parameters) => {
            const abiEvent = abi.find((x) => x.type === "event" && x.name === eventName);
            const { args, options } = getEventParameters(parameters, abiEvent);
            return getAction(publicClient, createContractEventFilter, "createContractEventFilter")({
              abi,
              address,
              eventName,
              args,
              ...options
            });
          };
        }
      });
      contract.getEvents = new Proxy({}, {
        get(_, eventName) {
          return (...parameters) => {
            const abiEvent = abi.find((x) => x.type === "event" && x.name === eventName);
            const { args, options } = getEventParameters(parameters, abiEvent);
            return getAction(publicClient, getContractEvents, "getContractEvents")({
              abi,
              address,
              eventName,
              args,
              ...options
            });
          };
        }
      });
      contract.watchEvent = new Proxy({}, {
        get(_, eventName) {
          return (...parameters) => {
            const abiEvent = abi.find((x) => x.type === "event" && x.name === eventName);
            const { args, options } = getEventParameters(parameters, abiEvent);
            return getAction(publicClient, watchContractEvent, "watchContractEvent")({
              abi,
              address,
              eventName,
              args,
              ...options
            });
          };
        }
      });
    }
  }
  if (hasWalletClient) {
    if (hasWriteFunction)
      contract.write = new Proxy({}, {
        get(_, functionName) {
          return (...parameters) => {
            const { args, options } = getFunctionParameters(parameters);
            return getAction(walletClient, writeContract, "writeContract")({
              abi,
              address,
              functionName,
              args,
              ...options
            });
          };
        }
      });
  }
  if (hasPublicClient || hasWalletClient) {
    if (hasWriteFunction)
      contract.estimateGas = new Proxy({}, {
        get(_, functionName) {
          return (...parameters) => {
            const { args, options } = getFunctionParameters(parameters);
            const client2 = publicClient ?? walletClient;
            return getAction(client2, estimateContractGas, "estimateContractGas")({
              abi,
              address,
              functionName,
              args,
              ...options,
              account: options.account ?? walletClient.account
            });
          };
        }
      });
  }
  contract.address = address;
  contract.abi = abi;
  return contract;
}
function getFunctionParameters(values) {
  const hasArgs = values.length && Array.isArray(values[0]);
  const args = hasArgs ? values[0] : [];
  const options = (hasArgs ? values[1] : values[0]) ?? {};
  return { args, options };
}
function getEventParameters(values, abiEvent) {
  let hasArgs = false;
  if (Array.isArray(values[0]))
    hasArgs = true;
  else if (values.length === 1) {
    hasArgs = abiEvent.inputs.some((x) => x.indexed);
  } else if (values.length === 2) {
    hasArgs = true;
  }
  const args = hasArgs ? values[0] : void 0;
  const options = (hasArgs ? values[1] : values[0]) ?? {};
  return { args, options };
}
function encodePacked(types, values) {
  if (types.length !== values.length)
    throw new AbiEncodingLengthMismatchError({
      expectedLength: types.length,
      givenLength: values.length
    });
  const data = [];
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    const value = values[i];
    data.push(encode(type, value));
  }
  return concatHex(data);
}
function encode(type, value, isArray = false) {
  if (type === "address") {
    const address = value;
    if (!isAddress(address))
      throw new InvalidAddressError({ address });
    return pad(address.toLowerCase(), {
      size: isArray ? 32 : null
    });
  }
  if (type === "string")
    return stringToHex(value);
  if (type === "bytes")
    return value;
  if (type === "bool")
    return pad(boolToHex(value), { size: isArray ? 32 : 1 });
  const intMatch = type.match(integerRegex);
  if (intMatch) {
    const [_type, baseType, bits = "256"] = intMatch;
    const size2 = Number.parseInt(bits, 10) / 8;
    return numberToHex(value, {
      size: isArray ? 32 : size2,
      signed: baseType === "int"
    });
  }
  const bytesMatch = type.match(bytesRegex);
  if (bytesMatch) {
    const [_type, size2] = bytesMatch;
    if (Number.parseInt(size2, 10) !== (value.length - 2) / 2)
      throw new BytesSizeMismatchError({
        expectedSize: Number.parseInt(size2, 10),
        givenSize: (value.length - 2) / 2
      });
    return pad(value, { dir: "right", size: isArray ? 32 : null });
  }
  const arrayMatch = type.match(arrayRegex);
  if (arrayMatch && Array.isArray(value)) {
    const [_type, childType] = arrayMatch;
    const data = [];
    for (let i = 0; i < value.length; i++) {
      data.push(encode(childType, value[i], true));
    }
    if (data.length === 0)
      return "0x";
    return concatHex(data);
  }
  throw new UnsupportedPackedAbiType(type);
}
function isBytes(value) {
  if (!value)
    return false;
  if (typeof value !== "object")
    return false;
  if (!("BYTES_PER_ELEMENT" in value))
    return false;
  return value.BYTES_PER_ELEMENT === 1 && value.constructor.name === "Uint8Array";
}
function getContractAddress(opts) {
  if (opts.opcode === "CREATE2")
    return getCreate2Address(opts);
  return getCreateAddress(opts);
}
function getCreateAddress(opts) {
  const from = toBytes(getAddress(opts.from));
  let nonce = toBytes(opts.nonce);
  if (nonce[0] === 0)
    nonce = new Uint8Array([]);
  return getAddress(`0x${keccak256(toRlp([from, nonce], "bytes")).slice(26)}`);
}
function getCreate2Address(opts) {
  const from = toBytes(getAddress(opts.from));
  const salt = pad(isBytes(opts.salt) ? opts.salt : toBytes(opts.salt), {
    size: 32
  });
  const bytecodeHash = (() => {
    if ("bytecodeHash" in opts) {
      if (isBytes(opts.bytecodeHash))
        return opts.bytecodeHash;
      return toBytes(opts.bytecodeHash);
    }
    return keccak256(opts.bytecode, "bytes");
  })();
  return getAddress(slice(keccak256(concat([toBytes("0xff"), from, salt, bytecodeHash])), 12));
}
function ccipReadTunnel({ batchGateways, ccipRequest: ccipRequest$1 = ccipRequest }) {
  return {
    async request({ data, sender, urls }) {
      if (urls.includes(localBatchGatewayUrl)) {
        return ccipRequest$1({
          data,
          sender,
          urls: batchGateways
        });
      } else {
        const [failures, responses] = decodeFunctionResult({
          abi: batchGatewayAbi,
          functionName: "query",
          data: await ccipRequest$1({
            data: encodeFunctionData({
              abi: batchGatewayAbi,
              functionName: "query",
              args: [[{ sender, data, urls }]]
            }),
            sender,
            urls: batchGateways
          })
        });
        if (failures[0]) {
          let error;
          try {
            const res = decodeErrorResult({
              abi: [...batchGatewayAbi, solidityError],
              data: responses[0]
            });
            if (res.errorName === "HttpError") {
              error = new HttpRequestError({
                body: { message: res.args[1] },
                status: res.args[0],
                url: urls.join(" | ")
              });
            } else {
              const message = res.args[0];
              if (message) {
                error = new Error(message);
              }
            }
          } catch {
          }
          throw error ?? new Error("An unknown error occurred.");
        }
        return responses[0];
      }
    }
  };
}
function extractChain({ chains, id }) {
  return chains.find((chain) => chain.id === id);
}
function fromRlp(value, to = "hex") {
  const bytes = (() => {
    if (typeof value === "string") {
      if (value.length > 3 && value.length % 2 !== 0)
        throw new InvalidHexValueError(value);
      return hexToBytes(value);
    }
    return value;
  })();
  const cursor = createCursor(bytes, {
    recursiveReadLimit: Number.POSITIVE_INFINITY
  });
  const result = fromRlpCursor(cursor, to);
  return result;
}
function fromRlpCursor(cursor, to = "hex") {
  if (cursor.bytes.length === 0)
    return to === "hex" ? bytesToHex(cursor.bytes) : cursor.bytes;
  const prefix = cursor.readByte();
  if (prefix < 128)
    cursor.decrementPosition(1);
  if (prefix < 192) {
    const length2 = readLength(cursor, prefix, 128);
    const bytes = cursor.readBytes(length2);
    return to === "hex" ? bytesToHex(bytes) : bytes;
  }
  const length = readLength(cursor, prefix, 192);
  return readList(cursor, length, to);
}
function readLength(cursor, prefix, offset) {
  if (offset === 128 && prefix < 128)
    return 1;
  if (prefix <= offset + 55)
    return prefix - offset;
  if (prefix === offset + 55 + 1)
    return cursor.readUint8();
  if (prefix === offset + 55 + 2)
    return cursor.readUint16();
  if (prefix === offset + 55 + 3)
    return cursor.readUint24();
  if (prefix === offset + 55 + 4)
    return cursor.readUint32();
  throw new BaseError("Invalid RLP prefix");
}
function readList(cursor, length, to) {
  const position = cursor.position;
  const value = [];
  while (cursor.position - position < length)
    value.push(fromRlpCursor(cursor, to));
  return value;
}
function isHash(hash) {
  return isHex(hash) && size(hash) === 32;
}
function ripemd160(value, to_) {
  const to = to_ || "hex";
  const bytes = ripemd160$1(isHex(value, { strict: false }) ? toBytes(value) : value);
  if (to === "bytes")
    return bytes;
  return toHex(bytes);
}
const socketClientCache = /* @__PURE__ */ new Map();
async function getSocketRpcClient(parameters) {
  const { getSocket: getSocket2, keepAlive = true, key = "socket", reconnect = true, url } = parameters;
  const { interval: keepAliveInterval = 3e4 } = typeof keepAlive === "object" ? keepAlive : {};
  const { attempts = 5, delay = 2e3 } = typeof reconnect === "object" ? reconnect : {};
  const id = JSON.stringify({ keepAlive, key, url, reconnect });
  let socketClient = socketClientCache.get(id);
  if (socketClient)
    return socketClient;
  let reconnectCount = 0;
  const { schedule } = createBatchScheduler({
    id,
    fn: async () => {
      const requests = /* @__PURE__ */ new Map();
      const subscriptions = /* @__PURE__ */ new Map();
      let error;
      let socket;
      let keepAliveTimer;
      let reconnectTimer;
      let reconnectInProgress = false;
      let intentionallyClosed = false;
      function attemptReconnect() {
        if (reconnect && !intentionallyClosed && reconnectCount < attempts) {
          if (reconnectInProgress)
            return;
          reconnectInProgress = true;
          reconnectCount++;
          socket == null ? void 0 : socket.close();
          reconnectTimer = setTimeout(async () => {
            reconnectTimer = void 0;
            if (intentionallyClosed) {
              reconnectInProgress = false;
              return;
            }
            await setup().catch(console.error);
            reconnectInProgress = false;
          }, delay);
        } else {
          requests.clear();
          subscriptions.clear();
        }
      }
      async function setup() {
        const result = await getSocket2({
          onClose() {
            var _a, _b;
            for (const request of requests.values())
              (_a = request.onError) == null ? void 0 : _a.call(request, new SocketClosedError({ url }));
            for (const subscription of subscriptions.values())
              (_b = subscription.onError) == null ? void 0 : _b.call(subscription, new SocketClosedError({ url }));
            attemptReconnect();
          },
          onError(error_) {
            var _a, _b;
            error = error_;
            for (const request of requests.values())
              (_a = request.onError) == null ? void 0 : _a.call(request, error);
            for (const subscription of subscriptions.values())
              (_b = subscription.onError) == null ? void 0 : _b.call(subscription, error);
            attemptReconnect();
          },
          onOpen() {
            error = void 0;
            reconnectCount = 0;
          },
          onResponse(data) {
            const isSubscription = data.method === "eth_subscription";
            const id2 = isSubscription ? data.params.subscription : data.id;
            const cache = isSubscription ? subscriptions : requests;
            const callback = cache.get(id2);
            if (callback)
              callback.onResponse(data);
            if (!isSubscription)
              cache.delete(id2);
          }
        });
        if (intentionallyClosed) {
          result.close();
          return result;
        }
        socket = result;
        if (keepAlive) {
          if (keepAliveTimer)
            clearInterval(keepAliveTimer);
          keepAliveTimer = setInterval(() => {
            var _a;
            return (_a = socket.ping) == null ? void 0 : _a.call(socket);
          }, keepAliveInterval);
        }
        if (reconnect && subscriptions.size > 0) {
          const subscriptionEntries = subscriptions.entries();
          for (const [key2, { onResponse, body, onError }] of subscriptionEntries) {
            if (!body)
              continue;
            subscriptions.delete(key2);
            socketClient == null ? void 0 : socketClient.request({ body, onResponse, onError });
          }
        }
        return result;
      }
      await setup();
      error = void 0;
      socketClient = {
        close() {
          intentionallyClosed = true;
          keepAliveTimer && clearInterval(keepAliveTimer);
          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = void 0;
            reconnectInProgress = false;
          }
          socket.close();
          socketClientCache.delete(id);
        },
        get socket() {
          return socket;
        },
        request({ body, onError, onResponse }) {
          var _a;
          if (error && onError)
            onError(error);
          const id2 = body.id ?? idCache.take();
          const callback = (response) => {
            if (typeof response.id === "number" && id2 !== response.id)
              return;
            if (body.method === "eth_subscribe" && typeof response.result === "string")
              subscriptions.set(response.result, {
                onResponse: callback,
                onError,
                body
              });
            onResponse(response);
          };
          if (body.method === "eth_unsubscribe")
            subscriptions.delete((_a = body.params) == null ? void 0 : _a[0]);
          requests.set(id2, { onResponse: callback, onError });
          try {
            socket.request({
              body: {
                jsonrpc: "2.0",
                id: id2,
                ...body
              }
            });
          } catch (error2) {
            onError == null ? void 0 : onError(error2);
          }
        },
        requestAsync({ body, timeout = 1e4 }) {
          return withTimeout(() => new Promise((onResponse, onError) => this.request({
            body,
            onError,
            onResponse
          })), {
            errorInstance: new TimeoutError({ body, url }),
            timeout
          });
        },
        requests,
        subscriptions,
        url
      };
      socketClientCache.set(id, socketClient);
      return [socketClient];
    }
  });
  const [_, [socketClient_]] = await schedule();
  return socketClient_;
}
async function getWebSocketRpcClient(url, options = {}) {
  const { keepAlive, reconnect } = options;
  return getSocketRpcClient({
    async getSocket({ onClose, onError, onOpen, onResponse }) {
      const WebSocket = await __vitePreload(() => import("./native-DVo4siv2.js"), true ? __vite__mapDeps([0,1]) : void 0, import.meta.url).then((module) => module.WebSocket);
      const socket = new WebSocket(url);
      function onClose_() {
        socket.removeEventListener("close", onClose_);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("open", onOpen);
        onClose();
      }
      function onMessage({ data }) {
        if (typeof data === "string" && data.trim().length === 0)
          return;
        try {
          const _data = JSON.parse(data);
          onResponse(_data);
        } catch (error) {
          onError(error);
        }
      }
      socket.addEventListener("close", onClose_);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", onError);
      socket.addEventListener("open", onOpen);
      if (socket.readyState === WebSocket.CONNECTING) {
        await new Promise((resolve, reject) => {
          if (!socket)
            return;
          socket.onopen = resolve;
          socket.onerror = reject;
        });
      }
      const { close: close_ } = socket;
      return Object.assign(socket, {
        close() {
          close_.bind(socket)();
          onClose_();
        },
        ping() {
          try {
            if (socket.readyState === socket.CLOSED || socket.readyState === socket.CLOSING)
              throw new WebSocketRequestError({
                url: socket.url,
                cause: new SocketClosedError({ url: socket.url })
              });
            const body = {
              jsonrpc: "2.0",
              id: null,
              method: "net_version",
              params: []
            };
            socket.send(JSON.stringify(body));
          } catch (error) {
            onError(error);
          }
        },
        request({ body }) {
          if (socket.readyState === socket.CLOSED || socket.readyState === socket.CLOSING)
            throw new WebSocketRequestError({
              body,
              url: socket.url,
              cause: new SocketClosedError({ url: socket.url })
            });
          return socket.send(JSON.stringify(body));
        }
      });
    },
    keepAlive,
    reconnect,
    url
  });
}
async function getSocket(url) {
  const client = await getWebSocketRpcClient(url);
  return Object.assign(client.socket, {
    requests: client.requests,
    subscriptions: client.subscriptions
  });
}
const erc6492MagicBytes = "0x6492649264926492649264926492649264926492649264926492649264926492";
const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
function isErc6492Signature(signature) {
  return sliceHex(signature, -32) === erc6492MagicBytes;
}
function isErc8010Signature(signature) {
  return validate(signature);
}
function parseErc6492Signature(signature) {
  if (!isErc6492Signature(signature))
    return { signature };
  const [address, data, signature_] = decodeAbiParameters([{ type: "address" }, { type: "bytes" }, { type: "bytes" }], signature);
  return { address, data, signature: signature_ };
}
function parseErc8010Signature(signature) {
  if (!isErc8010Signature(signature))
    return { signature };
  const { authorization: authorization_ox, to, ...rest } = unwrap(signature);
  return {
    authorization: {
      address: authorization_ox.address,
      chainId: authorization_ox.chainId,
      nonce: Number(authorization_ox.nonce),
      r: numberToHex(authorization_ox.r, { size: 32 }),
      s: numberToHex(authorization_ox.s, { size: 32 }),
      yParity: authorization_ox.yParity
    },
    ...to ? { address: to } : {},
    ...rest
  };
}
async function recoverMessageAddress({ message, signature }) {
  return recoverAddress({ hash: hashMessage(message), signature });
}
async function recoverTypedDataAddress(parameters) {
  const { domain, message, primaryType, signature, types } = parameters;
  return recoverAddress({
    hash: hashTypedData({
      domain,
      message,
      primaryType,
      types
    }),
    signature
  });
}
function serializeErc6492Signature(parameters) {
  const { address, data, signature, to = "hex" } = parameters;
  const signature_ = concatHex([
    encodeAbiParameters([{ type: "address" }, { type: "bytes" }, { type: "bytes" }], [address, data, signature]),
    erc6492MagicBytes
  ]);
  if (to === "hex")
    return signature_;
  return hexToBytes(signature_);
}
function serializeErc8010Signature(parameters) {
  const { address, data, signature, to = "hex" } = parameters;
  const signature_ = wrap({
    authorization: {
      address: parameters.authorization.address,
      chainId: parameters.authorization.chainId,
      nonce: BigInt(parameters.authorization.nonce),
      r: BigInt(parameters.authorization.r),
      s: BigInt(parameters.authorization.s),
      yParity: parameters.authorization.yParity
    },
    data,
    signature,
    to: address
  });
  if (to === "hex")
    return signature_;
  return hexToBytes(signature_);
}
async function verifyHash({ address, hash, signature }) {
  return isAddressEqual(getAddress(address), await recoverAddress({ hash, signature }));
}
async function verifyMessage({ address, message, signature }) {
  return isAddressEqual(getAddress(address), await recoverMessageAddress({ message, signature }));
}
async function verifyTypedData(parameters) {
  const { address, domain, message, primaryType, signature, types } = parameters;
  return isAddressEqual(getAddress(address), await recoverTypedDataAddress({
    domain,
    message,
    primaryType,
    signature,
    types
  }));
}
function getSerializedTransactionType(serializedTransaction) {
  const serializedType = sliceHex(serializedTransaction, 0, 1);
  if (serializedType === "0x04")
    return "eip7702";
  if (serializedType === "0x03")
    return "eip4844";
  if (serializedType === "0x02")
    return "eip1559";
  if (serializedType === "0x01")
    return "eip2930";
  if (serializedType !== "0x" && hexToNumber(serializedType) >= 192)
    return "legacy";
  throw new InvalidSerializedTransactionTypeError({ serializedType });
}
function parseTransaction(serializedTransaction) {
  const type = getSerializedTransactionType(serializedTransaction);
  if (type === "eip1559")
    return parseTransactionEIP1559(serializedTransaction);
  if (type === "eip2930")
    return parseTransactionEIP2930(serializedTransaction);
  if (type === "eip4844")
    return parseTransactionEIP4844(serializedTransaction);
  if (type === "eip7702")
    return parseTransactionEIP7702(serializedTransaction);
  return parseTransactionLegacy(serializedTransaction);
}
function parseTransactionEIP7702(serializedTransaction) {
  const transactionArray = toTransactionArray(serializedTransaction);
  const [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to, value, data, accessList, authorizationList, v, r, s] = transactionArray;
  if (transactionArray.length !== 10 && transactionArray.length !== 13)
    throw new InvalidSerializedTransactionError({
      attributes: {
        chainId,
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
        gas,
        to,
        value,
        data,
        accessList,
        authorizationList,
        ...transactionArray.length > 9 ? {
          v,
          r,
          s
        } : {}
      },
      serializedTransaction,
      type: "eip7702"
    });
  const transaction = {
    chainId: hexToNumber(chainId),
    type: "eip7702"
  };
  if (isHex(to) && to !== "0x")
    transaction.to = to;
  if (isHex(gas) && gas !== "0x")
    transaction.gas = hexToBigInt(gas);
  if (isHex(data) && data !== "0x")
    transaction.data = data;
  if (isHex(nonce))
    transaction.nonce = nonce === "0x" ? 0 : hexToNumber(nonce);
  if (isHex(value) && value !== "0x")
    transaction.value = hexToBigInt(value);
  if (isHex(maxFeePerGas) && maxFeePerGas !== "0x")
    transaction.maxFeePerGas = hexToBigInt(maxFeePerGas);
  if (isHex(maxPriorityFeePerGas) && maxPriorityFeePerGas !== "0x")
    transaction.maxPriorityFeePerGas = hexToBigInt(maxPriorityFeePerGas);
  if (accessList.length !== 0 && accessList !== "0x")
    transaction.accessList = parseAccessList(accessList);
  if (authorizationList.length !== 0 && authorizationList !== "0x")
    transaction.authorizationList = parseAuthorizationList(authorizationList);
  assertTransactionEIP7702(transaction);
  const signature = transactionArray.length === 13 ? parseEIP155Signature(transactionArray) : void 0;
  return { ...signature, ...transaction };
}
function parseTransactionEIP4844(serializedTransaction) {
  const transactionOrWrapperArray = toTransactionArray(serializedTransaction);
  const hasNetworkWrapper = transactionOrWrapperArray.length === 4;
  const transactionArray = hasNetworkWrapper ? transactionOrWrapperArray[0] : transactionOrWrapperArray;
  const wrapperArray = hasNetworkWrapper ? transactionOrWrapperArray.slice(1) : [];
  const [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to, value, data, accessList, maxFeePerBlobGas, blobVersionedHashes, v, r, s] = transactionArray;
  const [blobs, commitments, proofs] = wrapperArray;
  if (!(transactionArray.length === 11 || transactionArray.length === 14))
    throw new InvalidSerializedTransactionError({
      attributes: {
        chainId,
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
        gas,
        to,
        value,
        data,
        accessList,
        ...transactionArray.length > 9 ? {
          v,
          r,
          s
        } : {}
      },
      serializedTransaction,
      type: "eip4844"
    });
  const transaction = {
    blobVersionedHashes,
    chainId: hexToNumber(chainId),
    to,
    type: "eip4844"
  };
  if (isHex(gas) && gas !== "0x")
    transaction.gas = hexToBigInt(gas);
  if (isHex(data) && data !== "0x")
    transaction.data = data;
  if (isHex(nonce))
    transaction.nonce = nonce === "0x" ? 0 : hexToNumber(nonce);
  if (isHex(value) && value !== "0x")
    transaction.value = hexToBigInt(value);
  if (isHex(maxFeePerBlobGas) && maxFeePerBlobGas !== "0x")
    transaction.maxFeePerBlobGas = hexToBigInt(maxFeePerBlobGas);
  if (isHex(maxFeePerGas) && maxFeePerGas !== "0x")
    transaction.maxFeePerGas = hexToBigInt(maxFeePerGas);
  if (isHex(maxPriorityFeePerGas) && maxPriorityFeePerGas !== "0x")
    transaction.maxPriorityFeePerGas = hexToBigInt(maxPriorityFeePerGas);
  if (accessList.length !== 0 && accessList !== "0x")
    transaction.accessList = parseAccessList(accessList);
  if (blobs && commitments && proofs)
    transaction.sidecars = toBlobSidecars({
      blobs,
      commitments,
      proofs
    });
  assertTransactionEIP4844(transaction);
  const signature = transactionArray.length === 14 ? parseEIP155Signature(transactionArray) : void 0;
  return { ...signature, ...transaction };
}
function parseTransactionEIP1559(serializedTransaction) {
  const transactionArray = toTransactionArray(serializedTransaction);
  const [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to, value, data, accessList, v, r, s] = transactionArray;
  if (!(transactionArray.length === 9 || transactionArray.length === 12))
    throw new InvalidSerializedTransactionError({
      attributes: {
        chainId,
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
        gas,
        to,
        value,
        data,
        accessList,
        ...transactionArray.length > 9 ? {
          v,
          r,
          s
        } : {}
      },
      serializedTransaction,
      type: "eip1559"
    });
  const transaction = {
    chainId: hexToNumber(chainId),
    type: "eip1559"
  };
  if (isHex(to) && to !== "0x")
    transaction.to = to;
  if (isHex(gas) && gas !== "0x")
    transaction.gas = hexToBigInt(gas);
  if (isHex(data) && data !== "0x")
    transaction.data = data;
  if (isHex(nonce))
    transaction.nonce = nonce === "0x" ? 0 : hexToNumber(nonce);
  if (isHex(value) && value !== "0x")
    transaction.value = hexToBigInt(value);
  if (isHex(maxFeePerGas) && maxFeePerGas !== "0x")
    transaction.maxFeePerGas = hexToBigInt(maxFeePerGas);
  if (isHex(maxPriorityFeePerGas) && maxPriorityFeePerGas !== "0x")
    transaction.maxPriorityFeePerGas = hexToBigInt(maxPriorityFeePerGas);
  if (accessList.length !== 0 && accessList !== "0x")
    transaction.accessList = parseAccessList(accessList);
  assertTransactionEIP1559(transaction);
  const signature = transactionArray.length === 12 ? parseEIP155Signature(transactionArray) : void 0;
  return { ...signature, ...transaction };
}
function parseTransactionEIP2930(serializedTransaction) {
  const transactionArray = toTransactionArray(serializedTransaction);
  const [chainId, nonce, gasPrice, gas, to, value, data, accessList, v, r, s] = transactionArray;
  if (!(transactionArray.length === 8 || transactionArray.length === 11))
    throw new InvalidSerializedTransactionError({
      attributes: {
        chainId,
        nonce,
        gasPrice,
        gas,
        to,
        value,
        data,
        accessList,
        ...transactionArray.length > 8 ? {
          v,
          r,
          s
        } : {}
      },
      serializedTransaction,
      type: "eip2930"
    });
  const transaction = {
    chainId: hexToNumber(chainId),
    type: "eip2930"
  };
  if (isHex(to) && to !== "0x")
    transaction.to = to;
  if (isHex(gas) && gas !== "0x")
    transaction.gas = hexToBigInt(gas);
  if (isHex(data) && data !== "0x")
    transaction.data = data;
  if (isHex(nonce))
    transaction.nonce = nonce === "0x" ? 0 : hexToNumber(nonce);
  if (isHex(value) && value !== "0x")
    transaction.value = hexToBigInt(value);
  if (isHex(gasPrice) && gasPrice !== "0x")
    transaction.gasPrice = hexToBigInt(gasPrice);
  if (accessList.length !== 0 && accessList !== "0x")
    transaction.accessList = parseAccessList(accessList);
  assertTransactionEIP2930(transaction);
  const signature = transactionArray.length === 11 ? parseEIP155Signature(transactionArray) : void 0;
  return { ...signature, ...transaction };
}
function parseTransactionLegacy(serializedTransaction) {
  const transactionArray = fromRlp(serializedTransaction, "hex");
  const [nonce, gasPrice, gas, to, value, data, chainIdOrV_, r, s] = transactionArray;
  if (!(transactionArray.length === 6 || transactionArray.length === 9))
    throw new InvalidSerializedTransactionError({
      attributes: {
        nonce,
        gasPrice,
        gas,
        to,
        value,
        data,
        ...transactionArray.length > 6 ? {
          v: chainIdOrV_,
          r,
          s
        } : {}
      },
      serializedTransaction,
      type: "legacy"
    });
  const transaction = {
    type: "legacy"
  };
  if (isHex(to) && to !== "0x")
    transaction.to = to;
  if (isHex(gas) && gas !== "0x")
    transaction.gas = hexToBigInt(gas);
  if (isHex(data) && data !== "0x")
    transaction.data = data;
  if (isHex(nonce))
    transaction.nonce = nonce === "0x" ? 0 : hexToNumber(nonce);
  if (isHex(value) && value !== "0x")
    transaction.value = hexToBigInt(value);
  if (isHex(gasPrice) && gasPrice !== "0x")
    transaction.gasPrice = hexToBigInt(gasPrice);
  assertTransactionLegacy(transaction);
  if (transactionArray.length === 6)
    return transaction;
  const chainIdOrV = isHex(chainIdOrV_) && chainIdOrV_ !== "0x" ? hexToBigInt(chainIdOrV_) : 0n;
  if (s === "0x" && r === "0x") {
    if (chainIdOrV > 0)
      transaction.chainId = Number(chainIdOrV);
    return transaction;
  }
  const v = chainIdOrV;
  const chainId = Number((v - 35n) / 2n);
  if (chainId > 0)
    transaction.chainId = chainId;
  else if (v !== 27n && v !== 28n)
    throw new InvalidLegacyVError({ v });
  transaction.v = v;
  transaction.s = s;
  transaction.r = r;
  transaction.yParity = v % 2n === 0n ? 1 : 0;
  return transaction;
}
function toTransactionArray(serializedTransaction) {
  return fromRlp(`0x${serializedTransaction.slice(4)}`, "hex");
}
function parseAccessList(accessList_) {
  const accessList = [];
  for (let i = 0; i < accessList_.length; i++) {
    const [address, storageKeys] = accessList_[i];
    if (!isAddress(address, { strict: false }))
      throw new InvalidAddressError({ address });
    accessList.push({
      address,
      storageKeys: storageKeys.map((key) => isHash(key) ? key : trim(key))
    });
  }
  return accessList;
}
function parseAuthorizationList(serializedAuthorizationList) {
  const authorizationList = [];
  for (let i = 0; i < serializedAuthorizationList.length; i++) {
    const [chainId, address, nonce, yParity, r, s] = serializedAuthorizationList[i];
    authorizationList.push({
      address,
      chainId: chainId === "0x" ? 0 : hexToNumber(chainId),
      nonce: nonce === "0x" ? 0 : hexToNumber(nonce),
      ...parseEIP155Signature([yParity, r, s])
    });
  }
  return authorizationList;
}
function parseEIP155Signature(transactionArray) {
  const signature = transactionArray.slice(-3);
  const v = signature[0] === "0x" || hexToBigInt(signature[0]) === 0n ? 27n : 28n;
  return {
    r: padHex(signature[1], { size: 32 }),
    s: padHex(signature[2], { size: 32 }),
    v,
    yParity: v === 27n ? 0 : 1
  };
}
function parseGwei(ether, unit = "wei") {
  return parseUnits(ether, gweiUnits[unit]);
}
async function dropTransaction(client, { hash }) {
  await client.request({
    method: `${client.mode}_dropTransaction`,
    params: [hash]
  });
}
async function dumpState(client) {
  return client.request({
    method: `${client.mode}_dumpState`
  });
}
async function getAutomine(client) {
  if (client.mode === "ganache")
    return await client.request({
      method: "eth_mining"
    });
  return await client.request({
    method: `${client.mode}_getAutomine`
  });
}
async function getTxpoolContent(client) {
  return await client.request({
    method: "txpool_content"
  });
}
async function getTxpoolStatus(client) {
  const { pending, queued } = await client.request({
    method: "txpool_status"
  });
  return {
    pending: hexToNumber(pending),
    queued: hexToNumber(queued)
  };
}
async function impersonateAccount(client, { address }) {
  await client.request({
    method: `${client.mode}_impersonateAccount`,
    params: [address]
  });
}
async function increaseTime(client, { seconds }) {
  return await client.request({
    method: "evm_increaseTime",
    params: [numberToHex(seconds)]
  });
}
async function inspectTxpool(client) {
  return await client.request({
    method: "txpool_inspect"
  });
}
async function loadState(client, { state }) {
  await client.request({
    method: `${client.mode}_loadState`,
    params: [state]
  });
}
async function mine(client, { blocks, interval }) {
  if (client.mode === "ganache")
    await client.request({
      method: "evm_mine",
      params: [{ blocks: numberToHex(blocks) }]
    });
  else
    await client.request({
      method: `${client.mode}_mine`,
      params: [numberToHex(blocks), numberToHex(interval || 0)]
    });
}
async function removeBlockTimestampInterval(client) {
  await client.request({
    method: `${client.mode}_removeBlockTimestampInterval`
  });
}
async function reset(client, { blockNumber, jsonRpcUrl } = {}) {
  await client.request({
    method: `${client.mode}_reset`,
    params: [{ forking: { blockNumber: Number(blockNumber), jsonRpcUrl } }]
  });
}
async function revert(client, { id }) {
  await client.request({
    method: "evm_revert",
    params: [id]
  });
}
async function sendUnsignedTransaction(client, args) {
  var _a, _b, _c;
  const { accessList, data, from, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, to, value, ...rest } = args;
  const chainFormat = (_c = (_b = (_a = client.chain) == null ? void 0 : _a.formatters) == null ? void 0 : _b.transactionRequest) == null ? void 0 : _c.format;
  const format = chainFormat || formatTransactionRequest;
  const request = format({
    // Pick out extra data that might exist on the chain's transaction request type.
    ...extract(rest, { format: chainFormat }),
    accessList,
    data,
    from,
    gas,
    gasPrice,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce,
    to,
    value
  }, "sendUnsignedTransaction");
  const hash = await client.request({
    method: "eth_sendUnsignedTransaction",
    params: [request]
  });
  return hash;
}
async function setAutomine(client, enabled) {
  if (client.mode === "ganache") {
    if (enabled)
      await client.request({ method: "miner_start" });
    else
      await client.request({ method: "miner_stop" });
  } else
    await client.request({
      method: "evm_setAutomine",
      params: [enabled]
    });
}
async function setBalance(client, { address, value }) {
  if (client.mode === "ganache")
    await client.request({
      method: "evm_setAccountBalance",
      params: [address, numberToHex(value)]
    });
  else
    await client.request({
      method: `${client.mode}_setBalance`,
      params: [address, numberToHex(value)]
    });
}
async function setBlockGasLimit(client, { gasLimit }) {
  await client.request({
    method: "evm_setBlockGasLimit",
    params: [numberToHex(gasLimit)]
  });
}
async function setBlockTimestampInterval(client, { interval }) {
  const interval_ = (() => {
    if (client.mode === "hardhat")
      return interval * 1e3;
    return interval;
  })();
  await client.request({
    method: `${client.mode}_setBlockTimestampInterval`,
    params: [interval_]
  });
}
async function setCode(client, { address, bytecode }) {
  if (client.mode === "ganache")
    await client.request({
      method: "evm_setAccountCode",
      params: [address, bytecode]
    });
  else
    await client.request({
      method: `${client.mode}_setCode`,
      params: [address, bytecode]
    });
}
async function setCoinbase(client, { address }) {
  await client.request({
    method: `${client.mode}_setCoinbase`,
    params: [address]
  });
}
async function setIntervalMining(client, { interval }) {
  const interval_ = (() => {
    if (client.mode === "hardhat")
      return interval * 1e3;
    return interval;
  })();
  await client.request({
    method: "evm_setIntervalMining",
    params: [interval_]
  });
}
async function setLoggingEnabled(client, enabled) {
  await client.request({
    method: `${client.mode}_setLoggingEnabled`,
    params: [enabled]
  });
}
async function setMinGasPrice(client, { gasPrice }) {
  await client.request({
    method: `${client.mode}_setMinGasPrice`,
    params: [numberToHex(gasPrice)]
  });
}
async function setNextBlockBaseFeePerGas(client, { baseFeePerGas }) {
  await client.request({
    method: `${client.mode}_setNextBlockBaseFeePerGas`,
    params: [numberToHex(baseFeePerGas)]
  });
}
async function setNextBlockTimestamp(client, { timestamp }) {
  await client.request({
    method: "evm_setNextBlockTimestamp",
    params: [numberToHex(timestamp)]
  });
}
async function setNonce(client, { address, nonce }) {
  await client.request({
    method: `${client.mode}_setNonce`,
    params: [address, numberToHex(nonce)]
  });
}
async function setRpcUrl(client, jsonRpcUrl) {
  await client.request({
    method: `${client.mode}_setRpcUrl`,
    params: [jsonRpcUrl]
  });
}
async function setStorageAt(client, { address, index, value }) {
  await client.request({
    method: `${client.mode}_setStorageAt`,
    params: [
      address,
      typeof index === "number" ? numberToHex(index) : index,
      value
    ]
  });
}
async function snapshot(client) {
  return await client.request({
    method: "evm_snapshot"
  });
}
async function stopImpersonatingAccount(client, { address }) {
  await client.request({
    method: `${client.mode}_stopImpersonatingAccount`,
    params: [address]
  });
}
function testActions({ mode }) {
  return (client_) => {
    const client = client_.extend(() => ({
      mode
    }));
    return {
      dropTransaction: (args) => dropTransaction(client, args),
      dumpState: () => dumpState(client),
      getAutomine: () => getAutomine(client),
      getTxpoolContent: () => getTxpoolContent(client),
      getTxpoolStatus: () => getTxpoolStatus(client),
      impersonateAccount: (args) => impersonateAccount(client, args),
      increaseTime: (args) => increaseTime(client, args),
      inspectTxpool: () => inspectTxpool(client),
      loadState: (args) => loadState(client, args),
      mine: (args) => mine(client, args),
      removeBlockTimestampInterval: () => removeBlockTimestampInterval(client),
      reset: (args) => reset(client, args),
      revert: (args) => revert(client, args),
      sendUnsignedTransaction: (args) => sendUnsignedTransaction(client, args),
      setAutomine: (args) => setAutomine(client, args),
      setBalance: (args) => setBalance(client, args),
      setBlockGasLimit: (args) => setBlockGasLimit(client, args),
      setBlockTimestampInterval: (args) => setBlockTimestampInterval(client, args),
      setCode: (args) => setCode(client, args),
      setCoinbase: (args) => setCoinbase(client, args),
      setIntervalMining: (args) => setIntervalMining(client, args),
      setLoggingEnabled: (args) => setLoggingEnabled(client, args),
      setMinGasPrice: (args) => setMinGasPrice(client, args),
      setNextBlockBaseFeePerGas: (args) => setNextBlockBaseFeePerGas(client, args),
      setNextBlockTimestamp: (args) => setNextBlockTimestamp(client, args),
      setNonce: (args) => setNonce(client, args),
      setRpcUrl: (args) => setRpcUrl(client, args),
      setStorageAt: (args) => setStorageAt(client, args),
      snapshot: () => snapshot(client),
      stopImpersonatingAccount: (args) => stopImpersonatingAccount(client, args)
    };
  };
}
function createTestClient(parameters) {
  const { key = "test", name = "Test Client", mode } = parameters;
  const client = createClient({
    ...parameters,
    key,
    name,
    type: "testClient"
  });
  return client.extend((config) => ({
    mode,
    ...testActions({ mode })(config)
  }));
}
function custom(provider, config = {}) {
  const { key = "custom", methods, name = "Custom Provider", retryDelay } = config;
  return ({ retryCount: defaultRetryCount }) => createTransport({
    key,
    methods,
    name,
    request: provider.request.bind(provider),
    retryCount: config.retryCount ?? defaultRetryCount,
    retryDelay,
    type: "custom"
  });
}
function fallback(transports_, config = {}) {
  const { key = "fallback", name = "Fallback", rank = false, shouldThrow: shouldThrow_ = shouldThrow, retryCount, retryDelay } = config;
  return ({ chain, pollingInterval = 4e3, timeout, ...rest }) => {
    let transports = transports_;
    let onResponse = () => {
    };
    const transport = createTransport({
      key,
      name,
      async request({ method, params }) {
        let includes;
        const fetch = async (i = 0) => {
          const transport2 = transports[i]({
            ...rest,
            chain,
            retryCount: 0,
            timeout
          });
          try {
            const response = await transport2.request({
              method,
              params
            });
            onResponse({
              method,
              params,
              response,
              transport: transport2,
              status: "success"
            });
            return response;
          } catch (err) {
            onResponse({
              error: err,
              method,
              params,
              transport: transport2,
              status: "error"
            });
            if (shouldThrow_(err))
              throw err;
            if (i === transports.length - 1)
              throw err;
            includes ?? (includes = transports.slice(i + 1).some((transport3) => {
              const { include, exclude } = transport3({ chain }).config.methods || {};
              if (include)
                return include.includes(method);
              if (exclude)
                return !exclude.includes(method);
              return true;
            }));
            if (!includes)
              throw err;
            return fetch(i + 1);
          }
        };
        return fetch();
      },
      retryCount,
      retryDelay,
      type: "fallback"
    }, {
      onResponse: (fn2) => onResponse = fn2,
      transports: transports.map((fn2) => fn2({ chain, retryCount: 0 }))
    });
    if (rank) {
      const rankOptions = typeof rank === "object" ? rank : {};
      rankTransports({
        chain,
        interval: rankOptions.interval ?? pollingInterval,
        onTransports: (transports_2) => transports = transports_2,
        ping: rankOptions.ping,
        sampleCount: rankOptions.sampleCount,
        timeout: rankOptions.timeout,
        transports,
        weights: rankOptions.weights
      });
    }
    return transport;
  };
}
function shouldThrow(error) {
  if ("code" in error && typeof error.code === "number") {
    if (error.code === TransactionRejectedRpcError.code || error.code === UserRejectedRequestError.code || error.code === WalletConnectSessionSettlementError.code || ExecutionRevertedError.nodeMessage.test(error.message) || error.code === 5e3)
      return true;
  }
  return false;
}
function rankTransports({ chain, interval = 4e3, onTransports, ping, sampleCount = 10, timeout = 1e3, transports, weights = {} }) {
  const { stability: stabilityWeight = 0.7, latency: latencyWeight = 0.3 } = weights;
  const samples = [];
  const rankTransports_ = async () => {
    const sample = await Promise.all(transports.map(async (transport) => {
      const transport_ = transport({ chain, retryCount: 0, timeout });
      const start = Date.now();
      let end;
      let success;
      try {
        await (ping ? ping({ transport: transport_ }) : transport_.request({ method: "net_listening" }));
        success = 1;
      } catch {
        success = 0;
      } finally {
        end = Date.now();
      }
      const latency = end - start;
      return { latency, success };
    }));
    samples.push(sample);
    if (samples.length > sampleCount)
      samples.shift();
    const maxLatency = Math.max(...samples.map((sample2) => Math.max(...sample2.map(({ latency }) => latency))));
    const scores = transports.map((_, i) => {
      const latencies = samples.map((sample2) => sample2[i].latency);
      const meanLatency = latencies.reduce((acc, latency) => acc + latency, 0) / latencies.length;
      const latencyScore = 1 - meanLatency / maxLatency;
      const successes = samples.map((sample2) => sample2[i].success);
      const stabilityScore = successes.reduce((acc, success) => acc + success, 0) / successes.length;
      if (stabilityScore === 0)
        return [0, i];
      return [
        latencyWeight * latencyScore + stabilityWeight * stabilityScore,
        i
      ];
    }).sort((a, b) => b[0] - a[0]);
    onTransports(scores.map(([, i]) => transports[i]));
    await wait(interval);
    rankTransports_();
  };
  rankTransports_();
}
function webSocket(url, config = {}) {
  const { keepAlive, key = "webSocket", methods, name = "WebSocket JSON-RPC", reconnect, retryDelay } = config;
  return ({ chain, retryCount: retryCount_, timeout: timeout_ }) => {
    var _a;
    const retryCount = config.retryCount ?? retryCount_;
    const timeout = timeout_ ?? config.timeout ?? 1e4;
    const url_ = url || ((_a = chain == null ? void 0 : chain.rpcUrls.default.webSocket) == null ? void 0 : _a[0]);
    const wsRpcClientOpts = { keepAlive, reconnect };
    if (!url_)
      throw new UrlRequiredError();
    return createTransport({
      key,
      methods,
      name,
      async request({ method, params }) {
        const body = { method, params };
        const rpcClient = await getWebSocketRpcClient(url_, wsRpcClientOpts);
        const { error, result } = await rpcClient.requestAsync({
          body,
          timeout
        });
        if (error)
          throw new RpcRequestError({
            body,
            error,
            url: url_
          });
        return result;
      },
      retryCount,
      retryDelay,
      timeout,
      type: "webSocket"
    }, {
      getSocket() {
        return getSocket(url_);
      },
      getRpcClient() {
        return getWebSocketRpcClient(url_, wsRpcClientOpts);
      },
      async subscribe({ params, onData, onError }) {
        const rpcClient = await getWebSocketRpcClient(url_, wsRpcClientOpts);
        const { result: subscriptionId } = await new Promise((resolve, reject) => rpcClient.request({
          body: {
            method: "eth_subscribe",
            params
          },
          onError(error) {
            reject(error);
            onError == null ? void 0 : onError(error);
            return;
          },
          onResponse(response) {
            if (response.error) {
              reject(response.error);
              onError == null ? void 0 : onError(response.error);
              return;
            }
            if (typeof response.id === "number") {
              resolve(response);
              return;
            }
            if (response.method !== "eth_subscription")
              return;
            onData(response.params);
          }
        }));
        return {
          subscriptionId,
          async unsubscribe() {
            return new Promise((resolve) => rpcClient.request({
              body: {
                method: "eth_unsubscribe",
                params: [subscriptionId]
              },
              onResponse: resolve
            }));
          }
        };
      }
    });
  };
}
class ProviderRpcError extends Error {
  constructor(code, message) {
    super(message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "details", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.code = code;
    this.details = message;
  }
}
const docsPath = "/docs/contract/decodeDeployData";
function decodeDeployData(parameters) {
  const { abi, bytecode, data } = parameters;
  if (data === bytecode)
    return { bytecode };
  const description = abi.find((x) => "type" in x && x.type === "constructor");
  if (!description)
    throw new AbiConstructorNotFoundError({ docsPath });
  if (!("inputs" in description))
    throw new AbiConstructorParamsNotFoundError({ docsPath });
  if (!description.inputs || description.inputs.length === 0)
    throw new AbiConstructorParamsNotFoundError({ docsPath });
  const args = decodeAbiParameters(description.inputs, `0x${data.replace(bytecode, "")}`);
  return { args, bytecode };
}
function fromBlobs(parameters) {
  const to = parameters.to ?? (typeof parameters.blobs[0] === "string" ? "hex" : "bytes");
  const blobs = typeof parameters.blobs[0] === "string" ? parameters.blobs.map((x) => hexToBytes(x)) : parameters.blobs;
  const length = blobs.reduce((length2, blob) => length2 + blob.length, 0);
  const data = createCursor(new Uint8Array(length));
  let active = true;
  for (const blob of blobs) {
    const cursor = createCursor(blob);
    while (active && cursor.position < blob.length) {
      cursor.incrementPosition(1);
      let consume = 31;
      if (blob.length - cursor.position < 31)
        consume = blob.length - cursor.position;
      for (const _ in Array.from({ length: consume })) {
        const byte = cursor.readByte();
        const isTerminator = byte === 128 && !cursor.inspectBytes(cursor.remaining).includes(128);
        if (isTerminator) {
          active = false;
          break;
        }
        data.pushByte(byte);
      }
    }
  }
  const trimmedData = data.bytes.slice(0, data.position);
  return to === "hex" ? bytesToHex(trimmedData) : trimmedData;
}
function sidecarsToVersionedHashes(parameters) {
  const { sidecars, version } = parameters;
  const to = parameters.to ?? (typeof sidecars[0].blob === "string" ? "hex" : "bytes");
  const hashes = [];
  for (const { commitment } of sidecars) {
    hashes.push(commitmentToVersionedHash({
      commitment,
      to,
      version
    }));
  }
  return hashes;
}
const SLIP44_MSB = 2147483648;
function toCoinType(chainId) {
  if (chainId === 1)
    return 60n;
  if (chainId >= SLIP44_MSB || chainId < 0)
    throw new EnsInvalidChainIdError({ chainId });
  return BigInt((2147483648 | chainId) >>> 0);
}
function defineKzg({ blobToKzgCommitment, computeBlobKzgProof }) {
  return {
    blobToKzgCommitment,
    computeBlobKzgProof
  };
}
function setupKzg(parameters, path) {
  try {
    parameters.loadTrustedSetup(path);
  } catch (e) {
    const error = e;
    if (!error.message.includes("trusted setup is already loaded"))
      throw error;
  }
  return defineKzg(parameters);
}
function compactSignatureToSignature({ r, yParityAndS }) {
  const yParityAndS_bytes = hexToBytes(yParityAndS);
  const yParity = yParityAndS_bytes[0] & 128 ? 1 : 0;
  const s = yParityAndS_bytes;
  if (yParity === 1)
    s[0] &= 127;
  return { r, s: bytesToHex(s), yParity };
}
function parseCompactSignature(signatureHex) {
  const { r, s } = secp256k1.Signature.fromCompact(signatureHex.slice(2, 130));
  return {
    r: numberToHex(r, { size: 32 }),
    yParityAndS: numberToHex(s, { size: 32 })
  };
}
function parseSignature(signatureHex) {
  const { r, s } = secp256k1.Signature.fromCompact(signatureHex.slice(2, 130));
  const yParityOrV = Number(`0x${signatureHex.slice(130)}`);
  const [v, yParity] = (() => {
    if (yParityOrV === 0 || yParityOrV === 1)
      return [void 0, yParityOrV];
    if (yParityOrV === 27)
      return [BigInt(yParityOrV), 0];
    if (yParityOrV === 28)
      return [BigInt(yParityOrV), 1];
    throw new Error("Invalid yParityOrV value");
  })();
  if (typeof v !== "undefined")
    return {
      r: numberToHex(r, { size: 32 }),
      s: numberToHex(s, { size: 32 }),
      v,
      yParity
    };
  return {
    r: numberToHex(r, { size: 32 }),
    s: numberToHex(s, { size: 32 }),
    yParity
  };
}
async function recoverTransactionAddress(parameters) {
  const { serializedTransaction, signature: signature_ } = parameters;
  const transaction = parseTransaction(serializedTransaction);
  const signature = signature_ ?? {
    r: transaction.r,
    s: transaction.s,
    v: transaction.v,
    yParity: transaction.yParity
  };
  const serialized = serializeTransaction({
    ...transaction,
    r: void 0,
    s: void 0,
    v: void 0,
    yParity: void 0,
    sidecars: void 0
  });
  return await recoverAddress({
    hash: keccak256(serialized),
    signature
  });
}
function serializeCompactSignature({ r, yParityAndS }) {
  return `0x${new secp256k1.Signature(hexToBigInt(r), hexToBigInt(yParityAndS)).toCompactHex()}`;
}
function signatureToCompactSignature(signature) {
  const { r, s, v, yParity } = signature;
  const yParity_ = Number(yParity ?? v - 27n);
  let yParityAndS = s;
  if (yParity_ === 1) {
    const bytes = hexToBytes(s);
    bytes[0] |= 128;
    yParityAndS = bytesToHex(bytes);
  }
  return { r, yParityAndS };
}
export {
  AbiConstructorNotFoundError,
  AbiConstructorParamsNotFoundError,
  aM as AbiDecodingDataSizeInvalidError,
  aN as AbiDecodingDataSizeTooSmallError,
  aO as AbiDecodingZeroDataError,
  aP as AbiEncodingArrayLengthMismatchError,
  aQ as AbiEncodingBytesSizeMismatchError,
  AbiEncodingLengthMismatchError,
  aR as AbiErrorInputsNotFoundError,
  aS as AbiErrorNotFoundError,
  aT as AbiErrorSignatureNotFoundError,
  aU as AbiEventNotFoundError,
  aV as AbiEventSignatureEmptyTopicsError,
  aW as AbiEventSignatureNotFoundError,
  aX as AbiFunctionNotFoundError,
  aY as AbiFunctionOutputsNotFoundError,
  aZ as AbiFunctionSignatureNotFoundError,
  a_ as AccountStateConflictError,
  a$ as AtomicReadyWalletRejectedUpgradeError,
  b0 as AtomicityNotSupportedError,
  BaseError,
  b1 as BaseFeeScalarError,
  b2 as BlockNotFoundError,
  b3 as BundleFailedError,
  b4 as BundleTooLargeError,
  BytesSizeMismatchError,
  b5 as CallExecutionError,
  b6 as ChainDisconnectedError,
  b7 as ChainDoesNotSupportContract,
  b8 as ChainMismatchError,
  b9 as ChainNotFoundError,
  ba as CircularReferenceError,
  bb as ClientChainNotConfiguredError,
  bc as ContractFunctionExecutionError,
  bd as ContractFunctionRevertedError,
  be as ContractFunctionZeroDataError,
  bf as CounterfactualDeploymentFailedError,
  bg as DecodeLogDataMismatch,
  bh as DecodeLogTopicsMismatch,
  bi as DuplicateIdError,
  ProviderRpcError as EIP1193ProviderRpcError,
  bj as Eip1559FeesNotSupportedError,
  bk as EnsAvatarInvalidNftUriError,
  bl as EnsAvatarUnsupportedNamespaceError,
  bm as EnsAvatarUriResolutionError,
  EnsInvalidChainIdError,
  bn as EstimateGasExecutionError,
  ExecutionRevertedError,
  bo as FeeCapTooHighError,
  bp as FeeCapTooLowError,
  bq as FeeConflictError,
  br as FilterTypeNotSupportedError,
  HttpRequestError,
  bs as InsufficientFundsError,
  bt as IntegerOutOfRangeError,
  bu as InternalRpcError,
  bv as IntrinsicGasTooHighError,
  bw as IntrinsicGasTooLowError,
  bx as InvalidAbiDecodingTypeError,
  by as InvalidAbiEncodingTypeError,
  bz as InvalidAbiItemError,
  InvalidAbiParameterError,
  bA as InvalidAbiParametersError,
  bB as InvalidAbiTypeParameterError,
  InvalidAddressError,
  bC as InvalidArrayError,
  bD as InvalidBytesBooleanError,
  bE as InvalidChainIdError,
  bF as InvalidDecimalNumberError,
  bG as InvalidDefinitionTypeError,
  bH as InvalidDomainError,
  bI as InvalidFunctionModifierError,
  bJ as InvalidHexBooleanError,
  InvalidHexValueError,
  bK as InvalidInputRpcError,
  InvalidLegacyVError,
  bL as InvalidModifierError,
  bM as InvalidParameterError,
  bN as InvalidParamsRpcError,
  bO as InvalidParenthesisError,
  bP as InvalidPrimaryTypeError,
  bQ as InvalidRequestRpcError,
  bR as InvalidSerializableTransactionError,
  InvalidSerializedTransactionError,
  InvalidSerializedTransactionTypeError,
  bS as InvalidSignatureError,
  bT as InvalidStorageKeySizeError,
  bU as InvalidStructSignatureError,
  bV as InvalidStructTypeError,
  bW as JsonRpcVersionUnsupportedError,
  bX as LimitExceededRpcError,
  bY as MaxFeePerGasTooLowError,
  bZ as MethodNotFoundRpcError,
  b_ as MethodNotSupportedRpcError,
  b$ as NonceMaxValueError,
  c0 as NonceTooHighError,
  c1 as NonceTooLowError,
  c2 as ParseRpcError,
  c3 as ProviderDisconnectedError,
  c4 as ProviderRpcError,
  c5 as RawContractError,
  c6 as ResourceNotFoundRpcError,
  c7 as ResourceUnavailableRpcError,
  c8 as RpcError,
  RpcRequestError,
  c9 as SizeExceedsPaddingSizeError,
  ca as SizeOverflowError,
  cb as SliceOffsetOutOfBoundsError,
  SocketClosedError,
  cc as SolidityProtectedKeywordError,
  cd as StateAssignmentConflictError,
  ce as SwitchChainError,
  TimeoutError,
  cf as TipAboveFeeCapError,
  cg as TransactionExecutionError,
  ch as TransactionNotFoundError,
  ci as TransactionReceiptNotFoundError,
  TransactionRejectedRpcError,
  cj as TransactionTypeNotSupportedError,
  ck as UnauthorizedProviderError,
  cl as UnknownBundleIdError,
  cm as UnknownNodeError,
  cn as UnknownRpcError,
  co as UnknownSignatureError,
  cp as UnknownTypeError,
  cq as UnsupportedChainIdError,
  cr as UnsupportedNonOptionalCapabilityError,
  UnsupportedPackedAbiType,
  cs as UnsupportedProviderMethodError,
  UrlRequiredError,
  UserRejectedRequestError,
  ct as WaitForCallsStatusTimeoutError,
  cu as WaitForTransactionReceiptTimeoutError,
  WebSocketRequestError,
  cv as assertCurrentChain,
  cw as assertRequest,
  assertTransactionEIP1559,
  assertTransactionEIP2930,
  assertTransactionLegacy,
  cx as blobsToCommitments,
  cy as blobsToProofs,
  cz as boolToBytes,
  boolToHex,
  cA as bytesToBigInt,
  cB as bytesToBool,
  bytesToHex,
  cC as bytesToNumber,
  cD as bytesToRlp,
  cE as bytesToString,
  ccipRequest as ccipFetch,
  ccipReadTunnel,
  ccipRequest,
  cF as checksumAddress,
  commitmentToVersionedHash,
  cG as commitmentsToVersionedHashes,
  serializeCompactSignature as compactSignatureToHex,
  compactSignatureToSignature,
  concat,
  cH as concatBytes,
  concatHex,
  createClient,
  createNonceManager,
  cI as createPublicClient,
  createTestClient,
  createTransport,
  createWalletClient,
  custom,
  decodeAbiParameters,
  decodeDeployData,
  decodeErrorResult,
  cJ as decodeEventLog,
  cK as decodeFunctionData,
  decodeFunctionResult,
  cL as defineBlock,
  cM as defineChain,
  defineKzg,
  cN as defineTransaction,
  cO as defineTransactionReceipt,
  cP as defineTransactionRequest,
  cQ as deploylessCallViaBytecodeBytecode,
  cR as deploylessCallViaFactoryBytecode,
  cS as domainSeparator,
  encodeAbiParameters,
  cT as encodeDeployData,
  cU as encodeErrorResult,
  cV as encodeEventTopics,
  encodeFunctionData,
  cW as encodeFunctionResult,
  encodePacked,
  cX as erc1155Abi,
  cY as erc20Abi,
  cZ as erc20Abi_bytes32,
  c_ as erc4626Abi,
  c$ as erc6492SignatureValidatorAbi,
  d0 as erc6492SignatureValidatorByteCode,
  d1 as erc721Abi,
  d2 as ethAddress,
  d3 as etherUnits,
  d4 as extendSchema,
  extractChain,
  fallback,
  d5 as formatBlock,
  d6 as formatEther,
  d7 as formatGwei,
  d8 as formatLog,
  d9 as formatTransaction,
  da as formatTransactionReceipt,
  formatTransactionRequest,
  db as formatUnits,
  fromBlobs,
  dc as fromBytes,
  dd as fromHex,
  fromRlp,
  de as getAbiItem,
  getAddress,
  df as getChainContractAddress,
  getContract,
  getContractAddress,
  dg as getContractError,
  getCreate2Address,
  getCreateAddress,
  dh as getEventSelector,
  di as getEventSignature,
  dj as getFunctionSelector,
  di2 as getFunctionSignature,
  getSerializedTransactionType,
  dk as getTransactionType,
  dl as getTypesForEIP712Domain,
  gweiUnits,
  dm as hashDomain,
  hashMessage,
  dn as hashStruct,
  hashTypedData,
  hexToBigInt,
  dp as hexToBool,
  hexToBytes,
  parseCompactSignature as hexToCompactSignature,
  hexToNumber,
  dq as hexToRlp,
  parseSignature as hexToSignature,
  dr as hexToString,
  http,
  isAddress,
  isAddressEqual,
  isBytes,
  isErc6492Signature,
  isErc8010Signature,
  isHash,
  isHex,
  keccak256,
  ds as labelhash,
  dt as maxInt104,
  du as maxInt112,
  dv as maxInt120,
  dw as maxInt128,
  dx as maxInt136,
  dy as maxInt144,
  dz as maxInt152,
  dA as maxInt16,
  dB as maxInt160,
  dC as maxInt168,
  dD as maxInt176,
  dE as maxInt184,
  dF as maxInt192,
  dG as maxInt200,
  dH as maxInt208,
  dI as maxInt216,
  dJ as maxInt224,
  dK as maxInt232,
  dL as maxInt24,
  dM as maxInt240,
  dN as maxInt248,
  dO as maxInt256,
  dP as maxInt32,
  dQ as maxInt40,
  dR as maxInt48,
  dS as maxInt56,
  dT as maxInt64,
  dU as maxInt72,
  dV as maxInt8,
  dW as maxInt80,
  dX as maxInt88,
  dY as maxInt96,
  dZ as maxUint104,
  d_ as maxUint112,
  d$ as maxUint120,
  e0 as maxUint128,
  e1 as maxUint136,
  e2 as maxUint144,
  e3 as maxUint152,
  e4 as maxUint16,
  e5 as maxUint160,
  e6 as maxUint168,
  e7 as maxUint176,
  e8 as maxUint184,
  e9 as maxUint192,
  ea as maxUint200,
  eb as maxUint208,
  ec as maxUint216,
  ed as maxUint224,
  ee as maxUint232,
  ef as maxUint24,
  eg as maxUint240,
  eh as maxUint248,
  ei as maxUint256,
  ej as maxUint32,
  ek as maxUint40,
  el as maxUint48,
  em as maxUint56,
  en as maxUint64,
  eo as maxUint72,
  ep as maxUint8,
  eq as maxUint80,
  er as maxUint88,
  es as maxUint96,
  et as minInt104,
  eu as minInt112,
  ev as minInt120,
  ew as minInt128,
  ex as minInt136,
  ey as minInt144,
  ez as minInt152,
  eA as minInt16,
  eB as minInt160,
  eC as minInt168,
  eD as minInt176,
  eE as minInt184,
  eF as minInt192,
  eG as minInt200,
  eH as minInt208,
  eI as minInt216,
  eJ as minInt224,
  eK as minInt232,
  eL as minInt24,
  eM as minInt240,
  eN as minInt248,
  eO as minInt256,
  eP as minInt32,
  eQ as minInt40,
  eR as minInt48,
  eS as minInt56,
  eT as minInt64,
  eU as minInt72,
  eV as minInt8,
  eW as minInt80,
  eX as minInt88,
  eY as minInt96,
  eZ as multicall3Abi,
  e_ as namehash,
  nonceManager,
  e$ as numberToBytes,
  numberToHex,
  offchainLookup,
  offchainLookupAbiItem,
  offchainLookupSignature,
  pad,
  f0 as padBytes,
  padHex,
  f1 as parseAbi,
  f2 as parseAbiItem,
  parseAbiParameter,
  f3 as parseAbiParameters,
  parseCompactSignature,
  parseErc6492Signature,
  parseErc8010Signature,
  parseEther,
  f4 as parseEventLogs,
  parseGwei,
  parseSignature,
  parseTransaction,
  parseUnits,
  f5 as prepareEncodeFunctionData,
  f6 as presignMessagePrefix,
  f7 as publicActions,
  recoverAddress,
  recoverMessageAddress,
  f8 as recoverPublicKey,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  ripemd160,
  f9 as rpcSchema,
  fa as rpcTransactionType,
  fb as serializeAccessList,
  serializeCompactSignature,
  serializeErc6492Signature,
  serializeErc8010Signature,
  fc as serializeSignature,
  serializeTransaction,
  fd as serializeTypedData,
  fe as setErrorConfig,
  setupKzg,
  ff as sha256,
  shouldThrow,
  sidecarsToVersionedHashes,
  signatureToCompactSignature,
  fc2 as signatureToHex,
  size,
  slice,
  fg as sliceBytes,
  sliceHex,
  fh as stringToBytes,
  stringToHex,
  fi as stringify,
  testActions,
  toBlobSidecars,
  fj as toBlobs,
  toBytes,
  toCoinType,
  fk as toEventHash,
  dh2 as toEventSelector,
  di3 as toEventSignature,
  fk2 as toFunctionHash,
  dj2 as toFunctionSelector,
  di4 as toFunctionSignature,
  toHex,
  fl as toPrefixedMessage,
  toRlp,
  fm as transactionType,
  trim,
  c$2 as universalSignatureValidatorAbi,
  d02 as universalSignatureValidatorByteCode,
  fn as validateTypedData,
  verifyHash,
  verifyMessage,
  verifyTypedData,
  fo as walletActions,
  webSocket,
  fp as weiUnits,
  fq as withCache,
  fr as withRetry,
  withTimeout,
  fs as zeroAddress,
  zeroHash
};
