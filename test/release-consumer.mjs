import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
await mkdir('test/artifacts',{recursive:true});
const fixture=await mkdtemp(resolve('test/artifacts/public-consumer-'));
try{
 await writeFile(resolve(fixture,'package.json'),JSON.stringify({name:'public-package-consumer',private:true,type:'module',dependencies:{'@lsypkg/fluent':'file:'+resolve('release/platform-kit-fluent-0.1.0.tgz'),'@model-auth/core':'file:'+resolve('release/model-auth-core-0.2.7.tgz'),'@model-auth/providers':'file:'+resolve('release/model-auth-providers-0.2.7.tgz'),'@model-auth/vue':'file:'+resolve('release/model-auth-vue-0.2.7.tgz'),vue:'^3.5.0'}}));
 execFileSync('npm',['install','--prefix',fixture,'--ignore-scripts','--no-audit','--no-fund'],{cwd:fixture,stdio:'pipe'});
 await writeFile(resolve(fixture,'verify.mjs'),`import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as fluent from '@lsypkg/fluent/vue';
import * as core from '@model-auth/core';
import * as providers from '@model-auth/providers';
import * as ui from '@model-auth/vue';
assert.ok(fluent.FluentTheme && fluent.FluentButton);
assert.equal(typeof core.CredentialRouter,'function');
assert.ok(Object.keys(providers).length > 0 && Object.keys(ui).length > 0);
for(const name of ['@lsypkg/fluent','@model-auth/core','@model-auth/providers','@model-auth/vue']) assert.match(readFileSync('node_modules/'+name+'/LICENSE','utf8'),/Apache License/);
console.log('Public release consumer imports and licenses passed.');`);
 execFileSync(process.execPath,['verify.mjs'],{cwd:fixture,stdio:'inherit'});
}finally{await rm(fixture,{recursive:true,force:true});}
