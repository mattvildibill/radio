# Ask the Hosts — private radio Preview pilot

A typed question goes to an OpenAI Responses producer with web search. Only after a
completed, sourced brief does the browser open **two GPT-Live sessions**:
Mara (Gleam) and Eli (Vesper). They receive the same factual brief and separate
angles. Their actual received audio is cross-routed through the private server relay; no script
or text-to-speech substitution supplies the co-host's words.

**Current status:** the private Preview completed a real 90-second, two-host
OpenAI show, answered the hospital follow-up, finalized both sessions, and
replayed the saved conversation after reload. Full-duration verification is
recorded in [VALIDATION.md](VALIDATION.md).

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

Use the existing **Vercel Authentication** gate on this stable branch Preview:

https://radio-git-codex-ask-the-hosts-pilot-mattvildibills-projects.vercel.app

The only required application credential is the user's newly added server-side
`OPENAI_API_KEY` in **radio Preview**. No second pilot password is needed, and
older keys/integrations remain untouched. Do not reveal or copy the key to the
browser. Existing Vercel authentication is the access-control authority.

Before granting an app session or starting any new billable request, the server
probes `/api/privacy-probe` on that **exact fixed radio Preview hostname** with
no authentication, cookies, or redirect following. It must get the verified
Vercel SSO redirect. If protection is disabled the app's probe returns 204, and
admission fails closed; unknown responses and network failures also block starts.
Other hostnames and non-Preview environments cannot start this pilot. Only the
stable branch URL is supported; immutable deployment URLs are intentionally not
accepted for show starts.

After Vercel authentication and the protection check, the app issues a 12-hour
Secure, HttpOnly, SameSite=Strict browser cookie. Capability-signing material is
derived server-side from OPENAI_API_KEY with a separate HMAC purpose. The API key
and derived secret are never returned. Research tickets expire after 20 minutes
and are bound to that browser session. Mutating routes require the same origin.
Closing uses a separate short-lived capability so session cleanup remains
possible after app access expires. No cross-origin CORS is enabled.

The private pilot assumes a trusted owner: signed brief tickets can be reused
within their expiry and there is no distributed concurrency/spend ledger. Do not
open this app to a wider audience without durable server-side metering and
single-use admission control. No Vercel protection settings are changed by code.

## Live show and cost controls

- Responses: `gpt-5.6-luna`, web search, at most three tool calls, 6,000 output
  tokens shared by reasoning and the final brief, low reasoning, a compact editorial brief (target under 650 words),
  no stored response. Sources come from actual search
  actions/citations; no sourced brief means no host sessions.
- GPT-Live: `gpt-live-1`, `store: false`, client delegation. No paid backend
  delegation is launched during the show. Follow-ups needing new facts are
  acknowledged as uncertain rather than invented.
- A show runs for **up to nine minutes**, ending at a natural closing pause in
  the final 15 seconds. A same-project WebSocket relay carries PCM audio. It uses Fluid Compute,
  capped at the Hobby-compatible 300 seconds per invocation. Relay segments
  end at a natural handoff after three minutes (hard cap 210 seconds); both
  sessions finalize before the next pair starts with the aired conversation
  and follow-ups as context. The whole show remains capped at nine minutes.
  No database, new hosting service, or paid Vercel feature is needed.
  The player uses one verified relay path. The experimental WebRTC player was
  removed so conversation rules no longer diverge between transports.
- The controller assigns the floor, routes only on-air audio to the listener and
  co-host, and waits for measured media silence before handoff. An opening-only 15-second emergency cap prevents one host owning the introduction.
  Later turns retain a 40-second safety cap for occasional longer stories. Gentle
  timing notes use context, not mid-speech instruction replacement; these are
  safeguards, not the desired duration of every turn. Short `session.commentary.append` cues actually trigger
  speech; instruction changes alone do not guarantee a greeting. One silence cue is allowed, then the show stops; it never
  retries failed paid sessions. Planned relay continuations require confirmed
  closure of the previous pair; they are not error recovery.
- Both hosts have separate context and receive the other host's audio. A typed
  follow-up is added to both at the next handoff. The next host is cued to answer.
- Stop, nine-minute timeout, hidden tab, suspended audio, offline state, peer
  disconnect, or provider error closes both sessions. Normal closure waits for
  `session.closed`; missing finalization is disclosed. Unload sends Stop and closes
  the relay socket. The connection-owned server task closes both upstream sessions;
  abrupt process loss still depends on provider transport-disconnect handling.
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
surface an export link. One-second chunks are appended independently, without rewriting growing audio blobs.
Partial audio is retained on abrupt closure, marked “Recording · interrupted.”

Each replay says **Recording**, shows the original local date/time with the
recorded IANA time zone, elapsed age, duration, research timestamp and source
links. Reload preserves the library; clearing site data removes it. There is no
cross-device sync. Use the same stable branch-preview origin across deployments,
and export important recordings. Browser profiles/OS accounts provide local
storage privacy; a studio passphrase is not encryption of IndexedDB.

### Short pilot check

Open **Try a short pilot → Run & record a 90-second pilot** in the protected
Preview. This explicitly opts into recording, runs the same research and live
audio paths as an ordinary show, and injects a hospital-staffing follow-up after
35 seconds. Both sessions close by 90 seconds, or at a natural closing pause in the final 15 seconds; Stop still works at any time.
There are no retries or additional model calls for evaluation.

The report preserves timestamped input/output transcript fragments, measured
on-air audio levels, research sources/usage, closure events and final session
usage in this browser. It excludes API keys and signed app capabilities. Click
**Reload to check saved playback**, then play the saved Recording. The report
separately records successful post-reload audio decoding and playback. Download
the report and export audio for review. Transport checks do not automatically
certify natural conversation, voice quality, factual accuracy, or whether a
spoken follow-up answer is relevant; those require listening.

## Development and checks

```sh
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q
npm test
npm run check
# Local rendering is available; paid calls require the protected Preview:
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
The runtime uses direct HTTPX and WebSocket calls; no AI Gateway, older integration, or SDK
retry behavior is involved.

## Adaptive conversation

The producer selects taste, news, explainer, advice, speculation, or mixed based
on listener intent. Taste episodes explore specific works and different criteria;
news episodes require named dated events, affected people and explicit unknowns.
The structured brief includes source-linked claims, limitations, an opening idea,
optional threads, and separate host interests. Mara notices craft and mechanisms;
Eli follows emotional impact and unexpected connections. Neither is assigned an
opposing conclusion. Agreement, questions and changed minds are welcome.

Regular floor cues only grant the microphone: no rotating reaction/question/example
assignments. Hosts choose their next contribution from the actual conversation.
Most contributions should be a sentence or two, with natural variation; interesting
stories may take longer. Both hosts introduce themselves, with an opening target
of the second host audible within 12 seconds of the first. This target is measured
separately from the transport checks and is not a guarantee of subjective quality. An
explicitly unfinished thought can get one continuation, unless a listener is
waiting. Silence-based handoffs remain sequential: overlap is intentionally deferred.
Across relay segments, bounded memory preserves the opening, recent actual spoken
words, stated views and delivered requests, without another paid summarization call.
Up to eight follow-ups queue in order with visible delivery status. Pending requests
survive a planned segment transition. Delivered does not prove the model answered well.

Replays can be renamed and searched by title or original question. New recordings
include exported transcript/research/usage notes; existing whole-blob recordings
remain readable after the IndexedDB upgrade. No new hosting or storage service is used.

### Editorial acceptance examples

| Listener prompt | Desired approach | Reject |
| --- | --- | --- |
| Best movies ever? | Specific favorites, shared enthusiasm, different criteria and examples | A forced debate or mandatory current-news hook |
| Recent outages and hacks—should I worry? | Named dated incidents, people affected, primary sources, technical failure versus confirmed intrusion | Generic outage explanations or invented coordination |
| Why are cities hot at night? | A familiar observation, an understandable mechanism, a concrete example | A list of abstract definitions |
| EV when I rent without a charger? | A realistic charging routine, costs and missing personal context | Universal advice or irrelevant argument |
| What if humans could photosynthesize? | A playful hypothetical anchored in biology and clearly marked assumptions | Presenting an imagined scenario as observed fact |

For live acceptance, inspect both received co-host audio transcripts and actual
on-air output; sending a cue is not proof of a response. Queue two requests before
a handoff and verify their order and relevance. Across a segment transition, check
that the show retains early preferences and recent context without another intro.
Record, stop, rename, search, reload, and play the saved media. Compare the audible
result separately: text and RMS measurements cannot certify warmth, chemistry or
absence of every click. Keep real runs bounded and retain final provider usage.

The producer's opening is a question or situation of at most 20 words, not an
answer paragraph. Optional paths are at most three short questions (500 characters),
not a running order. Stable host preferences remain distinct from per-episode
curiosities. Facts stay in shared evidence cards. No extra scriptwriting, critic,
director or research agents run during a show.

`conversationMetrics` reports actual second-host entrance, first-minute contributions
and forced handoffs. The unused browser FloorController and its timing tests were
removed: the Python relay is the only live microphone controller. The retained
formatting/source utilities remain in controller.js for import compatibility.
