# Private Preview verification — November 18, 2026

Scope: only `mattvildibill/radio`, branch `codex/ask-the-hosts-pilot`, and its
existing Vercel radio project. No production deployment, new provider, account,
storage service, paid Vercel feature, or shared-setting change.

Preview: https://radio-git-codex-ask-the-hosts-pilot-mattvildibills-projects.vercel.app/

Draft PR: https://github.com/mattvildibill/radio/pull/1

## Real 90-second acceptance run

Application commit `89e8d06`; started at 20:04:30 UTC, November 18.

- Sourced Responses research completed at **20:04:44.885 UTC**.
- Eli and Mara sessions started at **20:04:46.352 / 46.499 UTC**, after research.
- Both produced on-air PCM audio. The exported recording is 90 seconds.
- Both produced input transcripts matching their co-host's actual routed audio.
  For example Eli heard Mara question selection bias in the 2025 workweek study;
  Mara heard Eli question who carries the cost when coverage cannot slip.
- The typed hospital-staffing follow-up was queued at **20:05:21.503**, delivered
  to both at **20:05:36.890**, and addressed by Mara: patient coverage cannot
  stop on Friday, shift redesign matters, and long-term staffing-cost evidence
  is thinner. Eli's final response began "I buy that. In 24/7 settings, coverage
  isn't negotiable." The bounded pilot ended during that final contribution.
- Both sessions emitted `session.closed` with `close_requested` and **89 seconds
  each** of final voice usage; show cleanup completed at **20:06:17.296 UTC**.
- MediaRecorder saved the mixed conversation in IndexedDB on the protected
  Preview origin. After a full reload, it decoded and the actual replay audio
  element reached **10.05 seconds**, playing, with no media error.
- All eight transport, co-host input, follow-up delivery, closure, recording,
  and post-reload playback checks passed. These checks do not certify subjective
  chemistry or guarantee factual accuracy.

Research usage: **13,204 input tokens** (4,623 cached), **1,162 output tokens**
(215 reasoning), 14,366 total, one web-search call. Voice: **178 session-seconds**,
approximately $0.148 at the documented $0.05/session-minute rate, plus research.
This is an estimate, not an account invoice.

## Audio measurements and tuning

FFmpeg measured the real mixed recording at **-18.52 LUFS integrated**, **-1.01
 dBTP**, and **6.3 LU** loudness range. The opening Mara segment was -17.13 LUFS;
Eli's first segment was -21.21 LUFS. Handoff silences measured 1.66, 2.08, and
1.78 seconds. Neither audio measurement nor transcript inspection is represented
as a human listening panel.

Commit `a420d96` balances the routed voices with gains 0.9 / 1.4 before the mix
compressor, reduces the pause threshold from 1.25 to 1.0 seconds, uses the verified
relay for the default flow, and collapses source lists to keep the studio simple.
The full-length acceptance run below exercised that commit.

## Full-length real show

Commit `a420d96`: research completed **20:09:12.820 UTC**; both hosts started
about 1.4 seconds later. The show ended naturally at **8:56**, cleanup complete
at **20:18:10.545 UTC**. The final spoken sentence completed normally.

- Three sequential paired relay segments worked within Vercel's 300-second
  invocation limit. All six sessions emitted `session.closed` before cleanup.
  Both preceding sessions finalized before each continuation opened.
- The two continuations retained the aired conversation and listener follow-ups;
  the hosts resumed without new introductions.
- Two follow-ups were typed and submitted through the normal UI. The first
  changed the discussion to hospital coverage and cost. The second asked the
  hosts to take opposing positions. Eli advocated a limited funded trial; Mara
  initially preferred waiting, then changed to conditional support after Eli's
  argument. Both stated what evidence would change their positions.
- Incoming co-host transcripts contained 487 Mara and 602 Eli fragments,
  corroborating actual PCM delivery in both directions.
- Final accumulated voice usage: **527 seconds per host / 1,054 total**,
  approximately **$0.878** for voices. Research: **13,110 input tokens** (4,623
  cached), **1,126 output** (147 reasoning), 14,236 total, one search call.
- An explicitly started full-show recording saved with an **8:55** duration,
  original date/local time, MST / America/Denver zone, age and original sources.
  After reload, the actual saved audio played to **49.96 seconds** with no error.
- One earlier long turn reached the 40-second floor cap. The final implementation
  adds a finish-your-thought instruction at 28 seconds and prompts shorter,
  more varied contributions to reduce abrupt handoffs and repetitive agreement.

Final refinements also stop startup promptly on a provider error or browser
Stop, retain unknown usage as unknown, and prioritize source URLs actually cited
in the brief. Quota and stop-before-ready regression tests pass.

## Fixes established by actual testing

- The producer now has a 6,000-token allowance shared by reasoning and the brief,
  plus bounded searches and specific errors. Real research has completed.
- The WebRTC SDP offer's final CRLF must be preserved. Trimming it caused the
  OpenAI 400 response. After correction, the API accepted both sessions.
- The agent's Cloud Chrome produces no ICE candidates even with STUN, preventing
  direct WebRTC. The app now uses a same-project, server-side WebSocket audio
  relay by default. No extra service or key is required.
- Vercel installs from `pyproject.toml` / `uv.lock`, not just requirements.txt.
  Missing WebSocket dependencies caused a deployed 500 while local tests passed.
  Both manifests and the lockfile now agree; a locked sync imports the actual
  deployed modules. A regression check covers manifest consistency.
- `session.instructions.append` alone did not trigger speech. Explicit
  `session.commentary.append` at the opening and handoffs produced real speech.
- A no-cost authenticated relay preflight runs before paid research. Failed
  networking now stops without an OpenAI call.

## Bounded failed attempts and usage limits

Before the successful pilot, the agent ran five research requests (one search
per observed result), one pair of accepted WebRTC sessions that disconnected,
and one silent relay pair. The silent pair closed with **19 + 20 = 39 seconds**
final usage. The WebRTC pair was explicitly hung up via the server; its final
billable seconds were not returned. One of the five research token snapshots
was not retained, so no exact total-dollar claim is made. No spend-limit error
was retried and no project budget/settings were changed.

Known research totals for those preliminary requests: 14,179; 14,144; 14,346;
14,315 tokens, plus one unretained snapshot. Separate user-initiated attempts
before this work may have incurred usage outside this evidence.

## Local checks and remaining boundaries

- 37 Python tests and 9 JavaScript tests pass; browser modules pass syntax checks.
- Tests cover private admission, origin/owner/expiry restrictions, research
  failures and secret redaction, correct PCM routing, and paired finalization.
- Replay storage is private to this browser profile/device/origin. It is not
  cross-device storage, and clearing browser data removes it. Export to retain.
- No microphone permission is requested. Hidden tab, offline, Stop, and timeout
  stop the show. Browser crashes rely on transport disconnect handling.
- The private-owner pilot has no distributed concurrency or billing ledger.
  The external $15 OpenAI project budget is unchanged; it is not claimed to be
  a server-enforced app-level hard cap.
- Physical Safari/mobile and direct WebRTC audio in another browser are not
  verified. The default relay is the verified path.


## Final build check and usage ledger

Application commit `eccefbd` passed another real typed-question run: **"Why do
cities feel hotter than nearby countryside, and what actually helps?"** Research
completed before speech. Mara introduced the urban heat mechanism; Eli answered
her question with cooling-policy tradeoffs, and Mara responded to his point.
An explicit **End show** click at 51 seconds stopped recording and both sessions
returned **51 seconds**, final, `close_requested`. The recording saved normally.
Research used **12,968 input tokens** (4,591 cached), **1,109 output** (196
reasoning), 14,077 total, one search call.

The adjusted full-show mix measured **-19.33 LUFS integrated**, **-0.18 dBTP**,
5.3 LU loudness range. Sampled opening host segments were -20.22 LUFS (Mara)
and -18.80 LUFS (Eli), reducing the earlier four-decibel difference to about 1.4.
Generated output varies across turns; this is measured evidence, not a claim of
subjective listening or a guarantee about every future show.

Confirmed accumulated agent voice usage across retained tests is **1,373
session-seconds**, approximately **$1.144** at the documented rate. Seven retained
research snapshots total **99,663 tokens**; one earlier research snapshot and one
failed WebRTC pair's final seconds are unretained. Eight research requests ran in
all. These are API observations and estimates, not the OpenAI account invoice.
The $15 budget was not changed. No quota/spend error was automatically retried.

Final checks: 37 Python tests, 9 JavaScript tests, browser syntax checks, locked
dependency validation, and clean diff checks passed. The default app path has
real startup, reciprocal audio, typed follow-up, full-duration continuation,
natural ending, explicit Stop, saved recording, and post-reload replay evidence.
The test browser cannot provide a subjective listening review; captured audio,
co-host input transcripts, and signal measurements are retained separately from
that judgment. Safari/mobile and crash-finalization timing remain untested.
