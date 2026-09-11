import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const output=resolve('release');
await mkdir(output,{recursive:true});
const targets=['styles/fluent','styles/ui-tokens','model-auth/packages/core','model-auth/packages/providers','model-auth/packages/vue'];
const archives=[];
for(const target of targets){
 const source=resolve(target);const stage=resolve(output,'.stage',target.replaceAll('/','-'));
 await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
 const manifest=JSON.parse(await readFile(resolve(source,'package.json'),'utf8'));
 delete manifest.private;delete manifest.scripts;delete manifest.devDependencies;
 for(const item of manifest.files || []){
  if(item.includes('*'))throw new Error('Explicit package files are required');
  await cp(resolve(source,item),resolve(stage,item),{recursive:true});
 }
 for(const name of ['LICENSE','README.md'])await cp(resolve(source,name),resolve(stage,name));
 await writeFile(resolve(stage,'package.json'),JSON.stringify(manifest,null,2)+'\n');
 const result=JSON.parse(execFileSync('npm',['pack','--json','--pack-destination',output],{cwd:stage,encoding:'utf8'}));
 const archive=result[0].filename;
 const listing=execFileSync('tar',['-tzf',resolve(output,archive)],{encoding:'utf8'});
 if(!listing.includes('package/LICENSE') || /(?:^|\/)(?:agents|inventory|kits|\.env|node_modules)(?:\/|$)|IRIS-LICENSE/.test(listing))throw new Error('Package archive boundary violation');
 archives.push(archive);
}
const nativeSource=resolve('model-auth/rust');
execFileSync('cargo',['package','--manifest-path',resolve(nativeSource,'Cargo.toml'),'--locked','--allow-dirty'],{stdio:'inherit'});
const nativeVersion=(await readFile(resolve(nativeSource,'Cargo.toml'),'utf8')).match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if(!nativeVersion)throw new Error('Native package version is required');
const nativeArchive='model-auth-native-'+nativeVersion+'.crate';
await cp(resolve(nativeSource,'target/package',nativeArchive),resolve(output,nativeArchive));
archives.push(nativeArchive);
const checksums=[];
for(const file of archives) checksums.push(createHash('sha256').update(await readFile(resolve(output,file))).digest('hex')+'  '+file);
await writeFile(resolve(output,'SHA256SUMS'),checksums.join('\n')+'\n');
await rm(resolve(output,'.stage'),{recursive:true,force:true});
console.log('Prepared public archives: '+archives.join(', '));
