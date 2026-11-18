import json
from unittest.mock import AsyncMock
import httpx
import pytest
from fastapi.testclient import TestClient
import app as web
ORIGIN = {'origin': 'https://' + web.PREVIEW_HOST}
BRIEF = {k: f'Researched {k}' for k in web.BRIEF_SCHEMA['required']}
@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('VERCEL', '1')
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key-never-a-real-credential')
    monkeypatch.setenv('VERCEL_ENV', 'preview')
    class ProtectedTransport:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, **kwargs):
            assert url == 'https://' + web.PREVIEW_HOST + '/api/privacy-probe'
            assert 'Authorization' not in kwargs.get('headers', {})
            return httpx.Response(302, headers={'location': 'https://vercel.com/sso-api?url=preview'})
    monkeypatch.setattr(web.httpx, 'AsyncClient', lambda **kwargs: ProtectedTransport())
    with TestClient(web.app, base_url='https://' + web.PREVIEW_HOST) as c: yield c

def unlock(c):
    c.cookies.clear()
    assert c.get('/api/status').status_code == 200

def researched():
    return {'status': 'completed', 'model': 'gpt-5.6-luna', 'usage': {'input_tokens': 123, 'output_tokens': 456}, 'output': [
      {'type': 'web_search_call', 'action': {'sources': [{'url': 'https://example.org/primary', 'title': 'Primary record'}]}},
      {'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(BRIEF), 'annotations': [
      {'type': 'url_citation', 'url': 'https://example.org/report', 'title': 'Reporting'}]}]}]}

def test_closed_without_configuration(client, monkeypatch):
    monkeypatch.delenv('OPENAI_API_KEY')
    assert client.get('/api/status').json()['configured'] is False
    assert client.post('/api/research', json={'question': 'test topic'}, headers=ORIGIN).status_code == 401

def test_auth_origin_production_and_cookie(client, monkeypatch):
    assert client.post('/api/research', json={}, headers=ORIGIN).status_code == 401
    response = client.get('/api/status')
    assert 'HttpOnly' in response.headers['set-cookie'] and 'SameSite=strict' in response.headers['set-cookie'] and 'Secure' in response.headers['set-cookie']
    assert client.post('/api/research', json={}, headers={'origin': 'https://evil.example'}).status_code == 403
    assert client.post('/api/research', json={}).status_code == 403
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
    assert payload['max_output_tokens'] == 6000
    assert all(field['minLength'] == 1 for field in payload['text']['format']['schema']['properties'].values())
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

@pytest.mark.parametrize('code,location', [(204, ''), (200, ''), (302, 'https://evil.example/sso-api'), (302, 'https://vercel.com/login'), (500, ''), (404, '')])
def test_private_admission_fails_closed_when_outer_gate_is_unconfirmed(client, monkeypatch, code, location):
    unlock(client)
    class Transport:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, *args, **kwargs): return httpx.Response(code, headers={'location': location})
    monkeypatch.setattr(web.httpx, 'AsyncClient', lambda **kwargs: Transport())
    upstream = AsyncMock(); monkeypatch.setattr(web, 'openai', upstream)
    assert client.get('/api/status').status_code == 503
    assert client.post('/api/research', json={'question': 'a real topic'}, headers=ORIGIN).status_code == 503
    upstream.assert_not_called()


def test_unauthenticated_probe_is_inert_and_never_uses_provider(client, monkeypatch):
    upstream = AsyncMock(); monkeypatch.setattr(web, 'openai', upstream)
    assert client.get('/api/privacy-probe').status_code == 204
    upstream.assert_not_called()


def test_unknown_host_cannot_turn_probe_into_ssrf(client):
    response = client.get('/api/status', headers={'host': 'another-project.vercel.app'})
    assert response.status_code == 403


@pytest.mark.parametrize('mutation,code', [
    ('token-limit', 'research_token_limit'), ('no-text', 'research_text_missing'),
    ('null-brief', 'research_fields_missing'), ('empty-angle', 'research_fields_missing'),
    ('null-sources', 'research_sources_missing'), ('refusal', 'research_refused'),
])
def test_research_failure_reports_reason_and_usage_without_another_call(client, monkeypatch, mutation, code):
    unlock(client)
    result = researched()
    result['usage']['output_tokens_details'] = {'reasoning_tokens': 400}
    if mutation == 'token-limit':
        result.update(status='incomplete', incomplete_details={'reason': 'max_output_tokens'})
    elif mutation == 'no-text': result['output'] = result['output'][:1]
    elif mutation == 'null-brief': result['output'][1]['content'][0]['text'] = 'null'
    elif mutation == 'empty-angle': result['output'][1]['content'][0]['text'] = json.dumps(dict(BRIEF, eli_angle='   '))
    elif mutation == 'null-sources':
        result['output'][0]['action']['sources'] = None
        result['output'][1]['content'][0]['annotations'] = None
    elif mutation == 'refusal': result['output'][1]['content'] = [{'type': 'refusal', 'refusal': 'private provider text'}]
    result['private_provider_field'] = 'never expose this field'
    upstream = AsyncMock(return_value=result); monkeypatch.setattr(web, 'openai', upstream)
    response = client.post('/api/research', json={'question': 'a real topic'}, headers=ORIGIN)
    assert response.status_code == 502
    diagnostic = response.json()['detail']['diagnostic']
    assert diagnostic['code'] == code
    assert diagnostic['usage'] == {'input_tokens': 123, 'output_tokens': 456, 'reasoning_tokens': 400}
    assert 'never expose' not in response.text and 'private provider text' not in response.text
    assert 'ticket' not in response.json()
    upstream.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize('status,code,phrase', [
    (401, 'invalid_api_key', 'invalid'), (404, 'model_not_found', 'model is unavailable'),
    (429, 'insufficient_quota', 'insufficient API credit'),
])
async def test_provider_failures_are_actionable_without_exposing_raw_message(client, monkeypatch, status, code, phrase):
    calls = []
    class Transport:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs):
            calls.append(1)
            return httpx.Response(status, json={'error': {'code': code, 'message': 'key-or-provider-secret'}})
    monkeypatch.setattr(web.httpx, 'AsyncClient', lambda **kwargs: Transport())
    with pytest.raises(web.HTTPException) as error: await web.openai('/responses', {})
    assert phrase in error.value.detail
    assert 'key-or-provider-secret' not in error.value.detail
    assert len(calls) == 1
