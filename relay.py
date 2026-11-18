"""Bounded, connection-owned GPT-Live audio relay; no state between requests."""
from collections import deque
from editorial import floor_cue, continue_thought, handoff_pause
import asyncio
import base64
import json
import math
import time
import secrets
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
    pending = deque()
    active = first_host
    spoken = ['', '']
    lock = asyncio.Lock()
    alive = True

    async def wait_or_stop(awaitable, timeout):
        waiting = asyncio.ensure_future(awaitable)
        stopping = asyncio.create_task(stop.wait())
        try:
            done, _ = await asyncio.wait([waiting, stopping], timeout=timeout,
                                         return_when=asyncio.FIRST_COMPLETED)
            if stop.is_set():
                return False
            if waiting not in done:
                raise asyncio.TimeoutError()
            await waiting
            return True
        finally:
            waiting.cancel()
            stopping.cancel()
            await asyncio.gather(waiting, stopping, return_exceptions=True)

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
        event = {'type': kind, 'event_id': 'radio_' + secrets.token_hex(8)}
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
                    if kind == 'session.output_transcript.delta' and index == active:
                        spoken[index] += event.get('delta', '')
                    safe = {k: event[k] for k in ('type', 'delta', 'start_ms', 'end_ms', 'usage') if k in event}
                    await emit({'type': 'host-event', 'host': index, 'on_air': index == active, 'event': safe})
                elif kind and ('appended' in kind or kind.endswith('.done')):
                    await emit({'type': 'host-event', 'host': index, 'event': {
                        k: event[k] for k in ('type', 'start_ms', 'end_ms', 'client_event_id') if k in event}})
                elif kind == 'error':
                    if stop.is_set():
                        continue
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
                    text = event['text'][:800].strip()
                    if text and len(pending) < 8:
                        item = {'id': str(event.get('id', ''))[:80], 'text': text}
                        pending.append(item)
                        await emit({'type': 'followup-accepted', **item, 'position': len(pending)})
                    elif text:
                        await emit({'type': 'followup-rejected', 'id': str(event.get('id', ''))[:80], 'message': 'Eight follow-ups are already queued. Please wait for an answer.'})
        except Exception:
            stop.set()

    async def floor(index, opening=False, wrap=False):
        nonlocal active, pending
        active = index
        spoken[index] = ''
        buffers[0].clear()
        buffers[1].clear()
        await send(1 - index, 'session.instructions.append', 'LISTEN. Stay silent until your next ON AIR cue.')
        followup = pending.popleft() if pending else None
        if followup:
            for i in range(2):
                await send(i, 'session.thinking.append', json.dumps({'listener_followup': followup['text']}))
            await emit({'type': 'followup-delivered', **followup, 'host': index})
        cue = floor_cue(turn, opening, bool(followup), wrap)
        await emit({'type': 'floor', 'host': index})
        await send(index, 'session.instructions.append', 'ON AIR. You have the floor. Respond naturally; you do not need a counterargument.')
        await send(index, 'session.commentary.append', cue)

    async with AsyncExitStack() as stack:
        try:
            tasks.append(asyncio.create_task(receive_browser()))
            for index, original in enumerate(configs):
                if stop.is_set():
                    break
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
            if not await wait_or_stop(asyncio.gather(*(event.wait() for event in ready)), 20):
                return
            await emit({'type': 'ready'})
            if not await wait_or_stop(go.wait(), 10):
                return
            started = since = last_sound = next_frame = time.monotonic()
            heard = recovered = nudged = continued = False
            turn, last_meter = 1, -1
            await floor(active, opening=first)
            while not stop.is_set():
                tick = time.monotonic()
                elapsed = tick - started
                if elapsed >= duration:
                    stop.set()
                    break
                chunk = bytes(buffers[active][:FRAME_BYTES]) if len(buffers[active]) >= FRAME_BYTES else b''
                del buffers[active][:len(chunk)]
                frame = chunk.ljust(FRAME_BYTES, b'\x00')
                values = array('h', frame)
                # Auditioned pilot: Vesper was ~4 dB below Gleam. Balance both
                # the listener mix and what the co-host hears, before limiting.
                gain = 0.9 if active == 0 else 1.4
                values = array('h', (max(-32768, min(32767, round(v * gain))) for v in values))
                frame = values.tobytes()
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
                if heard and tick - since > 28 and not nudged:
                    nudged = True
                    await send(active, 'session.instructions.append', 'Finish this thought in one short sentence, then pause for your co-host.')
                if (heard and tick - since > 1.5 and tick - last_sound > handoff_pause(spoken[active])) or tick - since > 40:
                    # Rotate only at a natural handoff, below Hobby's 300s cap.
                    if duration == 210 and elapsed >= 180:
                        stop.set()
                        break
                    if duration < 210 and duration - elapsed < 15:
                        stop.set()
                        break
                    if continue_thought(spoken[active], continued, tick - since, bool(pending)):
                        continued = True
                        last_sound = tick
                        await send(active, 'session.commentary.append', 'Finish that unfinished thought briefly, then give your co-host space.')
                        continue
                    turn += 1
                    await floor(other, wrap=duration < 210 and duration - elapsed < 65)
                    since = last_sound = time.monotonic()
                    heard = recovered = nudged = continued = False
                elif not heard and tick - since > 20:
                    failure = 'A host stayed silent. Both sessions were closed without retrying.'
                    stop.set()
                elif not heard and tick - since > 10 and not recovered:
                    recovered = True
                    await send(active, 'session.commentary.append', 'ON AIR. The room is quiet. Give one concise response grounded in the brief, then pause.')
                # Absolute deadlines avoid accumulating scheduler delay on every frame.
                next_frame = max(next_frame + 0.04, time.monotonic() - 0.12)
                await asyncio.sleep(max(0, next_frame - time.monotonic()))
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
                        'finalized': all(closed[i].is_set() for i in range(len(sockets))), 'next_host': 1 - active, 'pending_followups': list(pending)})
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
