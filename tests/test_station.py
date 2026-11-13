import time
import threading
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
import app as web
from station import database as db
from station.editorial import Script, fingerprint
from station.publisher import publish

URL = 'https://example.org/report'

def script(development='The council approved a new public transit line at its Tuesday meeting.'):
    texts = [
      "You're listening to Radio with Alex and Morgan, two synthetic hosts. The council approved a new public transit line at its Tuesday meeting. That's the decision described in the source, and it changes the status of the proposal from discussion to approval.",
      "What does approval actually mean for someone waiting at a bus stop? We should separate the decision from the work still required. The supplied report doesn't give us an opening date, so we shouldn't promise one or imply that service starts tomorrow.",
      "Exactly. This is a decision, not a completed project. My take is that the useful next question is about delivery: what milestones will let residents tell whether the plan is progressing? We'll return when there's a concrete development, rather than repeat this announcement under another headline."]
    return Script.model_validate({'title':'A decision, and the next question',
      'stories':[{'event_key':'city-transit-line','development':development,'material_change':development,
                  'sources':[{'title':'Council public record','url':URL}]}],
      'turns':[{'speaker':s,'kind':k,'text':t,'story':0} for s,k,t in zip(
          ['Alex','Morgan','Alex'],['reporting','question','commentary'],texts)]})

class Model:
    def __init__(self, edition=None, approved=True, fail=False):
        self.edition=edition or script();self.approved=approved;self.fail=fail;self.calls=0
    def write(self,*args):return self.edition
    def review(self,*args):return self.approved
    def narrate(self,*args):
        self.calls+=1
        if self.fail:raise RuntimeError('simulated generation failure')
        return b'complete-audio',60

class Storage:
    def upload(self,audio):return 'https://test.public.blob.vercel-storage.com/radio/audio/test.mp3'

@pytest.fixture
def engine(tmp_path):
    e=db.engine_for('sqlite:///'+str(tmp_path/'station.db'));db.initialize(e)
    yield e
    e.dispose()

def run(e,key,model=None,storage=None):
    return publish(e,model or Model(),storage or Storage(),key,max_daily=4,
                   feeds=[{'title':'Council record','url':URL,'summary':'A verified test fixture.'}])

def count(e,table):
    with e.connect() as c:return c.execute(select(func.count()).select_from(table)).scalar_one()

def test_duplicate_then_genuine_followup(engine):
    assert run(engine,'first')['status']=='published'
    assert run(engine,'duplicate')['status']=='no_news'
    follow=script('The council awarded the construction contract after approval of the transit line.')
    assert run(engine,'followup',Model(follow))['status']=='published'
    assert count(engine,db.editions)==2
    assert count(engine,db.coverage)==2

def test_semantic_rewording_rejected_by_editorial_review(engine):
    run(engine,'first')
    model=Model(script('At a meeting Tuesday, officials gave the proposed transit line their approval.'),approved=False)
    assert run(engine,'reworded',model)['status']=='no_news'
    assert model.calls==0
    assert count(engine,db.editions)==1

def test_publication_retry_is_idempotent(engine):
    model=Model()
    assert run(engine,'same',model)['status']=='published'
    assert run(engine,'same',model)['status']=='published'
    assert model.calls==1
    assert count(engine,db.editions)==1

def test_generation_failure_preserves_last_complete(engine):
    run(engine,'first');before=db.catalog(engine)
    with pytest.raises(RuntimeError):
        run(engine,'failure',Model(script('A contractor was selected for the transit construction on Friday.'),fail=True))
    assert db.catalog(engine)==before
    assert count(engine,db.coverage)==1

def test_upload_failure_is_not_published_then_retry_once(engine):
    class FailedStorage:
        def upload(self,audio):raise OSError('simulated Blob failure')
    with pytest.raises(OSError):run(engine,'retry',storage=FailedStorage())
    assert count(engine,db.editions)==0
    assert count(engine,db.coverage)==0
    assert run(engine,'retry')['status']=='published'
    assert run(engine,'retry')['status']=='published'
    assert count(engine,db.editions)==1

def test_concurrent_claims_allow_one_writer(engine):
    barrier=threading.Barrier(2)
    def claim(key):barrier.wait();return db.claim(engine,key,time.time(),4)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(claim,['a','b']))
    assert sorted(results)==['busy','claimed']

def test_daily_attempt_budget_counts_failures(engine):
    for i in range(4):
        with pytest.raises(RuntimeError):run(engine,str(i),Model(fail=True))
    assert run(engine,'fifth')['status']=='daily_limit'

def test_sources_not_in_inputs_rejected(engine):
    s=script();s.stories[0].sources[0].url='https://example.org/invented'
    with pytest.raises(ValueError):run(engine,'bad',Model(s))
    assert count(engine,db.editions)==0

def test_blue_handoff_auth_and_dedup(engine,monkeypatch):
    monkeypatch.setattr(web,'engine',engine);monkeypatch.setenv('BLUE_DRAFT_SECRET','test-blue-secret')
    client=TestClient(web.app)
    draft={'id':'feature-0001','title':'The long view of a transit decision',
           'thesis':'A detailed explanation of the approved public transit proposal.',
           'evidence':'The public council record contains an approved proposal for a new line.',
           'sources':[{'title':'Council record','url':URL},{'title':'Budget report','url':'https://example.org/budget'}]}
    assert client.post('/api/blue/drafts',json=draft).status_code==401
    headers={'Authorization':'Bearer test-blue-secret'}
    assert client.post('/api/blue/drafts',json=draft,headers=headers).json()['status']=='received'
    assert client.post('/api/blue/drafts',json=draft,headers=headers).json()['status']=='already_received'
    assert count(engine,db.drafts)==1
    draft['thesis']='A different thesis should not overwrite the previous handoff.'
    assert client.post('/api/blue/drafts',json=draft,headers=headers).status_code==409

def test_blue_absence_does_not_block_routine(engine):
    assert run(engine,'routine')['status']=='published'

def test_shared_clock_and_next_hour_cutover(engine,monkeypatch):
    monkeypatch.setattr(web,'engine',engine)
    run(engine,'fresh')
    now=time.time();anchor=int(now//3600)*3600
    with engine.begin() as c:c.execute(db.editions.update().values(published_at=anchor+10))
    client=TestClient(web.app)
    monkeypatch.setattr(web.time,'time',lambda:anchor+120)
    a=client.get('/api/station').json();b=client.get('/api/station').json()
    assert a['live']==b['live'];assert a['live']['item']['kind']=='evergreen'
    monkeypatch.setattr(web.time,'time',lambda:anchor+3605)
    a=client.get('/api/station').json()
    assert a['live']['item']['id']=='fresh';assert a['live']['offset']==5

def test_generation_disabled_without_verified_free_tier(monkeypatch):
    monkeypatch.setenv('CRON_SECRET','test-cron');monkeypatch.delenv('RADIO_FREE_TIER_VERIFIED',raising=False)
    c=TestClient(web.app)
    assert c.post('/api/jobs/edition').status_code==401
    assert c.post('/api/jobs/edition',headers={'Authorization':'Bearer test-cron'}).json()['status']=='disabled'

def test_no_database_still_serves_evergreen(monkeypatch):
    monkeypatch.setattr(web,'engine',None);c=TestClient(web.app)
    assert c.get('/').status_code==200
    assert c.get('/api/station').json()['live']['item']['kind']=='evergreen'
    r=c.get('/assets/interlude.mp3',headers={'Range':'bytes=0-127'})
    assert r.status_code==206 and len(r.content)==128

def test_fingerprint_ignores_case_and_punctuation():
    assert fingerprint(script().stories[0])==fingerprint(script().stories[0].model_copy(update={'development':script().stories[0].development.upper()}))
