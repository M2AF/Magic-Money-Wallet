import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
export async function installApeFixture(page:Page,options={balance:1,ids:['6637']}){
  await page.context().route('https://api.koios.rest/api/v1/account_assets?*',route=>route.fulfill({json:[]}))
  await page.context().route('https://api.koios.rest/api/v1/address_assets?*',route=>{
    const address=route.request().postDataJSON()._addresses[0]
    return route.fulfill({json:[{address,policy_id:'901ba6e9831b078e131a1cc403d6139af21bda255cea6c9f770f4834',asset_name:'01',quantity:'1'}]})
  })
  await page.route('https://rpc.monad.xyz/',route=>{
    const call=route.request().postDataJSON(),data=call.params[0]?.data || ''
    const result=call.method==='eth_chainId'?'0x8f':call.method==='eth_blockNumber'?'0xabc':'0x'+(data.startsWith('0x313ce567')?18n:data.startsWith('0x01ffc9a7')?1n:10_000n*10n**18n).toString(16).padStart(64,'0')
    return route.fulfill({json:{jsonrpc:'2.0',id:call.id,result}})
  })
  await page.route('**/api/theme-holder/mallard?*',route=>route.fulfill({json:{address:new URL(route.request().url()).searchParams.get('address'),policy:'901ba6e9831b078e131a1cc403d6139af21bda255cea6c9f770f4834',quantity:'1'}}))
  const control={...options,fail:false,owner:'0x1111111111111111111111111111111111111111'}
  const word=(n:bigint)=>'0x'+n.toString(16).padStart(64,'0')
  await page.route('https://ethereum-rpc.publicnode.com/',route=>{
    if(control.fail)return route.fulfill({status:503,body:'Offline'})
    const call=route.request().postDataJSON(),data=call.params?.[0]?.data || ''
    let result=call.method==='eth_chainId'?'0x1':call.method==='eth_blockNumber'?'0xabc':word(0n)
    if(data.startsWith('0x70a08231')){control.owner='0x'+data.slice(-40);result=word(BigInt(control.balance))}
    if(data.startsWith('0x6352211e'))result='0x'+control.owner.slice(2).padStart(64,'0')
    if(data.startsWith('0xc87b56dd')){
      const id=BigInt('0x'+data.slice(10)).toString(),meta={name:id==='6637'?'Roch Edwards':'Second Ape',image:`ipfs://bafyfixture/${id}.jpg`}
      const uri='data:application/json;base64,'+Buffer.from(JSON.stringify(meta)).toString('base64'),b=Buffer.from(uri)
      result=word(32n)+word(BigInt(b.length)).slice(2)+b.toString('hex').padEnd(Math.ceil(b.length/32)*64,'0')
    }
    return route.fulfill({json:{jsonrpc:'2.0',id:call.id,result}})
  })
  await page.route('https://eth.blockscout.com/api/v2/tokens/**',route=>route.fulfill({json:{items:control.ids.map(id=>({id})),next_page_params:null}}))
  const portrait=readFileSync(resolve('src/renderer/assets/themes/ape-society/portrait.png'))
  await page.route('**/ipfs/bafyfixture/**',route=>route.fulfill({contentType:'image/png',body:portrait}))
  return control
}
