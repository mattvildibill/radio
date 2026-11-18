# Ask the Hosts — private radio Preview pilot

A typed question goes to an OpenAI Responses producer with web search. Only after a
completed, sourced brief does the browser open **two GPT-Live WebRTC sessions**:
Mara (Gleam) and Eli (Vesper). They receive the same factual brief and separate
angles. Their actual received audio is cross-routed through Web Audio; no script
or text-to-speech substitution supplies the co-host's words.

**Current status:** implementation and local checks are complete; real OpenAI
voice audition, private Preview deployment, and real-API acceptance remain
unverified. See [VALIDATION.md](VALIDATION.md). Do not describe the local tone test
as an AI show.

## Scope

- Only `https://github.com/mattvildibill/radio.git`.
- Only the existing Vercel `radio` project in `mattvildibills-projects`.
- Recorded project ID: `prj_xis6TWeCFzr2f0acjUjx92SPTAtC`.
- Recorded team ID: `team_MIAl94GGSmIOtH1nytFMKdpU`.
- Branch `codex/ask-the-hosts-pilot`; Preview only. Do not merge or deploy Production.
- Do not create a replacement Vercel project when access fails. Do not change
  shared settings, other projects, old credentials or integrations.

This branch replaces the inactive station. Its original implementation remains
in Git history (`3223524`). No database, Blob store, cron, Gemini key, or old
integration is used by this app. No external settings were removed or modified.

## Private access and credentials

Set these **only in radio's Preview environment**:

- `OPENAI_API_KEY`: the user's newly added OpenAI project key. Never expose or
  copy it to browser code. It is sent only to `https://api.openai.com/v1`.
- `RADIO_PILOT_PASSWORD`: a separate random passphrase of at least 24 characters.
  Use it to unlock the studio. Keep it out of Git and chat logs. Existing secrets
  are not substitutes. Without it all show starts fail closed.

The passphrase issues a 12-hour HttpOnly, SameSite=Strict cookie (Secure on
Vercel). Mutating routes require same-origin requests. Producer tickets are
signed, expire after 20 minutes, and are bound to the authenticated browser.
Closing a session uses a separate scoped, signed capability so the browser can
still close on unload or after access expires. No cross-origin CORS is enabled.
The app rejects research/session creation when `VERCEL_ENV=production`.
Keep existing Vercel Deployment Protection enabled as an additional outer gate.

The private pilot assumes a trusted owner: signed brief tickets can be reused
within their expiry and there is no distributed concurrency/spend ledger. Do not
open this app to a wider audience without durable server-side metering and
single-use admission control.

## Live show and cost controls

- Responses: `gpt-5.6-luna`, web search, at most three tool calls, 2,600 output
  tokens, low reasoning, no stored response. Sources come from actual search
  actions/citations; no sourced brief means no host sessions.
- GPT-Live: `gpt-live-1`, `store: false`, client delegation. No paid backend
  delegation is launched during the show. Follow-ups needing new facts are
  acknowledged as uncertain rather than invented.
- A show runs for **nine minutes**. Vercel handles short research/signaling/close
  requests; audio travels browser ↔ OpenAI and does not require a nine-minute
  serverless invocation or server WebSocket.
- The controller assigns the floor, routes only on-air audio to the listener and
  co-host, and waits for measured media silence before handoff. A 40-second floor
  cap bounds monologues. One silence cue is allowed, then the show stops; it never
  creates replacement paid sessions automatically.
- Both hosts have separate context and receive the other host's audio. A typed
  follow-up is added to both at the next handoff. The next host is cued to answer.
- Stop, nine-minute timeout, hidden tab, suspended audio, offline state, peer
  disconnect, or provider error closes both sessions. Normal closure waits for
  `session.closed`; missing finalization is disclosed. Unload also sends server
  hangup beacons and closes peers. Browser/process crashes rely on OpenAI's
  transport-disconnect handling; a beacon is best effort, not a server watchdog.
- No automatic HTTP retries or model fallback, including quota/spend-limit errors.
- Usage: record the latest cumulative `usage.seconds` per host, replace rather
  than add snapshots, retain final usage and research tokens in downloadable notes.
- Official GPT-Live pricing checked November 18, 2026: **$0.05 per session-minute**.
  Two nine-minute sessions are approximately **$0.90 voice**, plus connection/
  shutdown time and separate research/search costs. A 15-second startup charge is
  credited against running duration. This is an estimate, not an invoice.
- The $15 OpenAI project budget remains external; the app cannot verify that a
  dashboard budget is a hard billing cap. Check remaining project spend before
  repeated shows. Local tests do not call OpenAI; real acceptance should use one
  short show, promptly stopped.

## Recording and replay

Recording is opt-in, via **Record & save**. MediaRecorder captures the compressed
mixed stream before listener volume control. No microphone is requested.
Recordings and metadata are stored in **IndexedDB on this browser/device/origin**,
not uploaded. The library has a 100 MB application cap; storage/quota failures
surface an export link. One-second checkpoints retain partial audio on abrupt
closure, marked “Recording · interrupted.”

Each replay says **Recording**, shows the original local date/time with the
recorded IANA time zone, elapsed age, duration, research timestamp and source
links. Reload preserves the library; clearing site data removes it. There is no
cross-device sync. Use the same stable branch-preview origin across deployments,
and export important recordings. Browser profiles/OS accounts provide local
storage privacy; a studio passphrase is not encryption of IndexedDB.

## Development and checks

```sh
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q
npm test
npm run check
# Supply the two server environment variables securely, then:
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8766
```

A local-only browser fixture tests the actual IndexedDB library and actual replay
UI with mixed test tones, without any provider credentials:

```sh
.venv/bin/uvicorn tests.browser_fixture:fixture --host 127.0.0.1 --port 8765
# Open /storage-check, save the clearly labeled test mix, follow the library link,
# reload and play it. /api/research deliberately returns a quota failure.
```

`tests.browser_fixture` is never imported by `app.py`; it is not a deployed route.

## Preview rollout and acceptance

Run `python scripts/verify_scope.py` before pushing. If a radio-scoped
`RADIO_VERCEL_TOKEN` is already available it also verifies project identity; absent
Vercel access, it verifies only the Git target and refuses any claim about the
remote project. Never print tokens or environment-variable values.

Push the branch to radio. Its existing Git integration may create a Preview.
Otherwise use Vercel's existing project's Git-connected Preview deployment flow,
after verifying project identity. Never use `--prod`, create/relink a project,
change production domains, or alter account settings.

Before calling this finished, run one **short real-API show on the protected
Preview**. Verify research precedes speech; listen to both voices; confirm
co-host input transcripts reflect played speech; send a follow-up and hear a
contextual answer; record, stop, reload and play the saved conversation. Check
both `session.closed` events and report measured API usage. Do not infer audible
success from transcripts or local tests alone. A full eight-to-ten-minute runtime
and Safari/mobile compatibility need their own verification if not exercised.

Reference contracts checked against OpenAI Python SDK 3.55.0 and official docs:
[GPT-Live WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc),
[session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations),
[GPT-Live pricing](https://developers.openai.com/api/docs/models/gpt-live-1).
The runtime uses direct HTTPX calls; no AI Gateway, older integration, or SDK
retry behavior is involved.
