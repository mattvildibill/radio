import asyncio
import base64
import json
from array import array
from unittest.mock import AsyncMock
import pytest
from starlette.websockets import WebSocketDisconnect
import relay
from tests.test_pilot import client, unlock, ORIGIN, researched
import app as web


class Browser:
    def __init__(self):
        self.events = []
        self.incoming = asyncio.Queue()
    async def send_json(self, event):
        self.events.append(event)
        if event['type'] == 'ready':
            await self.incoming.put(json.dumps({'type': 'go'}))
    async def receive_text(self):
        return await self.incoming.get()


class Upstream:
    def __init__(self):
        self.events = asyncio.Queue()
        self.sent = []
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    def __aiter__(self): return self
    async def __anext__(self): return await self.events.get()
    async def send(self, raw):
        event = json.loads(raw)
        self.sent.append(event)
        if event['type'] == 'session.start':
            await self.events.put(json.dumps({'type': 'session.started'}))
        elif event['type'] == 'session.instructions.append' and event['content'].startswith('ON AIR'):
            await self.events.put(json.dumps({'type': 'session.output_audio.delta',
                'delta': base64.b64encode(array('h', [8192] * 960).tobytes()).decode()}))
        elif event['type'] == 'session.close':
            await self.events.put(json.dumps({'type': 'session.closed', 'usage': {'seconds': 15}}))


def test_pcm_routes_to_other_host_and_both_finalize(monkeypatch):
    upstreams = [Upstream(), Upstream()]
    connections = iter(upstreams)
    def connect(url, **kwargs):
        assert url == 'wss://api.openai.com/v1/live/sessions'
        assert kwargs['additional_headers']['Authorization'] == 'Bearer test-key'
        return next(connections)
    monkeypatch.setattr(relay, 'connect', connect)
    browser = Browser()
    asyncio.run(relay.run_relay(browser, [{'audio': {}}, {'audio': {}}], 'test-key', 0.7))
    def audio(s): return [base64.b64decode(e['audio']) for e in s.sent if e['type'] == 'session.input_audio.append']
    assert audio(upstreams[0]) and all(p == relay.SILENCE for p in audio(upstreams[0]))
    assert any(p != relay.SILENCE for p in audio(upstreams[1]))
    for s in upstreams:
        assert sum(e['type'] == 'session.start' for e in s.sent) == 1
        assert sum(e['type'] == 'session.close' for e in s.sent) == 1
    assert browser.events[-1]['finalized'] is True
    assert 'test-key' not in json.dumps(browser.events)


@pytest.mark.parametrize('scenario', ['missing-cookie', 'wrong-origin', 'bad-ticket', 'bad-duration'])
def test_relay_admission_never_opens_upstream(client, monkeypatch, scenario):
    run = AsyncMock()
    monkeypatch.setattr(relay, 'run_relay', run)
    unlock(client)
    monkeypatch.setattr(web, 'openai', AsyncMock(return_value=researched()))
    ticket = client.post('/api/research', json={'question': 'a real topic'}, headers=ORIGIN).json()['ticket']
    if scenario == 'missing-cookie': client.cookies.clear()
    origin = {'origin': 'https://evil.example'} if scenario == 'wrong-origin' else ORIGIN
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect('wss://' + web.PREVIEW_HOST + '/api/live', headers=origin) as ws:
            ws.send_json({'ticket': 'forged' if scenario == 'bad-ticket' else ticket,
                          'duration': 999 if scenario == 'bad-duration' else 90})
            while True:
                assert ws.receive_json()["type"] == "relay-error"
    run.assert_not_called()


def test_deployment_manifest_contains_runtime_dependencies():
    import tomllib
    from pathlib import Path
    project = tomllib.loads(Path('pyproject.toml').read_text())
    dependencies = set(project['project']['dependencies'])
    assert set(Path('requirements.txt').read_text().splitlines()) <= dependencies
    lock = tomllib.loads(Path('uv.lock').read_text())
    names = {package['name'] for package in lock['package']}
    assert {'websockets', 'uvicorn', 'fastapi'} <= names


def test_quota_error_stops_without_retry_or_waiting_for_speech(monkeypatch):
    class Rejected(Upstream):
        async def send(self, raw):
            self.sent.append(json.loads(raw))
            if self.sent[-1]['type'] == 'session.start':
                await self.events.put(json.dumps({'type': 'error', 'error': {'code': 'insufficient_quota'}}))
    upstreams = []
    def connect(*args, **kwargs):
        socket = Rejected(); upstreams.append(socket); return socket
    monkeypatch.setattr(relay, 'connect', connect)
    browser = Browser()
    async def scenario():
        await asyncio.wait_for(relay.run_relay(browser, [{'audio': {}}, {'audio': {}}], 'test-key', 90), 1)
    asyncio.run(scenario())
    assert len(upstreams) <= 2
    assert all(sum(e['type'] == 'session.start' for e in s.sent) == 1 for s in upstreams)
    assert any(e['type'] == 'relay-error' and 'insufficient_quota' in e['message'] for e in browser.events)
    assert not any(e['type'] == 'audio' for e in browser.events)


def test_stop_before_ready_closes_both_sessions(monkeypatch):
    upstreams = [Upstream(), Upstream()]
    connections = iter(upstreams)
    monkeypatch.setattr(relay, 'connect', lambda *args, **kwargs: next(connections))
    class StopBrowser(Browser):
        async def send_json(self, event):
            self.events.append(event)
            if event['type'] == 'ready':
                await self.incoming.put(json.dumps({'type': 'stop'}))
    browser = StopBrowser()
    async def scenario():
        await asyncio.wait_for(relay.run_relay(browser, [{'audio': {}}, {'audio': {}}], 'test-key', 90), 1)
    asyncio.run(scenario())
    assert browser.events[-1]['finalized']
    assert not any(e['type'] == 'audio' for e in browser.events)
    assert all(any(e['type'] == 'session.close' for e in s.sent) for s in upstreams)


def test_followups_deliver_in_order_and_preserve_unanswered_items(monkeypatch):
    upstreams = [Upstream(), Upstream()]
    connections = iter(upstreams)
    monkeypatch.setattr(relay, 'connect', lambda *args, **kwargs: next(connections))
    class QueuedBrowser(Browser):
        async def send_json(self, event):
            await super().send_json(event)
            if event['type'] == 'followup-delivered' and event['id'] == '2':
                await self.incoming.put(json.dumps({'type':'stop'}))
    browser = QueuedBrowser()
    async def scenario():
        for n in range(1,4):
            await browser.incoming.put(json.dumps({'type':'followup','id':str(n),'text':f'Question {n}'}))
        await asyncio.wait_for(relay.run_relay(browser, [{'audio': {}}, {'audio': {}}], 'test-key', 210), 5)
    asyncio.run(scenario())
    assert [e['id'] for e in browser.events if e['type']=='followup-delivered'] == ['1','2']
    assert browser.events[-1]['pending_followups'] == [{'id':'3','text':'Question 3'}]
    assert browser.events[-1]['finalized']


def test_off_air_speech_is_drained_before_opening_the_audio_gate(monkeypatch):
    class Backchannel(Upstream):
        async def send(self, raw):
            await super().send(raw)
            event = json.loads(raw)
            if event['type'] == 'session.instructions.append' and event['content'].startswith('LISTEN'):
                await self.events.put(json.dumps({'type':'session.output_audio.delta',
                    'delta':base64.b64encode(array('h', [-8192]*960).tobytes()).decode()}))
    connections = iter([Backchannel(),Backchannel()])
    monkeypatch.setattr(relay, 'connect', lambda *args, **kwargs: next(connections))
    browser=Browser()
    asyncio.run(relay.run_relay(browser,[{'audio':{}},{'audio':{}}],'test-key',0.7))
    aired=[array('h',base64.b64decode(e['pcm'])) for e in browser.events if e['type']=='audio']
    assert aired and all(min(frame)>=0 for frame in aired)
    assert browser.events[-1]['finalized']


def test_queued_silence_does_not_block_natural_handoffs():
    assert not relay.queued_speech(relay.SILENCE * 8)
    assert relay.queued_speech(relay.SILENCE * 8 + array('h', [8192] * 960).tobytes())
    assert not relay.queued_speech(b'')
