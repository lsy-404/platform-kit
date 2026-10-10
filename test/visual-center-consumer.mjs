import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const version = async path => JSON.parse(await readFile(path, "utf8")).version;
const install = root => execFileSync("corepack",["pnpm@10.17.1","install","--ignore-scripts"],{cwd:root,stdio:"pipe"});

test("visual center archive works in Node without Vue or a browser runtime", async () => {
  const root=await mkdtemp(join(tmpdir(),"visual-center-consumer-"));
  try {
    const current=await version("tooling/visual-center/package.json");
    await writeFile(join(root,"package.json"),JSON.stringify({private:true,type:"module",dependencies:{"@platform-kit/visual-center":"file:"+resolve(`release/platform-kit-visual-center/platform-kit-visual-center-${current}.tgz`)}}));
    install(root);
    const result=execFileSync(process.execPath,["--input-type=module","-e",`import {analyzePixels} from '@platform-kit/visual-center';
      const result=analyzePixels({width:2,height:1,data:new Uint8Array([0,0,0,255,255,255,255,0])},{background:'white'});
      console.log(JSON.stringify(result));`],{cwd:root,encoding:"utf8"});
    const measurement=JSON.parse(result);
    assert.equal(measurement.center.x,0.5);
    assert.equal(measurement.offset.x,0.5);
    const manifest=JSON.parse(await readFile(join(root,"node_modules/@platform-kit/visual-center/package.json"),"utf8"));
    assert.equal(manifest.version,current);
    assert.equal(manifest.private,undefined);
    assert.equal(manifest.dependencies.vue,undefined);
    assert.equal(manifest.dependencies.playwright,undefined);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("Fluent graphics install and typecheck without installing the visual center kit", async () => {
  const root=await mkdtemp(join(tmpdir(),"fluent-graphics-consumer-"));
  try {
    const current=await version("styles/fluent/package.json");
    await writeFile(join(root,"package.json"),JSON.stringify({private:true,type:"module",dependencies:{"@platform-kit/fluent":"file:"+resolve(`release/platform-kit-fluent/platform-kit-fluent-${current}.tgz`),vue:"^3.5.0"},devDependencies:{typescript:"^5.9.2"}}));
    install(root);
    await writeFile(join(root,"consumer.ts"),`import {h,createSSRApp} from 'vue';
      import {FluentSvgIcon,FluentIconText} from '@platform-kit/fluent/vue';
      const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
      export const app=createSSRApp({render:()=>h(FluentIconText,{svg},()=> 'Play')});
      export const icon=h(FluentSvgIcon,{svg,size:20,label:'Status'});`);
    execFileSync("corepack",["pnpm@10.17.1","exec","tsc","--noEmit","--moduleResolution","bundler","--module","esnext","--target","es2024","--strict","--lib","es2024,dom","consumer.ts"],{cwd:root,stdio:"pipe"});
    const html=execFileSync(process.execPath,["--input-type=module","-e",`import {h,createSSRApp} from 'vue'; import {renderToString} from 'vue/server-renderer'; import {FluentIconText} from '@platform-kit/fluent/vue'; console.log(await renderToString(createSSRApp({render:()=>h(FluentIconText,{svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>'},()=> 'Play')})));`],{cwd:root,encoding:"utf8"});
    assert(html.includes("Play"));
    await assert.rejects(()=>readFile(join(root,"node_modules/@platform-kit/visual-center/package.json"),"utf8"));
  } finally { await rm(root,{recursive:true,force:true}); }
});
