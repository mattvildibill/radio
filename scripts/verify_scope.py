"""Read-only guard. Never enumerate or relink other projects."""
import json
import os
import subprocess
import urllib.request

PROJECT = 'prj_xis6TWeCFzr2f0acjUjx92SPTAtC'
TEAM = 'team_MIAl94GGSmIOtH1nytFMKdpU'
REPO = 'https://github.com/mattvildibill/radio.git'

def verify():
    remote = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], text=True).strip()
    if remote != REPO:
        raise SystemExit('STOP: unexpected Git remote')
    req = urllib.request.Request(
        f'https://api.vercel.com/v9/projects/{PROJECT}?teamId={TEAM}',
        headers={'Authorization': 'Bearer ' + os.environ['RADIO_VERCEL_TOKEN']})
    with urllib.request.urlopen(req, timeout=20) as response:
        project = json.load(response)
    link = project.get('link', {})
    if (project['id'], project['name'], project['accountId'], link.get('org'), link.get('repo')) != (
            PROJECT, 'radio', TEAM, 'mattvildibill', 'radio'):
        raise SystemExit('STOP: Vercel project or Git integration mismatch')
    print('Verified radio repository, account ID, project ID, and existing Git integration.')

if __name__ == '__main__':
    verify()
