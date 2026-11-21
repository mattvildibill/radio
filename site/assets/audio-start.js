// Call from a user gesture. Some phones otherwise use the silent/ambient route.
export function preferPlayback(navigatorObject = navigator) {
  try { if (navigatorObject.audioSession) navigatorObject.audioSession.type = 'playback'; } catch { /* Optional browser API. */ }
}
export async function enableAudio(context, timeoutMs = 2000) {
  let timer;
  try {
    await Promise.race([context.resume(), new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
    return context.state === 'running';
  } catch { return false; }
  finally { clearTimeout(timer); }
}
export const audioInterrupted = state => state === 'suspended' || state === 'interrupted' || state === 'closed';
