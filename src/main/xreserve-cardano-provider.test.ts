/**
 * The Blockfrost / Circle adapter, with injected fetch functions only: no
 * network, no credentials. Response shapes are the ones measured through the
 * wallet's proxy on 2026-09-29 for the public deposit in
 * docs/XRESERVE-GATE2-RESEARCH.md, embedded below.
 */
import { describe, it, expect } from 'vitest'
import {
  createBlockfrostLocatorReader, createBlockfrostAuditReader, blockfrostMintReads, fetchXReserveAttestation,
  ProviderFault, XRESERVE_ATTESTATIONS_URL, type BlockfrostFetchFn,
} from './xreserve-cardano-provider'
import { CardanoReaderError, locateXReserveCardanoMint, startMintScanCursor } from './xreserve-cardano-mint-locator'
import { AuditReaderError, auditXReserveCardanoMint, startMintAuditCursor, AUDITED_ASSET_UNIT } from './xreserve-cardano-mint-audit'
import type { WalletConfig } from './secure-store'

/** GET https://xreserve-api.circle.com/v1/attestations?txHash=0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2, recorded 2026-09-27 23:49 UTC. */
const CIRCLE_RESPONSE = {
  "attestations": [
    {
      "remoteDomain": 10004,
      "payload": "0x5a2e0acd0000000100000000000000000000000000000000000000000000000000000000713f8ff9000027149ea9794d33dbcef3f77718e903816e877ab2577f4d7ee653638f1f60fc671dd6000000011c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000d0402a74d8d05e7c4a78e5e01fed14f94c0f486300000000000000000000000000000000000000000000000000000000009896801a2546a6091864db9d016e6588a48d31b706c8c8becb903b1aac6e811e7f70a90000005f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "messageHash": "0x2630e4dcac36445673096a668c29fc06b0b0ec89f058dcbb5aa2097b3a752c69",
      "attestation": "0x511b4362647330a3222f480b8e9cc4b3435241f006d039eb787423ee7e35751c466670f08add272632d703bff1f70fe9439d2494bf6da42953603be47cdacac31c"
    }
  ]
}

/** Koios tx_cbor for Cardano tx 24da9d4f5348c67d578ba18408df63c22c64e5468b3ea6b15797a5b4db1f2379 (block 13989038), recorded 2026-09-27. */
const MINT_TX_HASH = '24da9d4f5348c67d578ba18408df63c22c64e5468b3ea6b15797a5b4db1f2379'
const MINT_TX_CBOR = [
  '84aa00d9010282825820b670cab9f262f6e7556ec5d245f641dad4dc3f576b927f9060e0718773f7905504825820c3a2772e',
  '621b2c06002887d04de0a2f4aa6615abfc6813ae302a0d51357dbc9e02018582581d611c75c5b878c190e7861f938a23e8d1',
  'c6914fc23f5df9058d678363c9821a000fd976a1581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34',
  'a14555534443781a713f8ff8825839017a9aee035f6eff7dd56b4078b497a63853438dffe51611a36d6eee61c8ab0b510424',
  '0cfa85aed8265cef4982cd9dcbc5b0c444ddc689dada821a00116d86a1581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe41',
  '4147860d557cac7e34a145555344437801a300583911a3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b658',
  '20c8b6203b361ed6ac9f74718b83c23b5f9b4a1de9923f2b96e521b601821a00167de4a1581ca3d5052864638828bc3fbc0d',
  '5b9a4223e233620d7911a5376ed4b658a14001028201d81858499f58201a03b7fef85a9d485c8b0abfccedd8acaf8c056ad4',
  '5f0017e59ef93f94a7f51e58201a2546a6091864db9d016e6588a48d31b706c8c8becb903b1aac6e811e7f70a9d87a80ffa3',
  '00583911a3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b65820c8b6203b361ed6ac9f74718b83c23b5f9b',
  '4a1de9923f2b96e521b601821a00167de4a1581ca3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b658a140',
  '01028201d81858499f58201a2546a6091864db9d016e6588a48d31b706c8c8becb903b1aac6e811e7f70a958201a3ca7f5a5',
  'c642408519ee8aa8a065baf87d8f15d72214ddb52f1056a56e724ad87a80ff82583901cd742f544cdf6a90d8b6c780ffd9c1',
  'c36239ddb9f08bc84eeb962c9920c8b6203b361ed6ac9f74718b83c23b5f9b4a1de9923f2b96e521b61b0000000115a84ee0',
  '021a0005f35405a1581df1d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b0009a2581c1f3aec8bfe7e',
  'a4fe14c5f121e2a92e301afe414147860d557cac7e34a14555534443781a713f8ff9581ca3d5052864638828bc3fbc0d5b9a',
  '4223e233620d7911a5376ed4b658a140010b58203afccb970b9a553373dfcd44ab1ca7967ea87fae68942b931ebaa03d991d',
  '9cd80dd9010281825820b670cab9f262f6e7556ec5d245f641dad4dc3f576b927f9060e0718773f79055041082583901cd74',
  '2f544cdf6a90d8b6c780ffd9c1c36239ddb9f08bc84eeb962c9920c8b6203b361ed6ac9f74718b83c23b5f9b4a1de9923f2b',
  '96e521b61b0000000115dd1a16111a0008ecfe12d901028482582076e8e5a5eb9ae1562b7c6afb042037f76c4b097c9857e9',
  '5c9285a07c5e612ffa0082582086c9f9a54f11627a3b4c0b9577d0a5074eb366b08555192c1d6213239e2854e10082582086',
  'c9f9a54f11627a3b4c0b9577d0a5074eb366b08555192c1d6213239e2854e102825820d722c14b023979e92aae51978d9ead',
  '239ef3f94dc7131939d6a78a10c06eefc700a200d90102818258205ac220baf99a6688d9c285f22685ca1169c3683b1c9323',
  '5388700b220a17aa925840245484527d76e2b362cee9e5e4780293224bec965f496a1e0389ce0bc2d31543e92561f293dc3b',
  '6832d8b498ffe30105217698e37f64b9d19e8a3603a229820605a482000182d879808219a0ae1a00ee46a782010082d87980',
  '82198f191a00e27dba82010182d87a808219a7d21a00f866f082030082d8799f9f5f58405a2e0acd00000001000000000000',
  '00000000000000000000000000000000000000000000713f8ff9000027149ea9794d33dbcef3f77718e903816e877ab2577f',
  '58404d7ee653638f1f60fc671dd6000000011c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c900000000',
  '0000000000000000a0b86991c6218b365840c1d19d4a2e9eb0ce3606eb48000000000000000000000000d0402a74d8d05e7c',
  '4a78e5e01fed14f94c0f4863000000000000000000000000000000000000000058400000000000000000009896801a2546a6',
  '091864db9d016e6588a48d31b706c8c8becb903b1aac6e811e7f70a90000005f000000000000000000000000000000005840',
  '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  '00000000000000000000000000004f000000000000000000000000000000ff5f5840511b4362647330a3222f480b8e9cc4b3',
  '435241f006d039eb787423ee7e35751c466670f08add272632d703bff1f70fe9439d2494bf6da42953603be47cdacac3411c',
  'ffff0000010101ff821a0006153b1a0c89eefaf5f6',
].join('')

/** Koios tx_utxos outputs for the same transaction, normalized. */
const MINT_TX_OUTPUTS = [
  {
    "index": 0,
    "address": "addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax",
    "lovelace": "1038710",
    "assets": [
      {
        "unit": "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378",
        "quantity": "1899991032"
      }
    ]
  },
  {
    "index": 1,
    "address": "addr1q9af4msrtah07lw4ddq83dyh5cu9xsudllj3vydrd4hwucwg4v94zppypnagttkcyeww7jvzekwuh3dsc3zdm35fmtdq06agkg",
    "lovelace": "1142150",
    "assets": [
      {
        "unit": "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378",
        "quantity": "1"
      }
    ]
  },
  {
    "index": 2,
    "address": "addr1zx3a2pfgv33cs29u877q6ku6gg37yvmzp4u3rffhdm2tvkpqezmzqwekrmt2e8m5wx9c8s3mt7d5580fjgljh9h9yxmqttz40t",
    "lovelace": "1474020",
    "assets": [
      {
        "unit": "a3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b658",
        "quantity": "1"
      }
    ]
  },
  {
    "index": 3,
    "address": "addr1zx3a2pfgv33cs29u877q6ku6gg37yvmzp4u3rffhdm2tvkpqezmzqwekrmt2e8m5wx9c8s3mt7d5580fjgljh9h9yxmqttz40t",
    "lovelace": "1474020",
    "assets": [
      {
        "unit": "a3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b658",
        "quantity": "1"
      }
    ]
  },
  {
    "index": 4,
    "address": "addr1q8xhgt65fn0k4yxckmrcpl7ec8pkywwah8cghjzwawtzexfqezmzqwekrmt2e8m5wx9c8s3mt7d5580fjgljh9h9yxmqfnz6cg",
    "lovelace": "4658319072",
    "assets": []
  }
]
/** Blockfrost GET txs/24da9d4f�/utxos, recorded read-only 2026-09-29 through the wallet's proxy (datums dropped).
 * Note output 5: the UNREALIZED collateral return, listed with collateral: true for a VALID transaction. */
const BF_MINT_UTXOS = {
 "hash": "24da9d4f5348c67d578ba18408df63c22c64e5468b3ea6b15797a5b4db1f2379",
 "inputs": [
  {
   "address": "addr1w8fv8anv93c4fk0shyf7u0xekz39hwmaz5me20tuxmq8apsgzpnyy",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "2801500"
    },
    {
     "unit": "49b5b45b3b600416fee318dc34d9660ebb3a759fbd2db683fef641ff555344435850726f746f636f6c506172616d6574657273",
     "quantity": "1"
    }
   ],
   "tx_hash": "76e8e5a5eb9ae1562b7c6afb042037f76c4b097c9857e95c9285a07c5e612ffa",
   "output_index": 0,
   "collateral": false,
   "reference": true
  },
  {
   "address": "addr1wxduzjkjzn7lu807ms9gqkeh5xzgc6mwf7yewryt0vkwgzqzlkc89",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "2926490"
    },
    {
     "unit": "9bc14ad214fdfe1dfedc0a805b37a1848c6b6e4f89970c8b7b2ce4081f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34",
     "quantity": "1"
    }
   ],
   "tx_hash": "86c9f9a54f11627a3b4c0b9577d0a5074eb366b08555192c1d6213239e2854e1",
   "output_index": 0,
   "collateral": false,
   "reference": true
  },
  {
   "address": "addr1wxduzjkjzn7lu807ms9gqkeh5xzgc6mwf7yewryt0vkwgzqzlkc89",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "5572830"
    },
    {
     "unit": "9bc14ad214fdfe1dfedc0a805b37a1848c6b6e4f89970c8b7b2ce408a3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b658",
     "quantity": "1"
    }
   ],
   "tx_hash": "86c9f9a54f11627a3b4c0b9577d0a5074eb366b08555192c1d6213239e2854e1",
   "output_index": 2,
   "collateral": false,
   "reference": true
  },
  {
   "address": "addr1wxduzjkjzn7lu807ms9gqkeh5xzgc6mwf7yewryt0vkwgzqzlkc89",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "26450470"
    },
    {
     "unit": "9bc14ad214fdfe1dfedc0a805b37a1848c6b6e4f89970c8b7b2ce408d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b",
     "quantity": "1"
    }
   ],
   "tx_hash": "d722c14b023979e92aae51978d9ead239ef3f94dc7131939d6a78a10c06eefc7",
   "output_index": 0,
   "collateral": false,
   "reference": true
  },
  {
   "address": "addr1q8xhgt65fn0k4yxckmrcpl7ec8pkywwah8cghjzwawtzexfqezmzqwekrmt2e8m5wx9c8s3mt7d5580fjgljh9h9yxmqfnz6cg",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "4662363924"
    }
   ],
   "tx_hash": "b670cab9f262f6e7556ec5d245f641dad4dc3f576b927f9060e0718773f79055",
   "output_index": 4,
   "collateral": false,
   "reference": false
  },
  {
   "address": "addr1zx3a2pfgv33cs29u877q6ku6gg37yvmzp4u3rffhdm2tvkzuds90umjlesfs86mzwgp5xwaz2eye6kd0azzgly8quv7s6a7wz3",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "1474020"
    },
    {
     "unit": "a3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b658",
     "quantity": "1"
    }
   ],
   "tx_hash": "c3a2772e621b2c06002887d04de0a2f4aa6615abfc6813ae302a0d51357dbc9e",
   "output_index": 2,
   "collateral": false,
   "reference": false
  },
  {
   "address": "addr1q8xhgt65fn0k4yxckmrcpl7ec8pkywwah8cghjzwawtzexfqezmzqwekrmt2e8m5wx9c8s3mt7d5580fjgljh9h9yxmqfnz6cg",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "4662363924"
    }
   ],
   "tx_hash": "b670cab9f262f6e7556ec5d245f641dad4dc3f576b927f9060e0718773f79055",
   "output_index": 4,
   "collateral": true,
   "reference": false
  }
 ],
 "outputs": [
  {
   "address": "addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "1038710"
    },
    {
     "unit": "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378",
     "quantity": "1899991032"
    }
   ],
   "output_index": 0,
   "collateral": false,
   "consumed_by_tx": "0db61d46c5a5a2f2ef7b40e3f164f3255e2783fb053c49c04ae28d586e289cbf"
  },
  {
   "address": "addr1q9af4msrtah07lw4ddq83dyh5cu9xsudllj3vydrd4hwucwg4v94zppypnagttkcyeww7jvzekwuh3dsc3zdm35fmtdq06agkg",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "1142150"
    },
    {
     "unit": "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378",
     "quantity": "1"
    }
   ],
   "output_index": 1,
   "collateral": false,
   "consumed_by_tx": null
  },
  {
   "address": "addr1zx3a2pfgv33cs29u877q6ku6gg37yvmzp4u3rffhdm2tvkpqezmzqwekrmt2e8m5wx9c8s3mt7d5580fjgljh9h9yxmqttz40t",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "1474020"
    },
    {
     "unit": "a3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b658",
     "quantity": "1"
    }
   ],
   "output_index": 2,
   "collateral": false,
   "consumed_by_tx": null
  },
  {
   "address": "addr1zx3a2pfgv33cs29u877q6ku6gg37yvmzp4u3rffhdm2tvkpqezmzqwekrmt2e8m5wx9c8s3mt7d5580fjgljh9h9yxmqttz40t",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "1474020"
    },
    {
     "unit": "a3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b658",
     "quantity": "1"
    }
   ],
   "output_index": 3,
   "collateral": false,
   "consumed_by_tx": null
  },
  {
   "address": "addr1q8xhgt65fn0k4yxckmrcpl7ec8pkywwah8cghjzwawtzexfqezmzqwekrmt2e8m5wx9c8s3mt7d5580fjgljh9h9yxmqfnz6cg",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "4658319072"
    }
   ],
   "output_index": 4,
   "collateral": false,
   "consumed_by_tx": "ea02c667ce4c51dd189529bc7b3f3efb5839bac0d6169ba9179a828538c06ccb"
  },
  {
   "address": "addr1q8xhgt65fn0k4yxckmrcpl7ec8pkywwah8cghjzwawtzexfqezmzqwekrmt2e8m5wx9c8s3mt7d5580fjgljh9h9yxmqfnz6cg",
   "amount": [
    {
     "unit": "lovelace",
     "quantity": "4661778966"
    }
   ],
   "output_index": 5,
   "collateral": true,
   "consumed_by_tx": null
  }
 ]
}

const SOURCE = '0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2'
const RECIPIENT = 'addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax'
const MINT_HEIGHT = 13989038
const SECRET = 'mainnetSECRETkeyDoNotLeak0123456789'
const CONFIG = { blockfrostKey: SECRET, swapProxyUrl: '', clientToken: '' } as unknown as WalletConfig

type Route = { status: number; body?: unknown } | 'throw'

/** A fake blockfrostFetch: routes by exact path, records every request. */
function fakeBlockfrost(routes: Record<string, Route>) {
  const calls: string[] = []
  const fn: BlockfrostFetchFn = async (path) => {
    calls.push(path)
    const r = routes[path]
    if (r === 'throw') throw new Error(`fetch https://cardano-mainnet.blockfrost.io/api/v0/${path} project_id=${SECRET} timed out`)
    if (!r) return new Response(JSON.stringify({ status_code: 404, message: 'The requested component has not been found.' }), { status: 404 })
    return new Response(r.body === undefined ? 'not json' : JSON.stringify(r.body), { status: r.status })
  }
  return { fn, calls }
}
const reads = (routes: Record<string, Route>) => {
  const f = fakeBlockfrost(routes)
  return { r: blockfrostMintReads({ config: CONFIG, blockfrostFetch: f.fn }), calls: f.calls }
}
const addrPath = (from: string, count = 21) => `addresses/${RECIPIENT}/transactions?order=asc&count=${count}&page=1&from=${from}`
const assetPath = (from: string, count = 21) => `assets/${AUDITED_ASSET_UNIT}/transactions?order=asc&count=${count}&page=1&from=${from}`
const ROW = { tx_hash: MINT_TX_HASH, tx_index: 0, block_height: MINT_HEIGHT, block_time: 1790393202 }
const TX_META = { hash: MINT_TX_HASH, block: '0d6de991', block_height: MINT_HEIGHT, index: 0, valid_contract: true }

/** Every Blockfrost read the public mint needs, as measured. */
const publicMintRoutes = (from: string, tip = MINT_HEIGHT + 12_000): Record<string, Route> => ({
  [addrPath(from)]: { status: 200, body: [ROW] },
  [assetPath(from)]: { status: 200, body: [ROW] },
  [`txs/${MINT_TX_HASH}`]: { status: 200, body: TX_META },
  [`txs/${MINT_TX_HASH}/cbor`]: { status: 200, body: { cbor: MINT_TX_CBOR } },
  [`txs/${MINT_TX_HASH}/utxos`]: { status: 200, body: BF_MINT_UTXOS },
  'blocks/latest': { status: 200, body: { height: tip, hash: 'x' } },
})

async function faultOf(p: Promise<unknown>): Promise<ProviderFault> {
  try { await p } catch (e) { expect(e).toBeInstanceOf(ProviderFault); return e as ProviderFault }
  throw new Error('expected a failure')
}

describe('history endpoints: inclusive cursor, both kinds, strict rows', () => {
  it('address history: ascending, page 1, inclusive from=block:index, rows mapped', async () => {
    const { r, calls } = reads({ [addrPath('13989038:0')]: { status: 200, body: [ROW] } })
    expect(await r.addressTransactions(RECIPIENT, { blockHeight: MINT_HEIGHT, txIndex: 0 }, 21))
      .toEqual([{ txHash: MINT_TX_HASH, blockHeight: MINT_HEIGHT, txIndex: 0 }])
    expect(calls).toEqual([addrPath('13989038:0')])
  })

  it('asset history uses the unit, with the same inclusive cursor', async () => {
    const { r, calls } = reads({ [assetPath('13989000:3', 5)]: { status: 200, body: [] } })
    expect(await r.assetTransactions(AUDITED_ASSET_UNIT, { blockHeight: 13989000, txIndex: 3 }, 5)).toEqual([])
    expect(calls).toEqual([assetPath('13989000:3', 5)])
  })

  it('an empty 200 is empty history; a 404 is NOT — it is an error', async () => {
    expect(await reads({ [addrPath('1:0')]: { status: 200, body: [] } }).r.addressTransactions(RECIPIENT, { blockHeight: 1, txIndex: 0 }, 21)).toEqual([])
    expect((await faultOf(reads({}).r.addressTransactions(RECIPIENT, { blockHeight: 1, txIndex: 0 }, 21))).kind).toBe('not-found')
    expect((await faultOf(reads({}).r.assetTransactions(AUDITED_ASSET_UNIT, { blockHeight: 1, txIndex: 0 }, 21))).kind).toBe('not-found')
  })

  it('refuses a bad cursor, count, address or unit before any request', async () => {
    const { r, calls } = reads({})
    for (const p of [
      r.addressTransactions(RECIPIENT, { blockHeight: -1, txIndex: 0 }, 21),
      r.addressTransactions(RECIPIENT, { blockHeight: 1, txIndex: 0.5 }, 21),
      r.addressTransactions(RECIPIENT, { blockHeight: 1, txIndex: 0 }, 101),
      r.addressTransactions('addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz', { blockHeight: 1, txIndex: 0 }, 21),
      r.addressTransactions('addr1../../blocks/latest', { blockHeight: 1, txIndex: 0 }, 21),
      r.assetTransactions('USDCx', { blockHeight: 1, txIndex: 0 }, 21),
    ]) expect((await faultOf(p)).kind).toBe('malformed')
    expect(calls).toEqual([])
  })

  it('malformed rows, non-lists and oversized pages are malformed — never empty', async () => {
    const bad = async (body: unknown) => (await faultOf(reads({ [addrPath('1:0')]: { status: 200, body } }).r
      .addressTransactions(RECIPIENT, { blockHeight: 1, txIndex: 0 }, 21))).kind
    expect(await bad({ items: [] })).toBe('malformed')
    expect(await bad([{ tx_hash: 'xyz', tx_index: 0, block_height: 1 }])).toBe('malformed')
    expect(await bad([{ ...ROW, block_height: -5 }])).toBe('malformed')
    expect(await bad(Array.from({ length: 22 }, () => ROW))).toBe('malformed')
    expect((await faultOf(reads({ [addrPath('1:0')]: { status: 200 } }).r.addressTransactions(RECIPIENT, { blockHeight: 1, txIndex: 0 }, 21))).kind).toBe('malformed')
  })
})

describe('confirmed transaction, outputs and tip', () => {
  it('combines txs/{hash} (height) with txs/{hash}/cbor (complete CBOR)', async () => {
    const { r, calls } = reads(publicMintRoutes('0:0'))
    const t = await r.confirmedTransaction(MINT_TX_HASH.toUpperCase())
    expect(t).toEqual({ txHash: MINT_TX_HASH, blockHeight: MINT_HEIGHT, cbor: MINT_TX_CBOR })
    expect(calls).toEqual([`txs/${MINT_TX_HASH}`, `txs/${MINT_TX_HASH}/cbor`])
  })

  it('inconsistent or unconfirmed transaction data is malformed; an unknown hash is not-found', async () => {
    const routes = publicMintRoutes('0:0')
    const withMeta = (meta: unknown) => reads({ ...routes, [`txs/${MINT_TX_HASH}`]: { status: 200, body: meta } }).r.confirmedTransaction(MINT_TX_HASH)
    expect((await faultOf(withMeta({ ...TX_META, hash: 'ab'.repeat(32) }))).kind).toBe('malformed')
    expect((await faultOf(withMeta({ ...TX_META, block_height: null }))).kind).toBe('malformed')
    const badCbor = reads({ ...routes, [`txs/${MINT_TX_HASH}/cbor`]: { status: 200, body: { cbor: 'xyz' } } })
    expect((await faultOf(badCbor.r.confirmedTransaction(MINT_TX_HASH))).kind).toBe('malformed')
    expect((await faultOf(reads({}).r.confirmedTransaction(MINT_TX_HASH))).kind).toBe('not-found')
    expect((await faultOf(reads({}).r.confirmedTransaction('nothex'))).kind).toBe('malformed')
  })

  it('maps outputs, EXCLUDING the unrealized collateral return Blockfrost lists for a valid transaction', async () => {
    expect(BF_MINT_UTXOS.outputs).toHaveLength(6)
    expect(BF_MINT_UTXOS.outputs[5].collateral).toBe(true)
    const outs = await reads(publicMintRoutes('0:0')).r.transactionOutputs(MINT_TX_HASH)
    expect(outs).toEqual(MINT_TX_OUTPUTS)   // the Koios view of the same transaction body
  })

  it('malformed or inconsistent outputs are malformed', async () => {
    const withUtxos = (body: unknown) => reads({ [`txs/${MINT_TX_HASH}/utxos`]: { status: 200, body } }).r.transactionOutputs(MINT_TX_HASH)
    const clone = () => JSON.parse(JSON.stringify(BF_MINT_UTXOS))
    expect((await faultOf(withUtxos({ ...clone(), hash: 'ab'.repeat(32) }))).kind).toBe('malformed')
    const gap = clone(); gap.outputs.splice(1, 1)
    expect((await faultOf(withUtxos(gap))).kind).toBe('malformed')                  // indexes not contiguous
    const noLovelace = clone(); noLovelace.outputs[0].amount = noLovelace.outputs[0].amount.slice(1)
    expect((await faultOf(withUtxos(noLovelace))).kind).toBe('malformed')
    const badQty = clone(); badQty.outputs[0].amount[1].quantity = '1.5'
    expect((await faultOf(withUtxos(badQty))).kind).toBe('malformed')
    const noFlag = clone(); delete noFlag.outputs[0].collateral
    expect((await faultOf(withUtxos(noFlag))).kind).toBe('malformed')
  })

  it('reads the tip height, and refuses a tip without one', async () => {
    expect(await reads({ 'blocks/latest': { status: 200, body: { height: 14001193 } } }).r.tip()).toEqual({ blockHeight: 14001193 })
    expect((await faultOf(reads({ 'blocks/latest': { status: 200, body: { height: 'x' } } }).r.tip())).kind).toBe('malformed')
  })
})

describe('provider failures: classified, retryable by the scanners, and never leaking a key', () => {
  const statusKind: Array<[number, string]> = [[402, 'rate-limited'], [418, 'rate-limited'], [429, 'rate-limited'],
    [403, 'unavailable'], [500, 'unavailable'], [503, 'unavailable'], [404, 'not-found'], [400, 'unavailable']]
  for (const [status, kind] of statusKind) {
    it(`HTTP ${status} → ${kind}`, async () => {
      const f = await faultOf(reads({ 'blocks/latest': { status, body: { error: 'x' } } }).r.tip())
      expect(f.kind).toBe(kind)
      expect(f.message).toContain(`HTTP ${status}`)
    })
  }

  it('a timeout or transport error is unavailable, and its URL/key-bearing message is not echoed', async () => {
    const f = await faultOf(reads({ 'blocks/latest': 'throw' }).r.tip())
    expect(f.kind).toBe('unavailable')
    expect(f.message).not.toContain(SECRET)
    expect(f.message).not.toContain('blockfrost.io')
  })

  it('each scanner receives its OWN error class, so a rate limit is recognised as one', async () => {
    const f = fakeBlockfrost({ 'blocks/latest': { status: 429 } })
    await expect(createBlockfrostLocatorReader({ config: CONFIG, blockfrostFetch: f.fn }).tip())
      .rejects.toSatisfy((e: unknown) => e instanceof CardanoReaderError && e.kind === 'rate-limited')
    await expect(createBlockfrostAuditReader({ config: CONFIG, blockfrostFetch: f.fn }).tip())
      .rejects.toSatisfy((e: unknown) => e instanceof AuditReaderError && e.kind === 'rate-limited')
  })
})

describe('Circle attestation fetch keeps the hash binding', () => {
  const fakeCircle = (status: number, body: unknown, raw = false) => {
    const urls: string[] = []
    return {
      urls,
      fn: async (url: string) => { urls.push(url); return new Response(raw ? String(body) : JSON.stringify(body), { status }) },
    }
  }

  it('requests exactly the source hash and returns it with the response', async () => {
    const c = fakeCircle(200, CIRCLE_RESPONSE)
    const got = await fetchXReserveAttestation(SOURCE.toUpperCase().replace('0X', '0x'), { fetchFn: c.fn })
    expect(c.urls).toEqual([`${XRESERVE_ATTESTATIONS_URL}?txHash=${SOURCE}`])
    expect(got.requestedTxHash).toBe(SOURCE)
    expect(got.response.attestations).toHaveLength(1)
  })

  it('an empty list is Circle\'s own "not yet" and is returned as such', async () => {
    const got = await fetchXReserveAttestation(SOURCE, { fetchFn: fakeCircle(200, { attestations: [] }).fn })
    expect(got).toEqual({ requestedTxHash: SOURCE, response: { attestations: [] } })
  })

  it('HTTP errors, non-JSON and malformed shapes throw — never an empty list', async () => {
    for (const [status, kind] of [[429, 'rate-limited'], [500, 'unavailable'], [404, 'not-found']] as const) {
      expect((await faultOf(fetchXReserveAttestation(SOURCE, { fetchFn: fakeCircle(status, { success: false }).fn }))).kind).toBe(kind)
    }
    expect((await faultOf(fetchXReserveAttestation(SOURCE, { fetchFn: fakeCircle(200, '<html>', true).fn }))).kind).toBe('malformed')
    expect((await faultOf(fetchXReserveAttestation(SOURCE, { fetchFn: fakeCircle(200, { success: true }).fn }))).kind).toBe('malformed')
    expect((await faultOf(fetchXReserveAttestation(SOURCE, { fetchFn: fakeCircle(200, { attestations: ['x'] }).fn }))).kind).toBe('malformed')
    expect((await faultOf(fetchXReserveAttestation(SOURCE, { fetchFn: async () => { throw new Error('boom') } }))).kind).toBe('unavailable')
  })

  it('refuses a malformed source hash without a request', async () => {
    const c = fakeCircle(200, CIRCLE_RESPONSE)
    expect((await faultOf(fetchXReserveAttestation('0x1234', { fetchFn: c.fn }))).kind).toBe('malformed')
    expect(c.urls).toEqual([])
  })
})

describe('end to end with the real scanners and the recorded public mint', () => {
  const approved = { recipient: RECIPIENT, amountRaw: 1_899_991_033n }

  it('the address locator reports minted through this adapter', async () => {
    const cursor = startMintScanCursor(RECIPIENT, SOURCE, { blockHeight: MINT_HEIGHT - 1 })
    const f = fakeBlockfrost(publicMintRoutes(`${MINT_HEIGHT - 1}:0`))
    const attestation = await fetchXReserveAttestation(SOURCE, { fetchFn: async () => new Response(JSON.stringify(CIRCLE_RESPONSE), { status: 200 }) })
    const r = await locateXReserveCardanoMint({ approved, sourceTxHash: SOURCE, attestation, cursor, minConfirmations: 10 },
      createBlockfrostLocatorReader({ config: CONFIG, blockfrostFetch: f.fn }))
    expect(r).toMatchObject({ state: 'minted', candidate: { txHash: MINT_TX_HASH } })
    expect(r.proof).toMatchObject({ creditedRaw: '1899991032' })
  })

  it('the global audit reports minted through this adapter', async () => {
    const cursor = startMintAuditCursor(RECIPIENT, SOURCE, { blockHeight: MINT_HEIGHT - 1 })
    const f = fakeBlockfrost(publicMintRoutes(`${MINT_HEIGHT - 1}:0`))
    const r = await auditXReserveCardanoMint({
      approved, sourceTxHash: SOURCE, attestation: { requestedTxHash: SOURCE, response: CIRCLE_RESPONSE }, cursor, minConfirmations: 10,
    }, createBlockfrostAuditReader({ config: CONFIG, blockfrostFetch: f.fn }))
    expect(r.state).toBe('minted')
  })

  it('with the collateral output NOT excluded, the proof would refuse it — which is why the adapter excludes it', async () => {
    const cursor = startMintScanCursor(RECIPIENT, SOURCE, { blockHeight: MINT_HEIGHT - 1 })
    const raw = fakeBlockfrost(publicMintRoutes(`${MINT_HEIGHT - 1}:0`))
    const reader = createBlockfrostLocatorReader({ config: CONFIG, blockfrostFetch: raw.fn })
    const withCollateral = { ...reader, transactionOutputs: async () => BF_MINT_UTXOS.outputs.map(o => ({
      index: o.output_index, address: o.address,
      lovelace: o.amount.find(a => a.unit === 'lovelace')!.quantity,
      assets: o.amount.filter(a => a.unit !== 'lovelace').map(a => ({ unit: a.unit, quantity: a.quantity })),
    })) }
    const r = await locateXReserveCardanoMint({ approved, sourceTxHash: SOURCE,
      attestation: { requestedTxHash: SOURCE, response: CIRCLE_RESPONSE }, cursor, minConfirmations: 10 }, withCollateral)
    expect(r.state).toBe('unknown')
  })
})
