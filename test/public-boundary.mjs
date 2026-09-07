import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const roots=['styles/fluent/','styles/ui-tokens/','oauth/','apps/fluent-preview/','test/','scripts/','.github/'];
const top=new Set(['.gitignore','LICENSE','NOTICE','README.md','SECURITY.md','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','vitest.config.ts']);
for(const file of files){
 assert.ok(top.has(file)||roots.some(root=>file.startsWith(root)),`Unexpected public path: ${file}`);
 assert.ok(!/(?:^|\/)(?:agents|inventory|node_modules|\.env|\.dev.vars)(?:\/|$)|IRIS-LICENSE|TOOLBOX-LICENSE/.test(file),`Internal path: ${file}`);
}
console.log('Public source allowlist passed.');
