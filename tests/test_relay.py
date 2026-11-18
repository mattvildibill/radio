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
    asyncio.run(relay.run_relay(browser, [{'audio': {}}, {'audio': {}}], 'test-key', 0.2))
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
