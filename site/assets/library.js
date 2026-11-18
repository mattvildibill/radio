export const LIMIT = 100 * 1024 * 1024;
export async function database() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('radio-private-replays', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('recordings', {keyPath: 'id'});
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
export const list = () => transaction('readonly', s => s.getAll());
export const remove = id => transaction('readwrite', s => s.delete(id));
export async function save(recording) {
  const all = await list();
  const size = all.filter(r => r.id !== recording.id).reduce((n, r) => n + r.audio.size, 0) + recording.audio.size;
  if (size > LIMIT) throw new Error('The private library reached its 100 MB limit. Export this recording and remove one you no longer need.');
  return transaction('readwrite', s => s.put(recording));
}
