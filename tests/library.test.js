import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as library from '../site/assets/library.js';
test('chunk recording survives reopen, rename, notes and removal alongside legacy audio', async()=>{
 // Seed the actual v1 schema before exercising the v2 upgrade.
 await new Promise((resolve,reject)=>{const q=indexedDB.open('radio-private-replays',1);q.onupgradeneeded=()=>q.result.createObjectStore('recordings',{keyPath:'id'});q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,t=db.transaction('recordings','readwrite');t.objectStore('recordings').put({id:'old',audio:new Blob(['old']),title:'Legacy'});t.oncomplete=()=>{db.close();resolve();};};});
 await library.begin({id:'new',title:'New',mimeType:'audio/webm',complete:false});
 await library.append('new',new Blob(['one']),1);
 await library.append('new',new Blob(['two']),2);
 let record=(await library.list()).find(r=>r.id==='new');
 assert.equal(await record.audio.text(),'onetwo');assert.equal(record.complete,false);
 await library.update('new',{title:'Renamed',complete:true,notes:{transcripts:['hello']}});
 record=(await library.list()).find(r=>r.id==='new');assert.equal(record.title,'Renamed');assert.equal(record.duration,2);
 assert.deepEqual(record.notes.transcripts,['hello']);assert.equal(await record.audio.text(),'onetwo');
 await library.remove('new');assert.deepEqual((await library.list()).map(r=>r.id),['old']);
 const db=await library.database();const t=db.transaction('chunks');const q=t.objectStore('chunks').count();
 await new Promise(resolve=>t.oncomplete=resolve);assert.equal(q.result,0);db.close();await library.remove('old');
});

test('storage cap rejects the new chunk without overwriting captured audio', async()=>{
 await library.begin({id:'quota',title:'Quota check',mimeType:'audio/webm'});
 await library.append('quota',new Blob(['keep']),1);
 await library.update('quota',{bytes:library.LIMIT});
 await assert.rejects(library.append('quota',new Blob(['reject']),2),/storage limit/);
 const record=(await library.list()).find(r=>r.id==='quota');
 assert.equal(await record.audio.text(),'keep');assert.equal(record.chunkCount,1);assert.equal(record.duration,1);
 await library.remove('quota');
});
