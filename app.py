import hmac
import os
import time
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, insert, func
from sqlalchemy.exc import IntegrityError
from station import database as db
from station.editorial import BlueDraft
from station.publisher import blockers, publish
from station.providers import Gemini, Blob

app = FastAPI(title='Radio', docs_url=None, redoc_url=None)
ROOT = Path(__file__).parent
engine = db.engine_for()
EVERGREEN = {'id': 'interlude-v1', 'title': 'Room to think', 'duration': 60,
             'audio_url': '/assets/interlude.mp3', 'kind': 'evergreen',
             'description': 'Original instrumental interlude. Evergreen audio, not a news edition.'}

def authorize(request, name):
    secret = os.getenv(name, '')
    if not secret or not hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + secret):
        raise HTTPException(401, 'Authentication required')

@app.get('/')
def home():
    return FileResponse(ROOT / 'public/index.html')

@app.get('/api/station')
def station():
    degraded = False
    try:
        editions = db.catalog(engine)
    except Exception:
        editions, degraded = [], True
    now = time.time()
    # An immutable program snapshot per UTC hour. A new publication enters the
    # shared clock at the NEXT hour, so current listeners never jump mid-edition.
    anchor = int(now // 3600) * 3600
    eligible = [e for e in editions if e['published_at'] <= anchor]
    playlist = ([dict(eligible[0], kind='edition')] if eligible else []) + [EVERGREEN]
    cycle = sum(e['duration'] for e in playlist)
    offset = (now - anchor) % cycle
    current = playlist[-1]
    for item in playlist:
        if offset < item['duration']:
            current = item
            break
        offset -= item['duration']
    return JSONResponse({'server_time': now, 'editions': editions, 'evergreen': EVERGREEN,
        'latest_published_at': editions[0]['published_at'] if editions else None,
        'generation_active': not blockers(), 'degraded': degraded,
        'live': {'anchor': anchor, 'item': current, 'offset': offset,
                 'next_boundary': min(now + current['duration'] - offset, anchor + 3600)}},
        headers={'Cache-Control': 'no-store'})

@app.get('/api/health')
def health():
    return {'status': 'ok', 'generation_active': not blockers()}

@app.get('/api/admin/status')
def admin_status(request: Request):
    authorize(request, 'CRON_SECRET')
    recent = []
    if engine is not None:
        with engine.connect() as c:
            recent = [dict(r) for r in c.execute(select(db.runs).order_by(db.runs.c.started_at.desc()).limit(10)).mappings()]
    return {'blockers': blockers(), 'runs': recent}

@app.post('/api/admin/initialize')
def initialize(request: Request):
    authorize(request, 'CRON_SECRET')
    if engine is None:
        raise HTTPException(503, 'Dedicated Postgres is not configured')
    db.initialize(engine)
    return {'status': 'initialized'}

@app.post('/api/jobs/edition')
def edition_job(request: Request):
    authorize(request, 'CRON_SECRET')
    if blockers():
        return JSONResponse({'status': 'disabled'}, status_code=503)
    # Use the scheduled timestamp, not delivery time, to deduplicate delayed runs.
    from datetime import datetime
    scheduled = request.headers.get('ce-vssscheduledat')
    try:
        stamp = datetime.fromisoformat(scheduled.replace('Z', '+00:00')).timestamp() if scheduled else time.time()
    except ValueError:
        raise HTTPException(400, 'Invalid schedule timestamp')
    run_id = 'edition-' + str(int(stamp // (6 * 3600)))
    try:
        return publish(engine, Gemini(), Blob(), run_id, int(os.getenv('RADIO_MAX_DAILY_EDITIONS', '1')))
    except Exception:
        return JSONResponse({'status': 'failed', 'run_id': run_id,
                             'message': 'Last complete edition is unchanged.'}, status_code=503)

@app.post('/api/blue/drafts', status_code=202)
async def blue_draft(request: Request):
    authorize(request, 'BLUE_DRAFT_SECRET')
    if engine is None:
        raise HTTPException(503, 'Draft storage is not configured')
    body = b''
    async for chunk in request.stream():
        body += chunk
        if len(body) > 16000:
            raise HTTPException(413, 'Draft exceeds 16 KB')
    try:
        draft = BlueDraft.model_validate_json(body)
    except ValueError:
        raise HTTPException(422, 'Invalid draft schema')
    with engine.begin() as c:
        # Serialize the daily submission count across concurrent Blue requests.
        c.execute(select(db.lease.c.id).where(db.lease.c.id == 1).with_for_update()).one()
        existing = c.execute(select(db.drafts).where(db.drafts.c.id == draft.id)).mappings().first()
        if existing:
            if existing['body'] != draft.model_dump():
                raise HTTPException(409, 'Draft ID already used for different content')
            return {'status': 'already_received', 'id': draft.id}
        count = c.execute(select(func.count()).select_from(db.drafts).where(
            db.drafts.c.received_at > time.time() - 86400)).scalar_one()
        if count >= 4:
            raise HTTPException(429, 'Daily draft limit reached')
        try:
            c.execute(insert(db.drafts).values(id=draft.id, body=draft.model_dump(), received_at=time.time()))
        except IntegrityError:
            raise HTTPException(409, 'Draft already submitted; retry with identical content')
    return {'status': 'received', 'id': draft.id}

app.mount('/assets', StaticFiles(directory=ROOT / 'public/assets'), name='assets')
