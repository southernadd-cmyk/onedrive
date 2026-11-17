const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const html = fs.readFileSync(path.join(__dirname,'../index.html'), 'utf8');
  const server = http.createServer((req,res)=>{
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end(html);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port = server.address().port;
  const browser = await chromium.launch({headless:true,channel:'chrome',args:['--no-sandbox']});
  const problems=[];
  const checks=[];
  const page=await browser.newPage({acceptDownloads:true,viewport:{width:1280,height:800}});
  page.on('pageerror',e=>problems.push('Browser JS exception: '+e.message));
  async function check(label,fn){await fn();checks.push(label);console.log('PASS:',label)}
  const base='http://127.0.0.1:'+port+'/';
  try{
    await page.goto(base,{waitUntil:'load'});
    await check('Public GitHub Pages serves the same current lesson',async()=>{
      const response=await page.request.get('https://southernadd-cmyk.github.io/onedrive/',{timeout:30000});
      assert.equal(response.status(),200);
      const published=await response.text();
      assert.equal(published.trim(),html.trim(),'Published HTML does not match repository HTML');
    });
    await check('Starting screen and all six stages',async()=>{
      assert.equal(await page.locator('.stage').count(),6);
      assert.equal(await page.locator('.stage.active').count(),1);
      assert.equal(await page.locator('.stepnav').count(),6);
      assert.match(await page.locator('.stage.active h2').innerText(),/safe test files/i);
    });
    await check('Total lesson time = 75 min',async()=>{
      const durations=await page.locator('.stage').evaluateAll(ns=>ns.map(n=>Number(n.dataset.duration)));
      assert.equal(durations.reduce((a,b)=>a+b,0),75);
    });
    await check('Local answers and tick boxes survive reload',async()=>{
      await page.locator('#preflight').fill('Practice files protect actual coursework.');
      await page.locator('[data-save="task.folder"]').check();
      await page.reload();
      assert.equal(await page.locator('#preflight').inputValue(),'Practice files protect actual coursework.');
      assert.equal(await page.locator('[data-save="task.folder"]').isChecked(),true);
      assert.match(await page.locator('#meterText').innerText(),/1 of 9/);
    });
    await check('Navigate between stages',async()=>{
      await page.locator('#next').click();
      assert.match(await page.locator('.stage.active h2').innerText(),/accidentally deleted file/i);
      await page.locator('.stepnav').nth(4).click();
      assert.match(await page.locator('.stage.active h2').innerText(),/college IT team/i);
      await page.locator('#prev').click();
      assert.match(await page.locator('.stage.active h2').innerText(),/Prove recovery/i);
    });
    await check('Four incident questions mark correctly',async()=>{
      await page.locator('.stepnav').nth(4).click();
      for(const [k,v] of Object.entries({q1:'b',q2:'a',q3:'c',q4:'b'})){
        await page.locator('input[name="'+k+'"][value="'+v+'"]').check();
      }
      await page.locator('#checkQuiz').click();
      assert.match(await page.locator('#quizResult').innerText(),/4 \/ 4 correct/);
    });
    await check('Changing quiz answer clears stale score',async()=>{
      await page.locator('input[name="q1"][value="a"]').check();
      assert.equal(await page.locator('#quizResult').innerText(),'');
      await page.locator('#checkQuiz').click();
      assert.match(await page.locator('#quizResult').innerText(),/3 \/ 4 correct/);
    });
    await check('RTO/RPO teaching, answer persistence, and 75-minute pacing',async()=>{
      await page.locator('.stepnav').nth(4).click();
      const stageText=await page.locator('.stage.active').innerText();
      assert.match(stageText,/RTO — Recovery Time Objective/);
      assert.match(stageText,/RPO — Recovery Point Objective/);
      assert.match(stageText,/10:00 AM/);
      assert.match(stageText,/RTO of 2 hours/);
      assert.match(stageText,/RPO of 30 minutes/);
      await page.locator('#rtoRpo').fill('By 12:00 PM; at most 30 minutes of data changes; time and data loss are separate recovery targets.');
      await page.reload();
      assert.match(await page.locator('#rtoRpo').inputValue(),/By 12:00 PM/);
      const durations=await page.locator('.stage').evaluateAll(ns=>ns.map(n=>Number(n.dataset.duration)));
      assert.deepEqual(durations,[7,12,17,7,18,14]);
    });
    await check('Download contains full response and human-readable quiz choices',async()=>{
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#saveReport').click(),
      ]);
      const text = fs.readFileSync(await download.path(),'utf8');
      assert.match(text,/Practice files protect actual coursework/);
      assert.match(text,/By 12:00 PM; at most 30 minutes of data changes/);
      assert.match(text,/Question 1/i);
      assert.match(text,/My answer: Restore the college's latest full backup/);
      assert.match(text,/Self-check score: 3\/4/);
    });
    await check('Copy to clipboard gives real student answer text',async()=>{
      await page.context().grantPermissions(['clipboard-read','clipboard-write']);
      page.once('dialog',d=>d.accept());
      await page.locator('#copyReport').click();
      await page.waitForTimeout(250);
      const copied=await page.evaluate(()=>navigator.clipboard.readText());
      assert.match(copied,/Practice files protect actual coursework/);
    });
    await check('Clear answers removes saved progress',async()=>{
      page.once('dialog',d=>d.accept());
      await page.locator('#wipe').click();
      assert.equal(await page.locator('#preflight').inputValue(),'');
      assert.equal(await page.locator('[data-save="task.folder"]').isChecked(),false);
      await page.reload();
      assert.equal(await page.locator('#preflight').inputValue(),'');
    });
    await check('Mobile viewport has no horizontal overflow',async()=>{
      await page.setViewportSize({width:390,height:844});
      await page.goto(base);
      const d=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));
      assert.ok(d.width<=d.viewport+2,JSON.stringify(d));
      await page.locator('.stepnav').nth(5).click();
      assert.match(await page.locator('.stage.active h2').innerText(),/Apply your knowledge/);
    });
    assert.deepEqual(problems,[],'Browser exceptions detected');
    console.log('PASS:',checks.length,'browser tests; no uncaught JavaScript exceptions');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e=>{console.error('FAIL',e);process.exitCode=1});
