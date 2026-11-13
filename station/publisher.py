import os
import time
from sqlalchemy import select, insert, update
from station import database as db
from station.editorial import fingerprint, validate_script
from station.providers import fetch_feeds

def blockers():
    required = ['GEMINI_API_KEY', 'GEMINI_TEXT_MODEL', 'GEMINI_TTS_MODEL', 'BLOB_READ_WRITE_TOKEN', 'CRON_SECRET']
    missing = [key for key in required if not os.getenv(key)]
    if not (os.getenv('DATABASE_URL') or os.getenv('POSTGRES_URL')):
        missing.append('DATABASE_URL')
    if os.getenv('RADIO_FREE_TIER_VERIFIED') != '1':
        missing.append('verified free plans and Gemini quota')
    if os.getenv('RADIO_GENERATION_ENABLED') != '1':
        missing.append('generation activation')
    return missing

def publish(engine, model, storage, run_id, max_daily=1, feeds=None, now=None):
    now = now or time.time()
    status = db.claim(engine, run_id, now, min(4, max(1, max_daily)))
    if status != 'claimed':
        return {'status': status, 'run_id': run_id}
    try:
        with engine.connect() as c:
            history = [dict(r) for r in c.execute(select(db.coverage)).mappings()]
            pending = c.execute(select(db.drafts).where(db.drafts.c.edition_id.is_(None),
                    db.drafts.c.received_at > now - 86400).order_by(db.drafts.c.received_at).limit(1)).mappings().first()
        # Retain the full development ledger. Stop safely rather than silently forget coverage.
        if len(history) > 1000:
            raise ValueError('Coverage context capacity needs maintenance')
        feeds = fetch_feeds() if feeds is None else feeds
        blue = pending['body'] if pending else None
        if not feeds and not blue:
            db.finish(engine, run_id, 'no_news', time.time())
            return {'status': 'no_news', 'run_id': run_id}
        script = model.write(feeds, history, blue)
        allowed = {f['url'] for f in feeds} | {s['url'] for s in (blue or {}).get('sources', [])}
        validate_script(script, allowed)
        seen = {h['fingerprint'] for h in history}
        hashes = [fingerprint(s) for s in script.stories]
        if (not script.stories or any(h in seen for h in hashes) or len(set(hashes)) != len(hashes)
                or not model.review(script, history, {'feeds': feeds, 'blue': blue})):
            db.finish(engine, run_id, 'no_news', time.time())
            return {'status': 'no_news', 'run_id': run_id}
        audio, duration = model.narrate(script)
        if not audio or len(audio) > 2_000_000 or not 30 <= duration <= 300:
            raise ValueError('Invalid complete audio')
        audio_url = storage.upload(audio)
        published_at = time.time()
        # The edition, coverage and Blue consumption become visible in one transaction,
        # strictly after narration, upload and Blob verification have all completed.
        with engine.begin() as c:
            active = c.execute(select(db.lease).where(db.lease.c.id == 1).with_for_update()).mappings().one()
            if active['owner'] != run_id or active['until'] < published_at:
                raise ValueError('Publication lease expired')
            c.execute(insert(db.editions).values(id=run_id, title=script.title, published_at=published_at,
                duration=duration, audio_url=audio_url, audio_bytes=len(audio),
                transcript=[t.model_dump() for t in script.turns], stories=[s.model_dump() for s in script.stories]))
            for story in script.stories:
                c.execute(insert(db.coverage).values(fingerprint=fingerprint(story), edition_id=run_id,
                    event_key=story.event_key, development=story.development,
                    sources=[s.model_dump() for s in story.sources], published_at=published_at))
            if pending and any(s.url in {x['url'] for x in blue['sources']} for story in script.stories for s in story.sources):
                c.execute(update(db.drafts).where(db.drafts.c.id == pending['id']).values(edition_id=run_id))
            c.execute(update(db.runs).where(db.runs.c.id == run_id).values(status='published', finished_at=published_at))
            c.execute(update(db.lease).where(db.lease.c.owner == run_id).values(until=0, owner=None))
        return {'status': 'published', 'edition_id': run_id}
    except Exception as exc:
        # Never put provider responses, source prompts or credentials in public logs.
        db.finish(engine, run_id, 'failed', time.time(), type(exc).__name__)
        raise
