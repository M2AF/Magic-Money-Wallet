import type {Page} from '@playwright/test'
/** Existing selection journeys open the new default-collapsed design groups explicitly. */
export async function expandThemeDesigns(page:Page){
  for(const section of await page.locator('details.theme-design-section').all()){
    if(await section.getAttribute('open')===null)await section.locator('summary').click()
  }
}
