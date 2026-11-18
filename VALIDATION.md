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

## November 18 follow-up: continuity and event-led research

After owner feedback about choppy sound and generic coverage, added a 240 ms
continuous playback timeline, retained partial PCM frames until complete, and
paced relay output against absolute deadlines to prevent accumulated clock drift.
Two new timing tests cover bursty arrivals and rebuffering after a true underrun.
37 Python and 11 JavaScript tests pass. The revised audio has not had a new
subjective listening review; this is a targeted fix, not proof of perceived quality.

A real Responses request on the private Preview using the owner's outages/hacks
question completed successfully with two searches, 21,842 input and 1,724 output
tokens. Its new opening_story, event_cards and episode_arc fields identified four
named dated incidents with source URLs and distinctions between compromise,
technical failure and unresolved cause. These are generated research results,
not an independent fact-check of every incident. No voice sessions were started
for that research-only check. Hosts are now cued to use concrete events in the
first minute and throughout, with no invented anecdotes or causal connections.

## November 18: adaptive editorial approach and replay upgrade

Implemented topic-specific producer plans (taste/news/explainer/advice/speculation/mixed),
complementary host interests rather than assigned counterarguments, source-linked
evidence cards, varied floor cues, early/recent conversation memory, and a FIFO
follow-up queue. Replays now append individual chunks and support rename, search,
and persisted transcript/research/usage notes. The IndexedDB v1 upgrade retains
old whole-blob recordings. The player now has one relay path.

Real private Preview research checks returned the expected approach for movies,
news, urban-heat explanation, EV advice for renters, and hypothetical human
photosynthesis. The final four-question research matrix used 63,829 total tokens
and five web-search calls. News included named dated incidents and primary sources
from Equinor and Google alongside reporting; the other modes used relevant EPA,
NASA, DOE and educational sources. This checks returned research and provenance,
not an independent forensic verification of every claim.

The first movie/news attempts exposed overly literal URL matching. Citation
tracking parameters are now normalized while meaningful query parameters remain
significant. Unlinked supplemental evidence is removed and disclosed; a brief
with no linked evidence still cannot start voices. Two failed checks retained
15,194 and 10,301 tokens; the first movie failure was not retained. An intermediate
successful news check used 15,206 tokens. No automatic retries were made.

### Long movie show and persistence

The movie show ran from 15:24:04 to 15:33:05 America/Denver on November 18, 2026.
Research completed before either host session started. The run used three pairs
of sessions, 22 floor assignments, and three listener follow-ups. Both hosts
received actual co-host audio (438 and 522 input-transcript fragments). Final
provider usage was 533 seconds per host (1,066 total, approximately $0.89 voice
at the documented $0.05/session-minute rate). Research used 14,972 tokens and one
search. Both sessions in every pair confirmed close_requested before continuation.

The transcript demonstrated building on a shared idea: Mara connected greatness
to rhythm; Eli picked up that thought with the bone-to-spaceship cut in 2001.
Queued questions about comedy and accessible films were delivered in order and
changed the discussion to Some Like It Hot and Fury Road. A later request led to
The Apartment. Eli proposed a starter trio and Mara offered Do the Right Thing
as a different preference without treating his choices as wrong.

The opt-in recording started after the opening and captured 8:39.44. It decoded
with ffmpeg, measured -19.5 LUFS integrated and -1.4 dB true peak. Renaming it to
“Movie night · conversational pilot” persisted. Search filtered out unrelated
recordings. After page reload, playback advanced beyond 11 seconds with readyState
4 and no media error. The exported persisted notes exactly matched the final
show notes, including both final provider usages. Existing recordings remained.

Late repetition and partial phrases were observed, not ignored: subsequent cues
explicitly request fresh examples, continuation memory prioritizes the latest
exchange, unfinished phrases get more breathing room, queued audio must drain,
and the next host's off-air speech must settle before its gate opens. The full
movie run spans earlier revisions; it is not a claim that every later tuning
change received another nine-minute listening test. The audioUnderruns counter
also includes gaps between generated utterances and cannot by itself diagnose
an audible network glitch.

### Short news show

A separate 80-second run opened with the November 13 FAA disruption, described
who was affected, and distinguished a technical failure from a confirmed attack.
The typed follow-up prompted a named cyberattack comparison. Both hosts closed
with final usage of 80 seconds each. Research used 15,131 tokens and one search.
This verified that concrete events reached the spoken output rather than staying
only in the producer brief. It also exposed off-air fragments at handoffs, leading
to the audio-gate settling change and a dedicated regression test.

Local verification: 46 Python tests and 14 JavaScript tests pass, including FIFO
follow-ups, off-air audio exclusion, source validation, v1 replay migration,
chunk ordering, storage-cap failure without overwriting captured audio, and
continuation memory. JavaScript syntax and the locked Python dependencies pass.
No new account, hosting/storage service, production deployment or shared setting
was used. Subjective warmth, pacing and the absence of every audible artifact
still require listening; transcript/media checks do not certify those qualities.

### Final audio-gate regression (c7f3405)

The built-in bounded 90-second pilot ended at a natural final pause after about
80 seconds, recording 1:21 including capture/closure overhead. Research used
14,916 tokens and one search. Both hosts produced on-air audio, both transcribed
received co-host audio, and the hospital follow-up changed Eli's answer to
continuous coverage, staffing rotas and costs. Both provider sessions confirmed
close_requested with final usage of 80 seconds each. The recorded opening of
Eli's turn began “Yeah. For a hospital…” without the stray leading fragments
seen in the preceding run. This is a targeted regression observation, not proof
that generation can never produce a disfluency.

After a page reload, the application successfully decoded this final recording.
Playback advanced past 24 seconds with readyState 4 and no media error; all eight
transport/replay checks in the saved pilot report passed.
Combined final provider usage for the movie, news and audio-gate tests was 1,386
session-seconds, approximately $1.16 voice, plus separate research/search usage.
The successful four-mode research matrix and these three show briefs used 108,848
tokens; intermediate/failed research above is additional. These are retained
request measurements, not an account balance or complete OpenAI billing export.
