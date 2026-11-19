"""Manual desktop Chromium regression with simulated mobile audio states.
Run from radio: .venv/bin/python tests/mobile_audio_browser.py
Uses isolated local ports 8124/9224 and fake research/host responses. No API use.
This verifies browser lifecycle logic, not physical iPhone/Android audio output.
"""
import asyncio,json,subprocess,tempfile
import httpx
from websockets.asyncio.client import connect

INJECT=r'''
window.testMessages=[];
const NativeAudioContext=window.AudioContext;
window.AudioContext=class extends NativeAudioContext {
 constructor(){super();window.testContext=this;this.forcedState=null;}
 get state(){return this.forcedState || super.state;}
 resume(){this.forcedState=null;return super.resume();}
};
const nativeFetch=window.fetch;
window.fetch=async(url,...args)=>{
 if(url==='/api/research'){
  testContext.forcedState='interrupted';testContext.onstatechange?.();
  return new Response(JSON.stringify({brief:{title:'Local fixture',uncertainties:'Test',social_context:'Test'},sources:[],researched_at:new Date().toISOString(),ticket:'fake'}));
 }
 return nativeFetch(url,...args);
};
window.WebSocket=class {
 static OPEN=1;constructor(){this.readyState=1;setTimeout(()=>this.onopen?.(),0);}
 send(raw){const m=JSON.parse(raw);testMessages.push(m);if(m.type==='check')setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'check-ok'})}),0);else if(m.ticket)setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'ready'})}),0);else if(m.type==='stop')setTimeout(()=>{this.onmessage?.({data:JSON.stringify({type:'closed',finalized:true,reason:'stop'})});this.close();},0);}
 close(){this.readyState=3;this.onclose?.({code:1000});}
};
'''
async def main():
 with tempfile.TemporaryDirectory(prefix='radio-mobile-') as profile:
  server=subprocess.Popen(['.venv/bin/uvicorn','tests.browser_fixture:fixture','--port','8124'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  browser=subprocess.Popen(['chromium','--headless','--no-sandbox','--remote-debugging-port=9224',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  try:
   async with httpx.AsyncClient() as client:
    for _ in range(400):
     try:
      tabs=(await client.get('http://127.0.0.1:9224/json')).json();await client.get('http://127.0.0.1:8124');break
     except Exception:await asyncio.sleep(.1)
   async with connect(tabs[0]['webSocketDebuggerUrl']) as ws:
    seq=0
    async def call(method,params={}):
     nonlocal seq
     seq+=1;await ws.send(json.dumps({'id':seq,'method':method,'params':params}))
     while True:
      data=json.loads(await ws.recv())
      if data.get('id')==seq:
       assert 'error' not in data,data
       return data.get('result',{})
    async def js(expr):
     r=await call('Runtime.evaluate',{'expression':expr,'awaitPromise':True,'returnByValue':True,'userGesture':True});assert 'exceptionDetails' not in r,r
     return r['result'].get('value')
    async def until(expr):
     for _ in range(400):
      if await js(expr):return
      await asyncio.sleep(.05)
     raise AssertionError((expr,await js("document.body.innerText")))
    await call('Page.enable')
    await call('Page.addScriptToEvaluateOnNewDocument',{'source':INJECT})
    await call('Page.navigate',{'url':'http://127.0.0.1:8124/'})
    await until("document.getElementById('test-sound')?.onclick && !document.getElementById('studio').hidden")
    await js("document.getElementById('test-sound').click()")
    await until("!document.getElementById('test-sound').disabled && window.testContext?.state==='closed'")
    assert await js("document.getElementById('audio-status').textContent.includes('Playing a short tone')")
    print('PASS: free tone runs and closes its AudioContext')
    await js("document.getElementById('question').value='Test mobile recovery';document.getElementById('start').click()")
    await until("!document.getElementById('enable-audio').hidden")
    assert await js("testMessages.filter(x=>x.ticket).length===0")
    print('PASS: interruption during research prevents opening host sessions')
    await js("document.getElementById('enable-audio').click()")
    await until("testMessages.some(x=>x.type==='go')")
    print('PASS: fresh gesture resumes audio and starts mocked hosts')
    await js("testContext.forcedState='interrupted';testContext.onstatechange()")
    await until("!document.getElementById('start').disabled")
    assert await js("testMessages.some(x=>x.type==='stop') && testContext.state==='interrupted'")
    # Forced state hides the native closed state; verify native close directly.
    assert await js("(testContext.forcedState=null,window.testContext?.state==='closed')")
    print('PASS: live interruption sends stop and closes audio')
    await js("document.getElementById('start').click()")
    await until("!document.getElementById('enable-audio').hidden")
    before=await js("testMessages.filter(x=>x.ticket).length")
    await js("document.getElementById('stop').click()")
    await until("!document.getElementById('start').disabled")
    assert await js("testMessages.filter(x=>x.ticket).length")==before
    print('PASS: stopping while awaiting audio opens no host sessions')
  finally:
   browser.terminate();server.terminate();browser.wait();server.wait()
asyncio.run(main())
