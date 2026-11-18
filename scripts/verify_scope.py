"""Read-only scope guard. Never enumerate or relink other projects."""
import json
import os
import subprocess
import urllib.request
PROJECT = 'prj_xis6TWeCFzr2f0acjUjx92SPTAtC'
TEAM = 'team_MIAl94GGSmIOtH1nytFMKdpU'
REPO = 'https://github.com/mattvildibill/radio.git'

def verify():
    remote = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], text=True).strip()
    branch = subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip()
    if remote != REPO or branch != 'codex/ask-the-hosts-pilot':
        raise SystemExit('STOP: unexpected Git remote or pilot branch')
    config = json.load(open('vercel.json'))
    if config.get('framework') != 'fastapi' or config.get('crons'):
        raise SystemExit('STOP: unexpected deployment config')
    print('Verified radio Git remote, pilot branch, FastAPI config and no schedule.')
    token = os.getenv('RADIO_VERCEL_TOKEN')
    if not token:
        print('Vercel identity remains unverified: no scoped token available. Git push only; no direct deployment authorized by this guard.')
        return
    req = urllib.request.Request(f'https://api.vercel.com/v9/projects/{PROJECT}?teamId={TEAM}',
                                 headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=20) as response: project = json.load(response)
    link = project.get('link', {})
    if (project['id'], project['name'], project['accountId'], link.get('org'), link.get('repo')) != (
            PROJECT, 'radio', TEAM, 'mattvildibill', 'radio'):
        raise SystemExit('STOP: Vercel project or Git integration mismatch')
    print('Verified existing radio Vercel project and Git integration.')
if __name__ == '__main__': verify()
