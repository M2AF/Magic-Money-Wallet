/**
 * web3-inject.ts — MagicMoney Wallet preload (dApp browser)
 *
 * Injects window.ethereum (EIP-1193), window.solana, window.cardano (CIP-30),
 * and Solana Wallet Standard into dApp pages loaded inside the Electron built-in browser.
 *
 * ethereum / solana — contextBridge.exposeInMainWorld (synchronous)
 *   dApps detect these at page load before their own scripts run.
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

// ── EIP-1193 window.ethereum ──────────────────────────────────────────────────

contextBridge.exposeInMainWorld('ethereum', {
  isMetaMask:   true,
  isMagicMoney: true,

  request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
    return ipcRenderer.invoke('web3:request', { method, params: params ?? [] })
  },

  on(event: string, callback: (...args: unknown[]) => void): void {
    ipcRenderer.on(`web3:event:${event}`, (_evt, ...args) => callback(...args))
  },

  removeListener(event: string, callback: (...args: unknown[]) => void): void {
    ipcRenderer.removeListener(`web3:event:${event}`, callback as never)
  },

  send(method: string, params: unknown[]): Promise<unknown> {
    return ipcRenderer.invoke('web3:request', { method, params })
  },

  sendAsync(request: { method: string; params?: unknown[] }, callback: (err: Error | null, response: unknown) => void): void {
    ipcRenderer.invoke('web3:request', request)
      .then(result => callback(null, { id: 1, jsonrpc: '2.0', result }))
      .catch((err: Error) => callback(err, null))
  },

  enable(): Promise<string[]> {
    return ipcRenderer.invoke('web3:request', { method: 'eth_requestAccounts', params: [] }) as Promise<string[]>
  }
})

// ── window.solana ─────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('solana', {
  isMagicMoney: true,
  isConnected:  false,
  publicKey:    null as string | null,

  connect(): Promise<{ publicKey: { toBase58(): string; toString(): string } }> {
    return ipcRenderer.invoke('web3:solana-connect').then((pk: string) => {
      const key = { toBase58: () => pk, toString: () => pk }
      return { publicKey: key }
    })
  },

  disconnect(): Promise<void> { return Promise.resolve() },

  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }> {
    return ipcRenderer.invoke('web3:solana-sign-message', Array.from(message))
      .then((sig: number[]) => ({ signature: new Uint8Array(sig) }))
  },

  on(event: string, callback: (...args: unknown[]) => void): void {
    ipcRenderer.on(`web3:solana:${event}`, (_evt, ...args) => callback(...args))
  }
})

// ── Icon constant (used in both webFrame template strings below) ─────────────

const _ICON = _ICON_IMPORT

// ── Solana Wallet Standard + Cardano (main-world injection) ──────────────────
// webFrame.executeJavaScript runs in the dApp's main JS context giving plain
// objects with normal prototype chains — needed for both Cardano (so dApp wallet
// scanners accept it) and Solana Wallet Standard (event dispatch in main world).

webFrame.executeJavaScript(`(function () {
  const call = (ch, ...a) => window.__mmBridge__.call(ch, a);

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
      icon:       '${_ICON}',
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
                        'solana:signAndSendTransaction','solana:signMessage'] };
  }

  const _wsMM = {
    version: '1.0.0', name: 'MagicMoney Wallet', icon: '${_ICON}',
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
        signAndSendTransaction() { return Promise.reject(new Error('Transaction signing not yet supported in Electron browser')); }
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage({ message }) {
          return call('web3:solana-sign-message', Array.from(message))
            .then(sig => ({ signature: new Uint8Array(sig), signedMessage: message }));
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
