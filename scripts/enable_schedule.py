"""Run only after free-tier/quota verification and a successful real edition."""
import json
import os
from pathlib import Path
from station.publisher import blockers

if blockers():
    raise SystemExit('Cannot enable schedule: ' + ', '.join(blockers()))
limit = int(os.environ['RADIO_MAX_DAILY_EDITIONS'])
if not 1 <= limit <= 4:
    raise SystemExit('Daily edition limit must be 1–4 and based on measured free quota')
path = Path(__file__).resolve().parents[1] / 'vercel.json'
config = json.loads(path.read_text())
config['schedules'] = {'radio-editions': {
    'schedule': '0 0,6,12,18 * * *', 'timezone': 'UTC', 'jitter': 15,
    'path': '/api/jobs/edition', 'requestMethod': 'POST'}}
path.write_text(json.dumps(config, indent=2) + '\n')
print('Schedule prepared; deploy this change to radio. The database enforces the measured daily cap.')
