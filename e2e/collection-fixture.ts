import type {Page} from '@playwright/test'
export async function installCollectionFixture(page:Page) {
  const control={balance:10_000n*10n**18n,quantity:'1',sappyBalance:1n,fail:false,stakeOnly:false}
  await page.context().route('https://api.koios.rest/api/v1/account_assets?*',route=>{
    if(control.fail)return route.fulfill({status:503,body:'Offline'})
    const stake_address=route.request().postDataJSON()._stake_addresses[0]
    return route.fulfill({json:control.stakeOnly ? [{stake_address,policy_id:'901ba6e9831b078e131a1cc403d6139af21bda255cea6c9f770f4834',asset_name:'4d616c6c6172644f7264657233333438',quantity:control.quantity}] : []})
  })
  await page.context().route('https://api.koios.rest/api/v1/address_assets?*',route=>{
    const address=route.request().postDataJSON()._addresses[0]
    if(control.fail)return route.fulfill({status:503,body:'Offline'})
    return route.fulfill({json:[{address,policy_id:'901ba6e9831b078e131a1cc403d6139af21bda255cea6c9f770f4834',asset_name:'01',quantity:control.stakeOnly ? '0' : control.quantity}]})
  })
  await page.route('https://ethereum-rpc.publicnode.com/',route=>{
    const call=route.request().postDataJSON()
    if(call.method==='eth_call' && call.params[0]?.to?.toLowerCase()!=='0x364c828ee171616a39897688a831c2499ad972ec')return route.fallback()
    if(control.fail)return route.fulfill({status:503,body:'Offline'})
    const data=call.params[0]?.data||''
    const result=call.method==='eth_chainId'?'0x1':call.method==='eth_blockNumber'?'0xabc':'0x'+(data.startsWith('0x01ffc9a7')?1n:control.sappyBalance).toString(16).padStart(64,'0')
    return route.fulfill({json:{jsonrpc:'2.0',id:call.id,result}})
  })
  await page.route('https://rpc.monad.xyz/',route=>{
    if(control.fail)return route.fulfill({status:503,body:'Offline'})
    const call=route.request().postDataJSON(),data=call.params[0]?.data || ''
    const result=call.method==='eth_chainId'?'0x8f':call.method==='eth_blockNumber'?'0xabc':'0x'+(data.startsWith('0x313ce567')?18n:data.startsWith('0x01ffc9a7')?1n:control.balance).toString(16).padStart(64,'0')
    return route.fulfill({json:{jsonrpc:'2.0',id:call.id,result}})
  })
  await page.route('**/api/theme-holder/mallard?*',route=>control.fail ? route.fulfill({status:503,body:'Offline'}) : route.fulfill({json:{address:new URL(route.request().url()).searchParams.get('address'),policy:'901ba6e9831b078e131a1cc403d6139af21bda255cea6c9f770f4834',quantity:control.quantity}}))
  return control
}
