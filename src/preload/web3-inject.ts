/**
 * web3-inject.ts — MagicMoney Wallet preload (dApp browser)
 *
 * Injects window.ethereum (EIP-1193), window.solana, window.cardano (CIP-30),
 * and Solana Wallet Standard into dApp pages loaded inside the Electron built-in browser.
 *
 * ethereum / solana — webFrame.executeJavaScript (main world plain object)
 *   dApps and wallet selectors inspect the page's own window, so provider
 *   objects must be created there. contextBridge is only used for IPC relay.
 *
 * cardano — webFrame.executeJavaScript (main world plain object)
 *   contextBridge proxies have null prototypes that many dApp wallet scanners
 *   reject via instanceof / constructor checks. Injecting as a plain object in
 *   the main world gives a normal prototype chain that passes all checks.
 *
 * Solana Wallet Standard — webFrame.executeJavaScript (async, main world)
 *   Must dispatch CustomEvents in the page's main world so wallet-standard
 *   listeners inside the dApp's own JS context receive them.
 */

import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { WALLET_ICON as _ICON_IMPORT } from './wallet-icon'

// ── IPC relay exposed to main world ──────────────────────────────────────────
// Only needs to pass primitive/array args and return Promises — no function objects.

contextBridge.exposeInMainWorld('__mmBridge__', {
  call: (channel: string, args: unknown[]) => ipcRenderer.invoke(channel, ...args)
})

// ── Main → page event bridge ─────────────────────────────────────────────────
// The injected providers live in the page's main world and listen for
// `__mm:'main→page:event'` window messages (e.g. EIP-1193 chainChanged). The
// main process emits these over the `web3:event` IPC channel; re-post them into
// the main world via postMessage (delivered to all worlds of this frame).
ipcRenderer.on('web3:event', (_e, payload: { chain: string; event: string; data: unknown }) => {
  webFrame.executeJavaScript(
    `window.postMessage(${JSON.stringify({ __mm: 'main→page:event', chain: payload.chain, event: payload.event, data: payload.data })}, '*')`
  ).catch(() => { /* page may be navigating */ })
})

// ── Icon constant (used in both webFrame template strings below) ─────────────

const _ICON = _ICON_IMPORT
const _ICON_JSON = JSON.stringify(_ICON)

// ── Solana Wallet Standard + Cardano (main-world injection) ──────────────────
// webFrame.executeJavaScript runs in the dApp's main JS context giving plain
// objects with normal prototype chains — needed for both Cardano (so dApp wallet
// scanners accept it) and Solana Wallet Standard (event dispatch in main world).

webFrame.executeJavaScript(`(function () {
  const call = (ch, ...a) => window.__mmBridge__.call(ch, a);

  if (window.__MAGICMONEY_WEB3_INJECTED__) return;
  Object.defineProperty(window, '__MAGICMONEY_WEB3_INJECTED__', {
    value: true, configurable: false, enumerable: false
  });

  // ── EIP-1193 + EIP-6963 EVM provider ───────────────────────────────────
  try {
    const _ethListeners = {};
    function _ethOn(event, cb) {
      if (typeof cb !== 'function') return;
      if (!_ethListeners[event]) _ethListeners[event] = [];
      _ethListeners[event].push(cb);
    }
    function _ethRemove(event, cb) {
      if (!_ethListeners[event]) return;
      _ethListeners[event] = _ethListeners[event].filter(l => l !== cb);
    }
    function _ethEmit(event, ...args) {
      for (const cb of _ethListeners[event] ?? []) {
        try { cb(...args); } catch (e) { setTimeout(() => { throw e; }); }
      }
    }

    const mmEthereum = {
      isMagicMoney: true,
      chainId: '0x1',
      networkVersion: '1',
      selectedAddress: null,

      request({ method, params } = {}) {
        if (typeof method !== 'string') {
          const err = new Error('Invalid request: missing method');
          err.code = -32600;
          return Promise.reject(err);
        }
        return call('web3:request', { method, params: params ?? [] }).then(result => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
            const accounts = Array.isArray(result) ? result : [];
            mmEthereum.selectedAddress = accounts[0] ?? null;
            _ethEmit('accountsChanged', accounts);
          }
          if (method === 'eth_chainId' && typeof result === 'string') {
            mmEthereum.chainId = result;
            mmEthereum.networkVersion = String(parseInt(result, 16));
          }
          return result;
        }).catch(rawErr => {
          // Electron IPC strips custom error props, so reconstruct an EIP-1193
          // error with the right .code from the (clean) message. dApps switch on
          // error.code (4001 = user rejected) to show the right UX.
          const raw = (rawErr && rawErr.message) || String(rawErr);
          const msg = raw.replace(/^Error invoking remote method '[^']+':\\s*/, '').replace(/^Error:\\s*/, '');
          let code = (rawErr && typeof rawErr.code === 'number') ? rawErr.code : -32603;
          if (/user rejected/i.test(msg)) code = 4001;
          else if (/support(s)? (this )?network|unrecognized chain|not supported/i.test(msg)) code = 4902;
          else if (/connect the wallet before/i.test(msg)) code = 4100;
          const e = new Error(msg);
          e.code = code;
          throw e;
        });
      },

      on(event, cb) { _ethOn(event, cb); return mmEthereum; },
      removeListener(event, cb) { _ethRemove(event, cb); return mmEthereum; },
      send(method, params) { return mmEthereum.request({ method, params }); },
      sendAsync(req, cb) {
        mmEthereum.request(req)
          .then(result => cb(null, { id: req?.id ?? 1, jsonrpc: '2.0', result }))
          .catch(error => cb(error, null));
      },
      enable() { return mmEthereum.request({ method: 'eth_requestAccounts', params: [] }); }
    };

    if (typeof window.ethereum === 'undefined') {
      try { window.ethereum = mmEthereum; } catch (_) {}
    }

    const mmProviderInfo = Object.freeze({
      uuid: 'b3e4f2a1-7c8d-4e9f-a0b1-2c3d4e5f6a7b',
      name: 'MagicMoney Wallet',
      icon: ${_ICON_JSON},
      rdns: 'info.chainlens.magicmoney'
    });

    function announceMagicMoneyProvider() {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info: mmProviderInfo, provider: mmEthereum })
      }));
    }

    announceMagicMoneyProvider();
    window.addEventListener('eip6963:requestProvider', announceMagicMoneyProvider);
    window.dispatchEvent(new Event('ethereum#initialized'));

    // Sync the real active chain (the wallet is multi-chain) so a freshly-loaded
    // dApp reads the correct chainId instead of the static default.
    mmEthereum.request({ method: 'eth_chainId', params: [] }).catch(function () {});

    window.addEventListener('message', event => {
      if (event.source !== window) return;
      const m = event.data;
      if (!m || m.__mm !== 'main→page:event' || m.chain !== 'eth') return;
      if (m.event === 'chainChanged') {
        mmEthereum.chainId = m.data;
        mmEthereum.networkVersion = String(parseInt(m.data, 16));
      }
      if (m.event === 'accountsChanged') {
        mmEthereum.selectedAddress = (m.data ?? [])[0] ?? null;
      }
      _ethEmit(m.event, m.data);
    });
  } catch(e) { console.error('[MagicMoney] EVM injection failed:', e); }

  // ── Legacy Solana provider (plain object in page main world) ───────────
  try {
    if (typeof window.solana === 'undefined') {
      window.solana = {
        isMagicMoney: true,
        isConnected: false,
        publicKey: null,
        connect() {
          return call('web3:solana-connect').then(pk => {
            const key = { toBase58: () => pk, toString: () => pk };
            this.publicKey = key;
            this.isConnected = true;
            return { publicKey: key };
          });
        },
        disconnect() {
          this.publicKey = null;
          this.isConnected = false;
          return Promise.resolve();
        },
        signMessage(message) {
          return call('web3:solana-sign-message', Array.from(message))
            .then(sig => ({ signature: new Uint8Array(sig) }));
        },
        signTransaction(transaction) {
          let bytes;
          if (transaction && typeof transaction.serialize === 'function') {
            bytes = Array.from(transaction.serialize({ requireAllSignatures: false }));
          } else if (transaction instanceof Uint8Array) {
            bytes = Array.from(transaction);
          } else {
            return Promise.reject(new Error('Cannot serialize transaction'));
          }
          return call('web3:solana-sign-tx', bytes).then(signed => new Uint8Array(signed));
        },
        signAllTransactions(transactions) {
          return Promise.all((transactions || []).map(tx => this.signTransaction(tx)));
        },
        signAndSendTransaction(transaction) {
          let bytes;
          if (transaction && typeof transaction.serialize === 'function') {
            bytes = Array.from(transaction.serialize({ requireAllSignatures: false }));
          } else if (transaction instanceof Uint8Array) {
            bytes = Array.from(transaction);
          } else {
            return Promise.reject(new Error('Cannot serialize transaction'));
          }
          return call('web3:solana-sign-and-send', { transaction: bytes });
        },
        on() {},
        removeListener() {}
      };
    }
  } catch(e) { console.error('[MagicMoney] Solana legacy injection failed:', e); }

  // ── Cardano CIP-30 (plain object — passes instanceof / constructor checks) ─
  try {
    const fullApi = () => ({
      getNetworkId:       ()                   => call('cardano:get-network-id'),
      getBalance:         ()                   => call('cardano:get-balance'),
      getUtxos:           ()                   => call('cardano:get-utxos'),
      getUsedAddresses:   ()                   => call('cardano:get-used-addresses'),
      getUnusedAddresses: ()                   => call('cardano:get-unused-addresses'),
      getChangeAddress:   ()                   => call('cardano:get-change-address'),
      getRewardAddresses: ()                   => call('cardano:get-reward-addresses'),
      signTx:   (tx, partial)                  => call('cardano:sign-tx', tx, !!partial),
      signData: (addr, payload)                => call('cardano:sign-data', addr, payload),
      submitTx: (tx)                           => call('cardano:submit-tx', tx),
    });
    const mmWallet = {
      apiVersion: '0.1.0',
      name:       'MagicMoney Wallet',
      icon:       ${_ICON_JSON},
      isEnabled:  () => call('cardano:is-enabled').catch(() => false),
      enable:     () => call('cardano:enable').then(() => fullApi()),
    };
    if (!window.cardano || typeof window.cardano !== 'object') {
      Object.defineProperty(window, 'cardano', { value: {}, writable: true, configurable: true, enumerable: true });
    }
    try {
      window.cardano.magicmoney = mmWallet;
    } catch (_) {
      Object.defineProperty(window.cardano, 'magicmoney', {
        value: mmWallet, writable: true, configurable: true, enumerable: true
      });
    }
    // Trigger CIP-30 wallet scanners (e.g. Weld) that listen on focus/visibilitychange
    // to re-scan window.cardano after our injection. Weld sets up these listeners on
    // store init and uses them to refresh the wallet list.
    setTimeout(function() {
      try { window.dispatchEvent(new Event('focus')); } catch (_) {}
    }, 200);
  } catch(e) { console.error('[MagicMoney] Cardano injection failed:', e); }

  // ── Solana Wallet Standard ────────────────────────────────────────────────
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58Decode(s) {
    const bytes = [0];
    for (const c of s) {
      let carry = B58.indexOf(c);
      for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
      while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (const c of s) { if (c === '1') bytes.push(0); else break; }
    return new Uint8Array(bytes.reverse());
  }

  let _wsAddr = null, _wsPubKey = null;
  const _wsListeners = {};
  function _wsEmit(evt, data) {
    for (const cb of _wsListeners[evt] ?? []) { try { cb(data); } catch {} }
  }
  function _wsAccount() {
    return { address: _wsAddr, publicKey: _wsPubKey,
             chains: ['solana:mainnet', 'solana:devnet'],
             features: ['standard:connect','standard:disconnect','standard:events',
                        'solana:signAndSendTransaction','solana:signTransaction','solana:signMessage'] };
  }

  const _wsMM = {
    version: '1.0.0', name: 'MagicMoney Wallet', icon: ${_ICON_JSON},
    chains: ['solana:mainnet', 'solana:devnet'],
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect({ silent = false } = {}) {
          if (silent && !_wsAddr) return Promise.resolve({ accounts: [] });
          return call('web3:solana-connect').then(pk => {
            _wsAddr = pk; _wsPubKey = b58Decode(pk);
            const sol = window.solana;
            if (sol) { sol.publicKey = { toBase58: () => pk, toString: () => pk }; sol.isConnected = true; }
            _wsEmit('change', { accounts: [_wsAccount()] });
            return { accounts: [_wsAccount()] };
          });
        }
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect() {
          _wsAddr = null; _wsPubKey = null;
          if (window.solana) { window.solana.publicKey = null; window.solana.isConnected = false; }
          _wsEmit('change', { accounts: [] });
          return Promise.resolve();
        }
      },
      'standard:events': {
        version: '1.0.0',
        on(evt, cb) {
          if (!_wsListeners[evt]) _wsListeners[evt] = [];
          _wsListeners[evt].push(cb);
          return () => { _wsListeners[evt] = (_wsListeners[evt] ?? []).filter(l => l !== cb); };
        }
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0', supportedTransactionVersions: ['legacy', 0],
        // Wallet Standard: accept N inputs, return N outputs as an ARRAY of
        // { signature: Uint8Array }. The dApp reads result[0].signature.
        signAndSendTransaction(...inputs) {
          return Promise.all(inputs.map(input =>
            call('web3:solana-sign-and-send', { transaction: Array.from(input.transaction) })
              .then(res => ({ signature: b58Decode(res.signature) }))
          ));
        }
      },
      'solana:signTransaction': {
        version: '1.0.0', supportedTransactionVersions: ['legacy', 0],
        // Sign only — return N outputs as an ARRAY of { signedTransaction: Uint8Array }.
        signTransaction(...inputs) {
          return Promise.all(inputs.map(input =>
            call('web3:solana-sign-tx', Array.from(input.transaction))
              .then(signed => ({ signedTransaction: new Uint8Array(signed) }))
          ));
        }
      },
      'solana:signMessage': {
        version: '1.0.0',
        // Wallet Standard: accept N inputs, return N outputs as an ARRAY.
        // Returning a single object made dApps read result[0] as undefined →
        // "Wallet error occurred" and a retry (the second popup).
        signMessage(...inputs) {
          return Promise.all(inputs.map(input =>
            call('web3:solana-sign-message', Array.from(input.message)).then(sig => ({
              signedMessage: input.message,
              signature: new Uint8Array(sig),
              signatureType: 'ed25519'
            }))
          ));
        }
      },
    },
    get accounts() { return _wsAddr ? [_wsAccount()] : []; }
  };

  function _regWS() {
    try {
      // detail receives register as a plain function — NOT { register }
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', {
        detail: register => register(_wsMM)
      }));
    } catch {}
  }
  _regWS();
  // wallet-standard:app-ready: detail may be { register } or registerFn or WalletsWindow
  window.addEventListener('wallet-standard:app-ready', e => {
    try {
      const d = e.detail;
      if (typeof d?.register === 'function') d.register(_wsMM);
      else if (typeof d === 'function') d(_wsMM);
      else _regWS();
    } catch {}
  });
})();`, false)
