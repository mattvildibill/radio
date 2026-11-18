"""Local-only browser storage check. Never imported by app.py or deployed as a route.
Run: .venv/bin/uvicorn tests.browser_fixture:fixture --host 127.0.0.1 --port 8000
No OpenAI API access, keys, or external storage. Audio is explicitly a test tone.
"""
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
ROOT = Path(__file__).resolve().parents[1]
fixture = FastAPI()
@fixture.get('/')
def index(): return FileResponse(ROOT / 'site/index.html')
@fixture.get('/api/status')
def status(): return {'unlocked': True, 'configured': True, 'preview': True}
@fixture.post('/api/research', status_code=429)
def research(): return {'detail': 'LOCAL FIXTURE: OpenAI spend limit reached. No request was sent and no retry is allowed.'}
@fixture.get('/storage-check')
def check():
    return HTMLResponse('''<!doctype html><html><head><title>Radio local audio storage check</title><script type="module" src="/checks/browser_fixture.js"></script></head><body><h1>Local recording check</h1><p>Two synthetic test tones. No AI voices. No API calls.</p><button id="test">Record & save a test mix</button><p id="result" role="status">Ready</p><a href="/">Open the actual replay library</a></body></html>''')
fixture.mount('/assets', StaticFiles(directory=ROOT / 'site/assets'))
fixture.mount('/checks', StaticFiles(directory=ROOT / 'tests'))
