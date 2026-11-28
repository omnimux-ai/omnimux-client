import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {apply} from './index.js';
test('asset service exposes authoritative detail without a loopback HTTP request',async()=>{
 const root=mkdtempSync(join(tmpdir(),'asset-service-3307-'));const prior=process.env.DSH_HOME;process.env.DSH_HOME=root;
 try{let service;apply({provide(name,value){if(name==='assetLibrary')service=value;},tools:{register(){}},systemPrompt:{section(){}}});
 const source=join(root,'hero.png');writeFileSync(source,'test-image');
 const {asset}=await service.saveTypedAsset({name:'角色',type:'character',files:[{real_path:source}]});
 assert.equal(typeof service.getAsset,'function');
 assert.equal(typeof service.listAssets,'function');
 assert.equal(typeof service.readTextFile,'function');
 const detail=service.getAsset(asset.id);assert.equal(detail.id,asset.id);assert.equal(detail.files.length,1);assert.ok(detail.files[0].real_path);
 const jsonPath=join(root,'tpl.json');writeFileSync(jsonPath,JSON.stringify({hello:'world'}));
 const {asset:jsonAsset}=await service.saveTypedAsset({name:'模板',type:'style',files:[{real_path:jsonPath}]});
 const listed=service.listAssets({type:'style'});assert.ok(listed.some(item=>item.id===jsonAsset.id));
 const readRes=await service.readTextFile(jsonAsset.id,jsonAsset.files[0].id);assert.equal(JSON.parse(readRes.content).hello,'world');
 }finally{if(prior===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prior;rmSync(root,{recursive:true,force:true});}
});
