import { test, expect } from '@playwright/test';

test('unfinished research is searchable across events/materials, pagination and detail return',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/events?q=002230.SZ');
 await expect(page.locator('.count')).toContainText('共 22 个事件');
 await expect(page.getByRole('navigation',{name:'事件库视图'})).toContainText('资料（81）');
 await expect(page.locator('.event-card')).toHaveCount(20);
 await expect(page.locator('.event-card').first()).toContainText('等待核验');
 await page.getByRole('link',{name:'下一页',exact:true}).click();
 await expect(page.locator('.event-card')).toHaveCount(2);
 const back=page.url();await page.locator('.event-card').first().click();
 await expect(page).toHaveURL(/\/events\/automatic\//);
 await expect(page.getByRole('heading',{level:1})).toContainText('构造事项');
 await expect(page.locator('blockquote')).toHaveCount(1);
 await expect(page.getByText('待核实',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'返回事件库',exact:true}).click();await expect(page).toHaveURL(back);
 await page.getByRole('link',{name:'资料（81）',exact:true}).click();
 await expect(page.locator('.count')).toContainText('共 81 份资料，当前 1–20');
 await expect(page.locator('.research-document')).toHaveCount(20);
 await page.locator('.research-document summary').first().click();
 await expect(page.locator('.research-document[open] .research-body')).toBeVisible();
 await page.goto('/events?tab=materials&q=002230.SZ&offset=99999');
 await expect(page.locator('.count')).toContainText('当前 81–81');
 await page.getByRole('link',{name:'上一页',exact:true}).click();
 await expect(page.locator('.research-document')).toHaveCount(20);
 await page.getByLabel('搜索',{exact:true}).fill('科大讯飞');await page.getByRole('button',{name:'筛选',exact:true}).click();
 await expect(page.locator('.count')).toContainText('当前 1–20');
 await page.screenshot({path:test.info().outputPath('library-materials-desktop.png'),fullPage:true});
 await page.setViewportSize({width:375,height:812});
 for(const path of ['/events?q=002230.SZ','/events?tab=materials&q=002230.SZ']){
  await page.goto(path);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath(path.includes('tab=')?'library-materials-mobile.png':'library-events-mobile.png'),fullPage:true});
 }
 expect(errors).toEqual([]);
});
test('watchlist filters all pages on the server and preserves navigation state',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('watchlist:v1',JSON.stringify(['002230.SZ'])));
 await page.goto('/events');await page.getByLabel('只看关注标的').check();
 await expect(page.locator('.count')).toContainText('共 22 个事件');await expect(page).toHaveURL(/watched=1/);
 await page.getByRole('link',{name:'下一页',exact:true}).click();await expect(page.locator('.event-card')).toHaveCount(2);
 await page.getByRole('link',{name:'资料（81）',exact:true}).click();await expect(page.locator('.count')).toContainText('共 81 份资料');
 await page.getByRole('button',{name:'移除 002230.SZ'}).click();await expect(page.locator('.count')).toContainText('共 0 份资料');
 await expect(page.locator('.empty')).toContainText('关注标的');
});
test('polling recovers without a click and resumed queue status does not claim first start',async({page})=>{
 const listing=await (await page.request.get('/api/library/events?q=002230.SZ')).json();const id=listing.items[0].job_id;
 const status=await (await page.request.get(`/api/research/${id}`)).json();
 status.job.status='queued';
 let attempts=0;
 await page.route(`**/api/research/${id}?*`,route=>{
  attempts++;if(attempts===1)return route.abort();
  return route.fulfill({json:status});
 });
 await page.goto(`/research/${id}`);
 await expect(page.locator('.research-progress [role=alert]')).toContainText('自动重试');
 await expect(page.locator('.research-progress [role=alert]')).toHaveCount(0,{timeout:10000});
 await expect(page.locator('.research-progress strong[role=status]')).toHaveText('等待继续处理');
 await expect(page.locator('.research-event').first()).toContainText('等待核验');
 status.total=0;status.job.phase='resolve';status.report=null;status.documents=[];status.counts=[];
 await expect(page.locator('.research-progress strong[role=status]')).toHaveText('等待开始',{timeout:10000});
});
