import { test, expect } from '@playwright/test';

test('history clear toggles selection, cancel/delete and removes the selected studies and event links',async({page})=>{
 const ids:string[]=[];
 for(let i=0;i<2;i++){
  const r=await page.request.post('/api/research',{data:{code:'600519.SH',start:'2026-09-01',end:'2026-09-07'}});
  expect(r.ok()).toBe(true);ids.push((await r.json()).id);
 }
 for(const id of ids)await expect.poll(async()=>{
  const state=await(await page.request.get(`/api/research/${id}`)).json();return state.report?.body.events.length ?? 0;
 },{timeout:30000}).toBeGreaterThan(0);
 await page.goto('/');const section=page.locator('#research-history');
 await expect(section.locator('input[type=checkbox]')).toHaveCount(0);
 await section.getByRole('button',{name:'清除',exact:true}).click();
 await expect(section.getByRole('button',{name:'取消',exact:true})).toBeVisible();
 await section.getByRole('button',{name:'取消',exact:true}).click();await expect(section.locator('input[type=checkbox]')).toHaveCount(0);
 await section.getByRole('button',{name:'清除',exact:true}).click();
 const row=(id:string)=>section.locator('li').filter({has:page.locator(`a[href='/research/${id}']`)});
 await row(ids[0]).getByRole('checkbox').check();await expect(section.getByRole('button',{name:'删除',exact:true})).toBeVisible();
 await row(ids[0]).getByRole('checkbox').uncheck();await expect(section.getByRole('button',{name:'取消',exact:true})).toBeVisible();
 for(const id of ids)await row(id).getByRole('checkbox').check();
 await page.setViewportSize({width:375,height:812});await section.scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('history-selection-mobile.png')});
 await page.route('**/api/research',r=>r.request().method()==='DELETE'?r.fulfill({status:503,json:{error:{message:'test'}}}):r.continue());
 await section.getByRole('button',{name:'删除',exact:true}).click();await expect(section.getByRole('alert')).toContainText('已保留选择');
 for(const id of ids)await expect(row(id).getByRole('checkbox')).toBeChecked();
 await page.unroute('**/api/research');
 await section.getByRole('button',{name:'删除',exact:true}).click();
 for(const id of ids){await expect(section.locator(`a[href='/research/${id}']`)).toHaveCount(0);expect((await page.request.get(`/api/research/${id}`)).status()).toBe(404);}
 await expect(section.getByRole('button',{name:'清除',exact:true})).toBeVisible();
 const list=await(await page.request.get('/api/library/events?q=600519.SH')).json();
 for(const e of list.items){const detail=await(await page.request.get(`/api/library/events/${e.id}`)).json();expect(detail.research.map((r:{jobId:string})=>r.jobId).filter((id:string)=>ids.includes(id))).toEqual([]);}
 const invalid=await page.request.delete('/api/research',{data:{ids:[]}});expect(invalid.status()).toBe(400);
});
