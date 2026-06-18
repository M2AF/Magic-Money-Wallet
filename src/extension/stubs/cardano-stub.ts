// Cardano is not available in the browser extension — it requires a native
// Node.js addon (@emurgo/cardano-serialization-lib-nodejs).
// All exports return stubs so the bundle compiles; Cardano operations will fail
// at runtime with a clear error message.

export function rootKeyFromEntropy(_entropy: Uint8Array) { return null }

export function deriveCardanoAddress(_entropy: Uint8Array, _accountIndex = 0): string { return '' }
export function deriveCardanoStakeAddress(_entropy: Uint8Array, _accountIndex = 0): string { return '' }

export interface CardanoSpendingKey {
  kL: Uint8Array; kR: Uint8Array; pubKey: Uint8Array
}

export function getCardanoSpendingKey(_entropy: Uint8Array, _accountIndex = 0): CardanoSpendingKey {
  throw new Error('Cardano is not supported in the browser extension')
}

export function cardanoSign(_msg: Uint8Array, _kL: Uint8Array, _kR: Uint8Array): Uint8Array {
  throw new Error('Cardano is not supported in the browser extension')
}

export interface CardanoUtxo {
  txHash: string; txIndex: number; amount: string; address: string
}

export interface CardanoTxResult { txHex: string; fee: string }

export function buildCardanoTx(
  _inputs: CardanoUtxo[], _toAddress: string, _changeAddress: string,
  _lovelaceAmount: bigint, _spendingKey: CardanoSpendingKey, _ttl: number
): CardanoTxResult {
  throw new Error('Cardano is not supported in the browser extension')
}

export function decodeCardanoAddress(_addr: string): Uint8Array {
  throw new Error('Cardano is not supported in the browser extension')
}
