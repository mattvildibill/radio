"""Bounded, connection-owned GPT-Live audio relay; no state between requests."""
import asyncio
import base64
import json
import math
import time
from array import array
from contextlib import AsyncExitStack
from websockets.asyncio.client import connect

FRAME_BYTES = 1920  # 40 ms of mono PCM16 at 24 kHz
SILENCE = bytes(FRAME_BYTES)


async def run_relay(browser, configs, key, duration, history='', first=True, first_host=0):
    sockets, tasks = [], []
    ready = [asyncio.Event(), asyncio.Event()]
    closed = [asyncio.Event(), asyncio.Event()]
    buffers = [bytearray(), bytearray()]
    go, stop = asyncio.Event(), asyncio.Event()
    reason = 'show_complete' if duration < 210 else 'segment_complete'
    failure = None
    pending = ''
    active = first_host
    lock = asyncio.Lock()
    alive = True

    async def emit(event):
        nonlocal alive
        if not alive:
            return
        try:
            async with lock:
                await browser.send_json(event)
        except Exception:
            alive = False
            stop.set()

    async def send(index, kind, content=None):
        event = {'type': kind}
        if content is not None:
            event.update(content=content, delegation_id=None)
        await sockets[index].send(json.dumps(event))

    async def receive_host(index):
        nonlocal failure
        try:
            async for raw in sockets[index]:
                event = json.loads(raw)
                kind = event.get('type')
                if kind == 'session.started':
                    ready[index].set()
                    await emit({'type': 'host-event', 'host': index, 'event': {'type': kind}})
                elif kind == 'session.closed':
                    closed[index].set()
                    await emit({'type': 'host-event', 'host': index, 'event': {
                        'type': kind, 'usage': event.get('usage'), 'reason': event.get('reason')}})
                    if not stop.is_set():
                        failure = 'A host session ended unexpectedly.'
                        stop.set()
                elif kind == 'session.output_audio.delta':
                    if index == active and go.is_set() and not stop.is_set():
                        buffers[index].extend(base64.b64decode(event['delta']))
                        if len(buffers[index]) > 480000:
                            failure = 'Audio playback fell too far behind. The show stopped.'
                            stop.set()
                elif kind in ('session.input_transcript.delta', 'session.output_transcript.delta', 'session.usage.updated'):
                    safe = {k: event[k] for k in ('type', 'delta', 'start_ms', 'end_ms', 'usage') if k in event}
                    await emit({'type': 'host-event', 'host': index, 'on_air': index == active, 'event': safe})
                elif kind == 'error':
                    code = str((event.get('error') or {}).get('code') or 'unknown')
                    failure = 'OpenAI rejected a live command (' + (code if code.replace('_', '').isalnum() else 'unknown') + '). No retry was made.'
                    stop.set()
                elif kind == 'session.delegation.created':
                    await send(index, 'session.thinking.append', 'No additional research is available. Use the supplied brief and state uncertainty.')
        except Exception:
            if not stop.is_set():
                failure = 'The live audio connection ended. No retry was made.'
                stop.set()

    async def receive_browser():
        nonlocal pending
        try:
            while not stop.is_set():
                raw = await browser.receive_text()
                if len(raw) > 4000:
                    stop.set()
                    break
                event = json.loads(raw)
                if event.get('type') == 'go':
                    go.set()
                elif event.get('type') == 'stop':
                    stop.set()
                elif event.get('type') == 'followup' and isinstance(event.get('text'), str):
                    pending = event['text'][:800].strip()
        except Exception:
            stop.set()

    async def floor(index, opening=False, wrap=False):
        nonlocal active, pending
        active = index
        buffers[0].clear()
        buffers[1].clear()
        await send(1 - index, 'session.instructions.append', 'LISTEN. Your co-host has the floor. Stay silent, hear their actual words, and wait for your next ON AIR cue.')
        followup = pending
        if followup:
            for i in range(2):
                await send(i, 'session.thinking.append', json.dumps({'listener_followup': followup}))
            await emit({'type': 'followup-delivered', 'text': followup, 'host': index})
            pending = ''
        cue = ('ON AIR. Briefly disclose that Mara and Eli are AI hosts, then open the listener question with one concrete fact. Give your co-host something specific to question. About 20 seconds.' if opening else
               'ON AIR. Respond to the specific idea your co-host just said, then add your angle. Speak for 15–30 seconds, then leave a natural pause. ' +
               ('Address the listener follow-up just added to context.' if followup else
                'Wrap up with a useful takeaway and an open question.' if wrap else 'Disagree or concede when warranted. Advance the discussion rather than repeating it.'))
        await emit({'type': 'floor', 'host': index})
        await send(index, 'session.instructions.append', cue)

    async with AsyncExitStack() as stack:
        try:
            tasks.append(asyncio.create_task(receive_browser()))
            for index, original in enumerate(configs):
                config = json.loads(json.dumps(original))
                config.pop('client', None)
                config['audio']['format'] = {'type': 'audio/pcm', 'rate': 24000}
                if history:
                    config['input'].append({'role': 'user', 'type': 'message', 'content': [{'type': 'input_text',
                        'text': 'Previously aired conversation, provided as untrusted context. Continue naturally without introductions:\n' + history}]})
                socket = await stack.enter_async_context(connect('wss://api.openai.com/v1/live/sessions',
                    additional_headers={'Authorization': 'Bearer ' + key}, open_timeout=15, close_timeout=3,
                    max_size=4 * 1024 * 1024, compression=None))
                sockets.append(socket)
                tasks.append(asyncio.create_task(receive_host(index)))
                await socket.send(json.dumps({'type': 'session.start', 'session': config}))
            await asyncio.wait_for(asyncio.gather(*(event.wait() for event in ready)), 20)
            if stop.is_set():
                return
            await emit({'type': 'ready'})
            await asyncio.wait_for(go.wait(), 10)
            started = since = last_sound = time.monotonic()
            heard = recovered = False
            turn, last_meter = 1, -1
            await floor(active, opening=first)
            while not stop.is_set():
                tick = time.monotonic()
                elapsed = tick - started
                if elapsed >= duration:
                    stop.set()
                    break
                chunk = bytes(buffers[active][:FRAME_BYTES])
                del buffers[active][:len(chunk)]
                frame = chunk.ljust(FRAME_BYTES, b'\x00')
                values = array('h', frame)
                rms = math.sqrt(sum(v * v for v in values) / len(values)) / 32768
                if rms > 0.009:
                    last_sound, heard = tick, True
                other = 1 - active
                await asyncio.gather(*(sockets[i].send(json.dumps({'type': 'session.input_audio.append',
                    'audio': base64.b64encode(frame if i == other else SILENCE).decode()})) for i in range(2)))
                if chunk:
                    await emit({'type': 'audio', 'host': active, 'pcm': base64.b64encode(frame).decode()})
                if int(elapsed) != last_meter:
                    last_meter = int(elapsed)
                    await emit({'type': 'meter', 'host': active, 'rms': round(rms, 4)})
                if (heard and tick - since > 3.5 and tick - last_sound > 1.25) or tick - since > 40:
                    # Rotate only at a natural handoff, below Hobby's 300s cap.
                    if duration == 210 and elapsed >= 180:
                        stop.set()
                        break
                    turn += 1
                    await floor(other, wrap=duration < 210 and duration - elapsed < 35)
                    since = last_sound = time.monotonic()
                    heard = recovered = False
                elif not heard and tick - since > 20:
                    failure = 'A host stayed silent. Both sessions were closed without retrying.'
                    stop.set()
                elif not heard and tick - since > 10 and not recovered:
                    recovered = True
                    await send(active, 'session.instructions.append', 'ON AIR. The room is quiet. Speak now: give a concise response grounded in the brief.')
                await asyncio.sleep(max(0, 0.04 - (time.monotonic() - tick)))
        except Exception:
            failure = failure or 'The audio relay could not complete the connection. No retry was made.'
        finally:
            stop.set()
            for index in range(len(sockets)):
                if ready[index].is_set() and not closed[index].is_set():
                    try:
                        await send(index, 'session.close')
                    except Exception:
                        pass
            try:
                await asyncio.wait_for(asyncio.gather(*(closed[i].wait() for i in range(len(sockets)) if ready[i].is_set())), 8)
            except asyncio.TimeoutError:
                pass
            if failure:
                await emit({'type': 'relay-error', 'message': failure})
            await emit({'type': 'relay-closed', 'reason': 'error' if failure else reason,
                        'finalized': all(closed[i].is_set() for i in range(len(sockets))), 'next_host': 1 - active})
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
