"""A single dedicated Postgres database; SQLite is only a local test adapter."""
import os
from sqlalchemy import (create_engine, MetaData, Table, Column, String, Float,
                        Integer, Text, JSON, select, insert, update, func)
from sqlalchemy.pool import NullPool

metadata = MetaData()
editions = Table('radio_editions', metadata,
    Column('id', String, primary_key=True), Column('title', Text, nullable=False),
    Column('published_at', Float, nullable=False), Column('duration', Float, nullable=False),
    Column('audio_url', Text, nullable=False), Column('audio_bytes', Integer, nullable=False),
    Column('transcript', JSON, nullable=False), Column('stories', JSON, nullable=False))
coverage = Table('radio_coverage', metadata,
    Column('fingerprint', String, primary_key=True), Column('edition_id', String, nullable=False),
    Column('event_key', String, nullable=False), Column('development', Text, nullable=False),
    Column('sources', JSON, nullable=False), Column('published_at', Float, nullable=False))
runs = Table('radio_runs', metadata,
    Column('id', String, primary_key=True), Column('status', String, nullable=False),
    Column('started_at', Float, nullable=False), Column('finished_at', Float),
    Column('attempts', Integer, nullable=False), Column('detail', String))
lease = Table('radio_lease', metadata, Column('id', Integer, primary_key=True),
    Column('owner', String), Column('until', Float, nullable=False))
drafts = Table('radio_blue_drafts', metadata,
    Column('id', String, primary_key=True), Column('body', JSON, nullable=False),
    Column('received_at', Float, nullable=False), Column('edition_id', String))

def engine_for(url=None):
    url = url or os.getenv('DATABASE_URL') or os.getenv('POSTGRES_URL')
    if not url:
        return None
    if url.startswith(('postgres://', 'postgresql://')):
        url = 'postgresql+psycopg://' + url.split('://', 1)[1]
    if os.getenv('VERCEL') and not url.startswith('postgresql+psycopg://'):
        raise ValueError('Production requires dedicated Postgres')
    return create_engine(url, poolclass=NullPool, connect_args={'connect_timeout': 5}
                         if url.startswith('postgresql') else {})

def initialize(engine):
    metadata.create_all(engine)
    # Initialization runs before enabling schedules, never on listener requests.
    with engine.begin() as c:
        if not c.execute(select(lease.c.id)).first():
            c.execute(insert(lease).values(id=1, until=0))

def catalog(engine):
    if engine is None:
        return []
    with engine.connect() as c:
        return [dict(r) for r in c.execute(select(editions).order_by(
            editions.c.published_at.desc()).limit(100)).mappings()]

def claim(engine, run_id, now, max_daily):
    """Atomically serialize writers and reserve daily quota before external calls."""
    with engine.begin() as c:
        if c.execute(update(lease).where(lease.c.id == 1, lease.c.until < now)
                     .values(owner=run_id, until=now + 360)).rowcount != 1:
            return 'busy'
        def release(result):
            c.execute(update(lease).where(lease.c.id == 1).values(until=0, owner=None))
            return result
        previous = c.execute(select(runs).where(runs.c.id == run_id)).mappings().first()
        if previous and previous['status'] in ('published', 'no_news'):
            return release(previous['status'])
        if previous and previous['attempts'] >= 2:
            return release('attempt_limit')
        used = c.execute(select(func.coalesce(func.sum(runs.c.attempts), 0)).where(
            runs.c.started_at >= now - now % 86400)).scalar_one()
        if used >= max_daily:
            return release('daily_limit')
        stored = c.execute(select(func.coalesce(func.sum(editions.c.audio_bytes), 0))).scalar_one()
        if stored > 400_000_000:
            return release('storage_limit')
        if previous:
            c.execute(update(runs).where(runs.c.id == run_id).values(
                status='running', started_at=now, attempts=previous['attempts'] + 1))
        else:
            c.execute(insert(runs).values(id=run_id, status='running', started_at=now, attempts=1))
        return 'claimed'

def finish(engine, run_id, status, now, detail=None):
    with engine.begin() as c:
        c.execute(update(runs).where(runs.c.id == run_id).values(
            status=status, finished_at=now, detail=detail))
        c.execute(update(lease).where(lease.c.owner == run_id).values(until=0, owner=None))
