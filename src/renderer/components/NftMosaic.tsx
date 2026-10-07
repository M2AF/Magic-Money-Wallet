import type { WalletCollectible } from '../types/wallet'
import { canonicalNftKey } from '../../shared/asset-filter-key'
import { useDisplayCurrency } from '../lib/currency'
import { NftImage } from './NftImage'
import './NftMosaic.css'

export function NftMosaic({items,favorites,onToggleFavorite,onSpam,onSelect}: {
  items: WalletCollectible[]; favorites: ReadonlySet<string>
  onToggleFavorite: (id:string)=>void; onSpam: (id:string)=>void; onSelect: (nft:WalletCollectible)=>void
}) {
  const {fmt}=useDisplayCurrency()
  const groups=new Map<string,WalletCollectible[]>()
  for (const nft of items) {
    const key=`${nft.chain}:${nft.contractAddress.toLowerCase() || nft.id}`
    const group=groups.get(key) ?? []; group.push(nft); groups.set(key,group)
  }
  const tiles=[...groups].flatMap(([key,group])=>Array.from({length:Math.ceil(group.length/4)},(_,i)=>({
    key:`${key}:${i}`, items:group.slice(i*4,i*4+4), total:group.length, offset:i*4,
    name:group[0].collectionName || (group.length>1 ? group[0].name.replace(/\s*#\d+.*$/,'') : group[0].name),
  })))
  return <div className="mmw-nft-mosaic">{tiles.map(tile=><article key={tile.key} className={`mmw-mosaic-tile ${tile.items.length===2 ? 'mmw-mosaic-pair' : ''}`}>
    <div className={`mmw-mosaic-quilt mmw-mosaic-quilt-${tile.items.length}`}>
      {tile.items.map(nft=>{
        const key=canonicalNftKey(nft.chain,nft.contractAddress,nft.tokenId)
        return <div className="mmw-mosaic-art" key={key} data-nft-key={key}>
          <NftImage src={nft.thumbnailUrl || nft.image} fallbackSrc={nft.image} imageSources={nft.imageSources} alt={nft.name}/>
          <button type="button" className="mmw-mosaic-open" aria-label={`View ${nft.name}`} onClick={()=>onSelect(nft)}/>
          <button type="button" className="mmw-mosaic-star" aria-label={`${favorites.has(key)?'Unfavorite':'Favorite'} ${nft.name}`} aria-pressed={favorites.has(key)} onClick={()=>onToggleFavorite(key)}>{favorites.has(key)?'★':'☆'}</button>
          <button type="button" className="mmw-mosaic-spam" aria-label={`Mark ${nft.name} as spam`} title="Mark as spam" onClick={()=>onSpam(key)}>🚫</button>
        </div>
      })}
    </div>
    <div className="mmw-mosaic-caption"><strong title={tile.name}>{tile.name}</strong><span>{tile.items[0].usdValue != null ? fmt(tile.items[0].usdValue) : 'Floor unavailable'}</span><span>{tile.items[0].chainLabel} · {tile.total>4 ? `${tile.offset+1}–${tile.offset+tile.items.length} of ${tile.total} items` : `${tile.total} ${tile.total===1?'item':'items'}`}</span></div>
  </article>)}</div>
}
