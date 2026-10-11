import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";
const require = createRequire(new URL("../apps/fluent-preview/package.json", import.meta.url));
const { createServer } = await import(require.resolve("vite"));
let server, browser, page, address;
const triangle='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M3 3L29 3L3 29Z" fill="currentColor"/></svg>';
const twoTone='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="4" y="8" width="8" height="16" fill="black"/><rect x="20" y="8" width="8" height="16" fill="white"/></svg>';
before(async()=>{server=await createServer({configFile:false,root:process.cwd(),logLevel:"silent",server:{host:"127.0.0.1",port:0}});await server.listen();address=`http://127.0.0.1:${server.httpServer.address().port}/test/fixtures/fluent-graphics.html`;browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});page=await browser.newPage();});
after(async()=>{await browser?.close();await server?.close();});
beforeEach(async()=>{await page.setViewportSize({width:900,height:700});await page.goto(address);await page.waitForFunction(()=>document.querySelector("#named")?.getAttribute("data-status")==="estimated"&&document.querySelector("#text")?.getAttribute("data-status")==="estimated");});
async function update(value, status="estimated") {
  await page.evaluate(async value=>{
    window.setGraphics(value);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  },value);
  await page.waitForFunction(status=>document.querySelector("#named")?.getAttribute("data-status")===status,status);
  await page.waitForFunction(status=>document.querySelector("#text")?.getAttribute("data-status")===status,status);
}
const boxes = selector => page.locator(selector).evaluate(node=>({slot:node.getBoundingClientRect().toJSON(),image:node.querySelector("img").getBoundingClientRect().toJSON()}));

 test("trim retains the entire stroked graphic and the visible label is exposed once",async()=>{
  const {slot,image}=await boxes("#named");
  assert.equal(slot.width,24);
  assert(image.left+6/32*image.width>=slot.left-.1);
  assert(image.right-10/32*image.width<=slot.right+.1);
  assert(image.top+8/32*image.height>=slot.top-.1);
  assert(image.top+20/32*image.height<=slot.bottom+.1);
  assert(Math.abs(image.width*16/32-24)<.1);
  assert.equal(await page.getByRole("img",{name:"File"}).count(),1);
  assert.equal(await page.locator("#decorative").getAttribute("aria-hidden"),"true");
  assert.equal(await page.locator("#text").innerText(),"Play");
 });

 test("optical movement without trimming keeps all paint inside its slot",async()=>{
  await update({svg:triangle,trim:false,optical:true});
  const {slot,image}=await boxes("#named");
  for(const [x,y] of [[3,3],[29,3],[3,29]]) {
    assert(image.left+x/32*image.width>=slot.left-.1 && image.left+x/32*image.width<=slot.right+.1);
    assert(image.top+y/32*image.height>=slot.top-.1 && image.top+y/32*image.height<=slot.bottom+.1);
  }
  assert(Math.abs(image.left+(35/3)/32*image.width-(slot.left+12))<.35);
  assert(Math.abs(image.top+(35/3)/32*image.height-(slot.top+12))<.35);
 });

 test("background override wins over ancestors; otherwise rendered ancestor paint drives the center",async()=>{
  await update({svg:twoTone,surface:"#000",background:"#fff"});
  assert((await page.evaluate(()=>window.graphicMeasurements.icon)).center.x<12);
  await update({background:undefined});
  assert((await page.evaluate(()=>window.graphicMeasurements.icon)).center.x>12);
  await update({image:"linear-gradient(red,blue)"},"error");
  await update({background:"white"});
  assert((await page.evaluate(()=>window.graphicMeasurements.icon)).center.x<12);
 });

 test("icon text uses a stable font reference and painted-edge gap in LTR and RTL",async()=>{
  const alignment=()=>page.locator("#text").evaluate(node=>{
    const image=node.querySelector("img").getBoundingClientRect(),label=node.querySelector(".fluent-icon-text__label").getBoundingClientRect();
    const canvas=document.createElement("canvas").getContext("2d");
    canvas.font=getComputedStyle(node).font;
    const reference=canvas.measureText(/[\u2e80-\u9fff]/u.test(node.textContent)?"中":"H");
    const baseline=node.querySelector("#baseline").getBoundingClientRect().top;
    const paintCenter=image.top+14/32*image.height;
    const gap=parseFloat(getComputedStyle(node.querySelector(".fluent-icon-text__label")).marginInlineStart);
    const measuredGap=getComputedStyle(node).direction==="rtl"? image.left+6/32*image.width-label.right:label.left-(image.left+22/32*image.width);
    return {paintCenter,target:baseline-(reference.actualBoundingBoxAscent-reference.actualBoundingBoxDescent)/2,gap,measuredGap,offset:paintCenter-baseline};
  });
  const initial=await alignment();
  assert(Math.abs(initial.paintCenter-initial.target)<.35);
  assert(Math.abs(initial.gap-initial.measuredGap)<.35);
  await update({label:"gyp"});
  const descenders=await alignment();
  assert(Math.abs(descenders.offset-initial.offset)<.35);
  await update({label:"保存",dir:"rtl",fontSize:28});
  const cjk=await alignment();
  assert(Math.abs(cjk.paintCenter-cjk.target)<.35);
  assert(Math.abs(cjk.gap-cjk.measuredGap)<.35);
 });

 test("measurements settle, retain the newest source, and expose empty and error states",async()=>{
  await page.waitForTimeout(150);
  const first=await page.evaluate(()=>({...window.graphicEvents}));
  await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(()=>({...window.graphicEvents})),first);
  await page.evaluate(svg=>{
    const decode=HTMLImageElement.prototype.decode;
    window.graphicDecodeQueue=[];
    window.pauseGraphicDecode=true;
    HTMLImageElement.prototype.decode=function(){
      const decoded=decode.call(this);
      return window.pauseGraphicDecode ? decoded.then(()=>new Promise(resolve=>window.graphicDecodeQueue.push(resolve))) : decoded;
    };
    window.setGraphics({svg});
  },triangle);
  await page.waitForFunction(()=>window.graphicDecodeQueue.length>=2);
  await page.evaluate(()=>{window.pauseGraphicDecode=false;});
  await update({svg:'<svg viewBox="0 0 32 32"><rect x="8" y="8" width="16" height="16"/></svg>'});
  await page.evaluate(()=>window.graphicDecodeQueue.forEach(resolve=>resolve()));
  await page.waitForTimeout(100);
  assert((await page.evaluate(()=>window.graphicMeasurements.icon.svg)).includes("rect"));
  assert((await page.evaluate(()=>window.graphicMeasurements.text.svg)).includes("rect"));
  await update({svg:'<svg viewBox="0 0 32 32"/>'},"empty");
  await update({svg:'invalid'},"error");
 });

 test("SVG currentColor follows CSS interaction foreground changes",async()=>{
  await page.locator("#text").hover();
  assert.equal(await page.locator("#text").evaluate(node=>getComputedStyle(node).color),"rgb(200, 40, 60)");
  await page.waitForFunction(()=>{
    const source=window.graphicMeasurements.text?.svg;
    if(!source) return false;
    const root=new DOMParser().parseFromString(source,"image/svg+xml").documentElement;
    return root.style.color===getComputedStyle(document.querySelector("#text")).color;
  });
 });

 test("large inline icons reserve their full painted height in the text group",async()=>{
  await update({textSize:48});
  const {slot,image}=await boxes("#text");
  assert(image.top+8/32*image.height>=slot.top-.25);
  assert(image.top+20/32*image.height<=slot.bottom+.25);
 });
