export const LIMIT = 100 * 1024 * 1024;
export async function database() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('radio-private-replays', 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('recordings')) r.result.createObjectStore('recordings', {keyPath:'id'});
      if (!r.result.objectStoreNames.contains('chunks')) { const chunks = r.result.createObjectStore('chunks', {keyPath:['id','index']}); chunks.createIndex('recording','id'); }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Close other radio tabs to open the replay library.'));
  });
}
async function transaction(mode, fn) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const t = db.transaction('recordings', mode);
    const r = fn(t.objectStore('recordings'));
    t.oncomplete = () => { db.close(); resolve(r.result); };
    t.onabort = t.onerror = () => { db.close(); reject(t.error || new Error('Browser storage failed.')); };
  });
}
const metadata = () => transaction('readonly', s => s.getAll());
export async function list() {
  const records = await metadata();
  for (const record of records) if (record.chunked) {
    const db = await database();
    const chunks = await new Promise((resolve,reject) => { const t=db.transaction('chunks'); const q=t.objectStore('chunks').index('recording').getAll(record.id); t.oncomplete=()=>resolve(q.result); t.onerror=()=>reject(t.error); }); db.close();
    record.audio = new Blob(chunks.map(c=>c.audio), {type:record.mimeType});
  }
  return records;
}
export async function remove(id) {
 const db=await database();
 await new Promise((resolve,reject)=>{const t=db.transaction(['recordings','chunks'],'readwrite');t.objectStore('recordings').delete(id);const q=t.objectStore('chunks').index('recording').openCursor(IDBKeyRange.only(id));q.onsuccess=()=>{const c=q.result;if(c){c.delete();c.continue();}};t.oncomplete=resolve;t.onerror=()=>reject(t.error);});db.close();
}
export async function save(recording) {
  const all = await list();
  const size = all.filter(r => r.id !== recording.id).reduce((n, r) => n + r.audio.size, 0) + recording.audio.size;
  if (size > LIMIT) throw new Error('The private library reached its 100 MB limit. Export this recording and remove one you no longer need.');
  return transaction('readwrite', s => s.put(recording));
}

export const begin = record => transaction('readwrite', s => s.put({...record, chunked:true, bytes:0, chunkCount:0}));
export async function append(id, audio, duration) {
 const db = await database();
 try { await new Promise((resolve,reject)=>{
  const t=db.transaction(['recordings','chunks'],'readwrite'), records=t.objectStore('recordings');
  const q=records.getAll(); let failure;
  q.onsuccess=()=>{
   const record=q.result.find(r=>r.id===id);
   const total=q.result.reduce((n,r)=>n+(r.bytes ?? r.audio?.size ?? 0),0);
   if(!record || total+audio.size>LIMIT){failure=new Error('Recording storage limit reached. Export or remove a recording.');t.abort();return;}
   t.objectStore('chunks').put({id,index:record.chunkCount,audio});
   records.put({...record,bytes:record.bytes+audio.size,chunkCount:record.chunkCount+1,duration});
  };
  t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(failure || t.error);
 }); } finally { db.close(); }
}
export async function update(id, changes) {
 const db=await database();
 try {await new Promise((resolve,reject)=>{const t=db.transaction('recordings','readwrite'),s=t.objectStore('recordings'),q=s.get(id);q.onsuccess=()=>{if(q.result)s.put({...q.result,...changes,id});};t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}finally{db.close();}

}
