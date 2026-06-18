function makeEthProvider() {
  const _listeners = {};
  return {
    isMetaMask: true,
    isMagicMoney: true,
    request({ method, params }) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "web3:request", args: [{ method, params: params ?? [] }] },
          (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!res) {
              reject(new Error("No response"));
              return;
            }
            if (res.ok) resolve(res.result);
            else reject(new Error(res.error ?? "Request failed"));
          }
        );
      });
    },
    on(event, cb) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(cb);
    },
    removeListener(event, cb) {
      if (_listeners[event]) _listeners[event] = _listeners[event].filter((l) => l !== cb);
    },
    // Legacy send / sendAsync
    send(method, params) {
      return this.request({ method, params });
    },
    sendAsync(req, cb) {
      this.request(req).then((r) => cb(null, { id: 1, jsonrpc: "2.0", result: r })).catch((e) => cb(e, null));
    },
    enable() {
      return this.request({ method: "eth_requestAccounts", params: [] });
    },
    // EIP-6963 identity
    _isMagicMoney: true
  };
}
function makeSolanaProvider() {
  return {
    isMagicMoney: true,
    isConnected: false,
    publicKey: null,
    connect() {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "web3:solana:connect", args: [] },
          (res) => {
            if (!(res == null ? void 0 : res.ok)) {
              reject(new Error((res == null ? void 0 : res.error) ?? "Connect failed"));
              return;
            }
            const pk = res.result;
            this.publicKey = pk;
            this.isConnected = true;
            resolve({ publicKey: { toBase58: () => pk, toString: () => pk } });
          }
        );
      });
    },
    signMessage(message) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "web3:solana:sign", args: [Array.from(message)] },
          (res) => {
            if (!(res == null ? void 0 : res.ok)) {
              reject(new Error((res == null ? void 0 : res.error) ?? "Sign failed"));
              return;
            }
            resolve({ signature: new Uint8Array(res.result) });
          }
        );
      });
    }
  };
}
window.ethereum = makeEthProvider();
window.solana = makeSolanaProvider();
window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
  detail: {
    info: { uuid: "magicmoney-wallet", name: "MagicMoney Wallet", icon: "", rdns: "info.chainlens.magicmoney" },
    provider: window.ethereum
  }
}));
