import {test,expect,chromium} from '@playwright/test'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {stubWorker} from './support/worker-stub-browser'
test.use({actionTimeout:10000})

test('profile NFT picker reuses portfolio, excludes spam, saves hexagon and restores uploaded-photo circle',async()=>{
  test.setTimeout(180000)
  const dist=resolve('dist-extension'),context=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'mm-nft-avatar-')),{headless:false,viewport:{width:400,height:850},args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]})
  await stubWorker(context)
  try {
    const worker=context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'),page=await context.newPage()
    await context.route('https://avatar-art.example/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#d6a9df"/><circle cx="100" cy="100" r="60" fill="#bde8e2"/></svg>'}))
    await page.goto(`chrome-extension://${worker.url().split('/')[2]}/sidepanel.html`)
    await page.getByText('Create New Wallet').click();await expect(page.locator('.seed-grid')).toBeVisible({timeout:15000});await page.getByText('Reveal phrase').click();await page.getByText("I've Written It Down — Continue").click()
    for(const checkbox of await page.locator('input[type=checkbox]').all())await checkbox.check()
    await page.getByRole('button',{name:/Save Wallet/i}).click();await page.getByPlaceholder(/Password \(min/).fill('nft-avatar-test-password');await page.getByPlaceholder('Confirm password').fill('nft-avatar-test-password')
    await page.evaluate(()=>{
      const w=window.wallet,state={reads:0,patches:[] as unknown[],fail:false,profile:{id:'ec18dcf5-3271-46fd-8029-41e5b2f39eed',display_name:'NFT Collector',avatar_url:null as string|null,avatar_nft_key:null as string|null,cl_wallets:[],cl_linked_accounts:[]}}
      ;(window as any).__avatar=state
      localStorage.setItem('mmw_nft_mosaic','true')
      localStorage.setItem('mmw_filters_0',JSON.stringify({'ethereum:n:0x1111111111111111111111111111111111111111:1':{s:'s',t:1},'ethereum:n:0x1111111111111111111111111111111111111111:2':{s:'h',t:1}}))
      w.assetFiltersGet=async()=>({});w.assetFiltersPush=async entries=>({entries,error:null});w.customThemesGet=async()=>({});w.customThemesPush=async entries=>({entries,error:null})
      w.getBalances=async()=>({chains:{},fetchedAt:Date.now()}) as any;w.getHistory=async()=>({});w.getTokens=async()=>({tokens:[],error:null,fetchedAt:Date.now()})
      w.getCollectibles=async()=>{state.reads++;return {items:Array.from({length:40},(_,i)=>({id:'nft-'+i,tokenId:String(i),name:'Seal #'+i,image:'https://avatar-art.example/'+i+'.svg',chain:'ethereum',chainLabel:'Ethereum',chainColor:'#aaa',contractAddress:'0x1111111111111111111111111111111111111111',contractType:'ERC721',traits:[],collectionName:'Seals',floorPrice:1,animationUrl:null,description:null})),error:null,fetchedAt:Date.now(),chainResults:{}}}
      w.chainlensGetProfile=async()=>state.profile as any
      w.chainlensUpdateProfile=async updates=>{if(state.fail)return {success:false,error:'Offline'};state.patches.push(updates);Object.assign(state.profile,updates);return {success:true,error:null}}
      w.chainlensPickAvatar=async()=> 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2eL8AAAAASUVORK5CYII='
      w.getNftFloor=async()=>({floor:null,floorUsd:null,currency:'ETH'}) as any
      w.getFxRates=async()=>({rates:{USD:1},fetchedAt:Date.now()}) as any
      w.swapGetNetworks=async()=>[];w.swapReconcile=async()=>({}) as any;w.journeyList=async()=>({ok:true,value:{active:[],unreadable:[]}}) as any
    })
    await page.getByText('Encrypt & Continue').click();await expect(page.getByText('Portfolio').first()).toBeVisible({timeout:30000});await expect.poll(()=>page.evaluate(()=>(window as any).__avatar.reads)).toBe(1)
    await page.getByRole('button',{name:/^collectibles$/i}).filter({visible:true}).click()
    const mosaic=page.getByRole('button',{name:'Collection mosaic',exact:true}).filter({visible:true});if(await mosaic.getAttribute('aria-pressed')!=='true')await mosaic.click()
    await page.getByRole('button',{name:'View Seal #0',exact:true}).click()
    const details=page.getByRole('dialog',{name:'Seal #0',exact:true});await details.getByRole('button',{name:'Use as profile picture',exact:true}).click();await expect(details.getByRole('status')).toHaveText('Profile picture updated');await details.getByRole('button',{name:'Close NFT details'}).click()
    await page.locator('button[title="Profile"]').filter({visible:true}).first().click();await page.getByTitle('Change profile photo').click();const modal=page.getByRole('dialog',{name:'Change Profile Photo'})
    await expect(modal.getByRole('button',{name:/Use Seal/})).toHaveCount(38);await expect(modal.getByRole('button',{name:'Use Seal #1 as profile picture',exact:true})).toHaveCount(0)
    await modal.getByRole('button',{name:'Use Seal #39 as profile picture'}).click();await expect(modal.locator('[data-avatar-kind=nft]')).toBeVisible();expect(await page.evaluate(()=>(window as any).__avatar.reads)).toBe(1)
    await modal.locator('input[aria-label="Search NFTs for profile picture"]').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/nft-avatar-wallet-picker.png'});await modal.getByRole('button',{name:'Save',exact:true}).click();await expect(modal).toBeHidden();await expect(page.locator('[data-avatar-kind=nft]')).toBeVisible();await page.screenshot({path:'test-results/nft-avatar-wallet-profile.png'})
    await page.getByTitle('Change profile photo').click();await modal.getByRole('button',{name:/Upload Photo/}).click();await modal.getByRole('button',{name:'Choose File'}).click();await page.evaluate(()=>(window as any).__avatar.fail=true);await modal.getByRole('button',{name:'Save',exact:true}).click();await expect(modal.getByRole('alert')).toHaveText('Offline');await expect(modal).toBeVisible()
    await page.evaluate(()=>(window as any).__avatar.fail=false);await modal.getByRole('button',{name:'Save',exact:true}).click();await expect(modal).toBeHidden();await expect(page.locator('[data-avatar-kind=photo]')).toBeVisible();expect(await page.evaluate(()=>(window as any).__avatar.profile.avatar_nft_key)).toBe(null)
  }finally{await context.close()}
})
