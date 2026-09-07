import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
await mkdir('test/artifacts',{recursive:true});
const fixture=await mkdtemp(resolve('test/artifacts/public-consumer-'));
try{
 await writeFile(resolve(fixture,'package.json'),JSON.stringify({name:'public-package-consumer',private:true,type:'module',dependencies:{'@lsypkg/fluent':'file:'+resolve('release/platform-kit-fluent-0.1.1.tgz'),'@model-auth/core':'file:'+resolve('release/model-auth-core-0.2.7.tgz'),'@model-auth/providers':'file:'+resolve('release/model-auth-providers-0.2.7.tgz'),'@model-auth/vue':'file:'+resolve('release/model-auth-vue-0.2.7.tgz'),vue:'^3.5.0'}}));
 execFileSync('npm',['install','--prefix',fixture,'--ignore-scripts','--no-audit','--no-fund'],{cwd:fixture,stdio:'pipe'});
 await writeFile(resolve(fixture,'verify.mjs'),`import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as fluent from '@lsypkg/fluent/vue';
import * as core from '@model-auth/core';
import * as providers from '@model-auth/providers';
assert.ok(fluent.FluentTheme && fluent.FluentButton);
assert.equal(typeof core.CredentialRouter,'function');
assert.ok(Object.keys(providers).length > 0);
for(const name of ['@lsypkg/fluent','@model-auth/core','@model-auth/providers','@model-auth/vue']) assert.match(readFileSync('node_modules/'+name+'/LICENSE','utf8'),/Apache License/);
console.log('Public release consumer imports and licenses passed.');`);
 execFileSync(process.execPath,['verify.mjs'],{cwd:fixture,stdio:'inherit'});
 await writeFile(resolve(fixture,'index.html'),'<div id="app"></div><script type="module" src="/main.js"></script>');
 await writeFile(resolve(fixture,'main.js'),`import {createApp,h} from 'vue';
import {FluentButton} from '@lsypkg/fluent/vue';
import '@lsypkg/fluent/style.css';
import * as auth from '@model-auth/vue';
console.log(auth);
createApp({render:()=>h(FluentButton,{},()=>"Package consumer")}).mount('#app');`);
 execFileSync(process.execPath,[resolve('apps/fluent-preview/node_modules/vite/bin/vite.js'),'build',fixture,'--outDir',resolve(fixture,'dist'),'--emptyOutDir'],{cwd:fixture,stdio:'inherit'});
}finally{await rm(fixture,{recursive:true,force:true});}
