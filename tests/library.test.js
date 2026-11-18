import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as library from '../site/assets/library.js';
test('chunk recording survives reopen, rename, notes and removal alongside legacy audio', async()=>{
 await library.save({id:'old',audio:new Blob(['old']),title:'Legacy'});
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
