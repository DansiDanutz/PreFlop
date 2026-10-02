import {readFile,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..'), out=path.join(root,'dist/server');
const ts=createRequire(path.join(root,'packages/odds-engine/package.json'))('typescript');
await rm(path.join(root,'dist'),{recursive:true,force:true});
await mkdir(out,{recursive:true});
for(const dir of ['web','packages/odds-engine/src'])await mkdir(path.join(out,dir),{recursive:true});
const compiled=new Set();
async function compile(name){
  if(compiled.has(name))return;compiled.add(name);
  const input=await readFile(path.join(root,'packages/odds-engine/src',name),'utf8');
  const code=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from (['"])([^'"]+)\.ts\1/g,'from $1$2.js$1');
  await writeFile(path.join(out,'packages/odds-engine/src',name.replace(/\.ts$/,'.js')),code);
  for(const match of code.matchAll(/from ['"]\.\/([^'"]+)\.js['"]/g))await compile(match[1]+'.ts');
}
for(const name of ['flops.ts','markets.ts','settle.ts','cards.ts'])await compile(name);
await writeFile(path.join(out,'package.json'),JSON.stringify({type:'module'}));
for(const name of ['server.mjs','worker.mjs','data.mjs']){
  let code=(await readFile(path.join(root,'web',name),'utf8')).replace(/from (['"])([^'"]+)\.ts\1/g,'from $1$2.js$1');
  if(name==='server.mjs')code=code.replace(/import book from [^;]+;/,'const book='+await readFile(path.join(root,'docs/odds-book.json'),'utf8')+';');
  await writeFile(path.join(out,'web',name),code);
}
const assets={};
for(const [name,type] of [['index.html','text/html'],['app.js','text/javascript'],['styles.css','text/css'],['icon.svg','image/svg+xml'],['manifest.webmanifest','application/manifest+json']]){
  assets['/'+name]={body:await readFile(path.join(root,'web',name),'utf8'),type:type+'; charset=utf-8'};
}
await writeFile(path.join(out,'assets.mjs'),'export default '+JSON.stringify(assets)+';');
await writeFile(path.join(out,'index.js'),"import {createWorker} from './web/worker.mjs';\nimport assets from './assets.mjs';\nexport default createWorker(assets);\n");
await mkdir(path.join(root,'dist/.openai'),{recursive:true});
await copyFile(path.join(root,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));
console.log('Built PreFlop Worker, embedded UI and exact engine. No dependencies installed.');
