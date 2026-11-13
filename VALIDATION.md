# Validation record

Production URL: https://radio.mattvildibill.com/

Application revision: `c2d2353` (initial app plus two Vercel packaging fixes).
Vercel production deployment: `dpl_23Z1XB76UfQjc2xJswWchzG6Zn77`.
Project: `prj_xis6TWeCFzr2f0acjUjx92SPTAtC`; account: `team_MIAl94GGSmIOtH1nytFMKdpU`.
Deployment API explicitly reported **Hobby**, `READY`, and `target: production`.

## Verified in production

- HTTPS certificate validation, HTTP 200 home page, health and station API.
- The custom subdomain is verified and correctly configured in Vercel. No DNS edits.
- Actual MP3 bytes and HTTP 206 range responses.
- Chromium with 390×844 mobile viewport/touch: user-initiated evergreen playback.
- Two browser tabs synchronized to the shared UTC clock within **0.127 seconds**.
- “Play something new” correctly reports that no fresh edition is published yet.
- No horizontal overflow at the tested mobile size; no JavaScript errors.
- Scheduler, database initialization and Blue endpoints return 401 without auth.
- `generation_active: false`; there is no active publishing schedule.

Browser HTTPS checks used the environment proxy with TLS verification enabled.
The final run used the outer execution context, which has the appropriate browser
CA trust. The site's CSP remained enforced; no insecure-certificate flags were used.
This was Chromium mobile emulation, not a physical iPhone/Safari listening test.

## Local checks

`pytest -q`: **14 passed**, with SQLite and controlled model/storage fixtures.

- Replayed identical development is rejected.
- New development for the same event publishes.
- Semantic-review rejection suppresses a reworded duplicate before narration.
- Retrying a completed publication does not narrate or publish twice.
- Generation failure preserves the previous complete edition and coverage.
- Upload failure creates no publication; retry commits exactly once.
- Concurrent claims admit only one writer.
- Failed attempts count toward the daily cap.
- Invented source URLs are rejected.
- Blue authentication, identical retry and conflicting-ID rejection.
- Absence of Blue does not prevent routine publishing.
- Shared UTC clock and next-hour publication cutover.
- Missing free-tier verification disables generation.
- Missing database still permits evergreen playback and range requests.
- Coverage fingerprint ignores case and punctuation.

Separate browser fixture checks passed for on-demand audio, transcript rendering,
heard-state persistence after reload, caught-up state, and live pause/resume.
The fixture used the instrumental interlude, not a fabricated news recording.

## Not verified / external prerequisites

- No real Gemini text or two-speaker audio was generated, listened to or evaluated.
- No dedicated production Postgres database is connected.
- Blob creation was rejected with `403 forbidden`, action `create`, resource `blob`.
  The radio-only project token cannot provision this account-level resource.
- Real Postgres/Blob publication, provider failure recovery and quotas remain untested.
- No two cloud-scheduled editions have run. No schedule is active.
- No real Blue connection/task or handoff exists. Only the authenticated handler
  was tested locally with a controlled fixture.
- No physical-device or Safari playback test was performed.

## Exact next account steps

1. In the **existing radio Vercel project**, open **Storage**. Create a new public
   Blob store named `radio-audio`, connect only radio, and retain the Hobby/free
   plan. It should inject `BLOB_READ_WRITE_TOKEN` into radio's Production settings.
2. From the same project's Storage view, create/connect a dedicated **Neon Free**
   database named `radio`, without a paid plan, trial or billing upgrade. Connect
   only radio and ensure the server-side Production variable is `DATABASE_URL`
   (or `POSTGRES_URL`). If the interface requires a payment method or paid plan,
   stop rather than accepting it.
3. In Google AI Studio, create a dedicated radio API project and key with billing
   disabled / Free tier. Add the key only to the radio project's server-side
   Production environment as `GEMINI_API_KEY`. Confirm the actual text and
   multi-speaker TTS free quotas in AI Studio before enabling generation. Never
   paste the key in chat. Model IDs and cadence remain unset until measured.
4. For a real Blue feature, make its connection available, or configure one new
   radio-only task using the handoff contract in README. Do not alter existing tasks.

The agent can then recheck the radio-only credentials, initialize schema, verify
models/quotas, generate and listen to a real edition, enable the measured cadence,
and observe two separate cloud-scheduled publication runs.
