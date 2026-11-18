import json
from unittest.mock import AsyncMock
import httpx
import pytest
from fastapi.testclient import TestClient
import app as web
PASSWORD = 'test-only-passphrase-not-for-deployment'
ORIGIN = {'origin': 'http://testserver'}
BRIEF = {k: f'Researched {k}' for k in web.BRIEF_SCHEMA['required']}
@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('RADIO_PILOT_PASSWORD', PASSWORD)
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key-never-a-real-credential')
    monkeypatch.setenv('VERCEL_ENV', 'preview')
    with TestClient(web.app) as c: yield c

def unlock(c):
    assert c.post('/api/unlock', json={'password': PASSWORD}, headers=ORIGIN).status_code == 200

def researched():
    return {'status': 'completed', 'model': 'gpt-5.6-luna', 'usage': {'input_tokens': 123, 'output_tokens': 456}, 'output': [
      {'type': 'web_search_call', 'action': {'sources': [{'url': 'https://example.org/primary', 'title': 'Primary record'}]}},
      {'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(BRIEF), 'annotations': [
      {'type': 'url_citation', 'url': 'https://example.org/report', 'title': 'Reporting'}]}]}]}

def test_closed_without_configuration(client, monkeypatch):
    monkeypatch.delenv('RADIO_PILOT_PASSWORD')
    assert client.get('/api/status').json()['configured'] is False
    assert client.post('/api/research', json={'question': 'test topic'}, headers=ORIGIN).status_code == 401

def test_auth_origin_production_and_cookie(client, monkeypatch):
    assert client.post('/api/research', json={}, headers=ORIGIN).status_code == 401
    assert client.post('/api/unlock', json={'password': PASSWORD}, headers={'origin': 'https://evil.example'}).status_code == 403
    assert client.post('/api/unlock', json={'password': PASSWORD}).status_code == 403
    response = client.post('/api/unlock', json={'password': PASSWORD}, headers=ORIGIN)
    assert 'HttpOnly' in response.headers['set-cookie'] and 'SameSite=strict' in response.headers['set-cookie']
    assert client.get('/api/status').json()['unlocked']
    monkeypatch.setenv('VERCEL_ENV', 'production')
    assert client.post('/api/research', json={'question': 'test topic'}, headers=ORIGIN).status_code == 403

def test_research_required_and_bound_to_browser(client, monkeypatch):
    unlock(client); upstream = AsyncMock(return_value=researched()); monkeypatch.setattr(web, 'openai', upstream)
    assert client.post('/api/session', json={'host': 0, 'sdp': 'offer', 'ticket': 'forged'}, headers=ORIGIN).status_code == 401
    upstream.assert_not_called()
    show = client.post('/api/research', json={'question': 'What matters about public transit?'}, headers=ORIGIN).json()
    assert len(show['sources']) == 2 and show['research_usage']['input_tokens'] == 123
    payload = upstream.call_args.args[1]
    assert payload['tools'][0]['type'] == 'web_search' and payload['store'] is False and payload['max_tool_calls'] == 3
    upstream.assert_awaited_once()
    unlock(client)
    assert client.post('/api/session', json={'host': 0, 'sdp': 'offer', 'ticket': show['ticket']}, headers=ORIGIN).status_code == 403

@pytest.mark.parametrize('mutation', ['incomplete', 'unsourced', 'invalid-json'])
def test_failed_research_has_no_ticket(client, monkeypatch, mutation):
    unlock(client); result = researched()
    if mutation == 'incomplete': result['status'] = 'incomplete'
    if mutation == 'unsourced': result['output'] = [result['output'][1]]; result['output'][0]['content'][0]['annotations'] = []
    if mutation == 'invalid-json': result['output'][1]['content'][0]['text'] = 'not JSON'
    upstream = AsyncMock(return_value=result); monkeypatch.setattr(web, 'openai', upstream)
    response = client.post('/api/research', json={'question': 'a real topic'}, headers=ORIGIN)
    assert response.status_code == 502 and 'ticket' not in response.json(); upstream.assert_awaited_once()

def test_sessions_use_server_config_and_close_capabilities(client, monkeypatch):
    unlock(client); upstream = AsyncMock(return_value=researched()); monkeypatch.setattr(web, 'openai', upstream)
    show = client.post('/api/research', json={'question': 'a real topic'}, headers=ORIGIN).json()
    for i, voice in enumerate(['gleam', 'vesper']):
        upstream.return_value = {'session': {'id': 'live_test_' + str(i)}, 'transport': {'type': 'webrtc', 'sdp': 'answer'}}
        response = client.post('/api/session', json={'host': i, 'sdp': 'offer', 'ticket': show['ticket'], 'model': 'injected'}, headers=ORIGIN)
        assert response.status_code == 200
        payload = upstream.call_args.args[1]
        assert payload['session']['model'] == 'gpt-live-1'
        assert payload['session']['audio']['output']['voice'] == voice
        assert payload['session']['store'] is False and payload['session']['delegation'] == {'type': 'client'}
        assert 'Researched facts' in payload['session']['input'][0]['content'][0]['text']
        upstream.return_value = {}
        assert client.post('/api/close', json={'ticket': response.json()['close_ticket']}, headers=ORIGIN).status_code == 200
        assert upstream.call_args.args[0] == '/live/sessions/live_test_' + str(i) + '/hangup'
    assert client.post('/api/close', json={'ticket': show['ticket']}, headers=ORIGIN).status_code == 401

def test_ticket_tampering_and_expiry(client, monkeypatch):
    token = web.sign({'owner': 'a'}, 'access', 10)
    with pytest.raises(web.HTTPException): web.verify(token[:-1] + ('0' if token[-1] != '0' else '1'), 'access')
    now = web.time.time(); monkeypatch.setattr(web.time, 'time', lambda: now + 20)
    with pytest.raises(web.HTTPException): web.verify(token, 'access')

@pytest.mark.asyncio
async def test_budget_limit_not_retried_and_secrets_not_returned(client, monkeypatch):
    calls = []
    class Transport:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return httpx.Response(429, json={'error': {'message': 'sensitive diagnostic test-key-never-a-real-credential'}})
    monkeypatch.setattr(web.httpx, 'AsyncClient', lambda **kwargs: Transport())
    with pytest.raises(web.HTTPException) as error: await web.openai('/responses', {'input': 'test'})
    assert error.value.status_code == 429 and len(calls) == 1
    assert calls[0][0] == 'https://api.openai.com/v1/responses'
    assert 'test-key' not in error.value.detail and 'sensitive' not in error.value.detail

def test_oversized_input_and_security_headers(client):
    unlock(client)
    assert client.post('/api/research', content='x' * 4001, headers=ORIGIN).status_code == 413
    assert client.post('/api/research', json={'question': 'x' * 1201}, headers=ORIGIN).status_code == 422
    response = client.get('/')
    assert 'frame-ancestors' in response.headers['content-security-policy']
    assert response.headers['cache-control'] == 'no-store' and 'microphone=()' in response.headers['permissions-policy']
    assert client.get('/api/admin/status').status_code == 404
    assert client.post('/api/jobs/edition').status_code == 404
