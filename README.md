# Radio

A small FastAPI radio station for `radio.mattvildibill.com`. Fictional synthetic
hosts **Alex** (Kore, clear-eyed explainer) and **Morgan** (Puck, curious challenger)
discuss a few sourced developments, with commentary explicitly labeled.

## Scope

- Repository: `mattvildibill/radio`, existing visibility preserved.
- Vercel project: `radio`, `prj_xis6TWeCFzr2f0acjUjx92SPTAtC`.
- Owning account ID: `team_MIAl94GGSmIOtH1nytFMKdpU`.
- Only custom domain: `radio.mattvildibill.com`.
- Never modify the portfolio, other projects, shared settings or existing automations.
- Use this checkout. Cloud tasks are already isolated; do not create a worktree
  unless the user explicitly requests one.

## Current activation state

Generation is disabled and no schedule is registered. No Gemini account, model
quota, production Postgres, or production Blob store has been verified. The app
can serve its original, clearly labeled evergreen instrumental interlude without
any of those integrations. This is not a completed news station yet.

The project identity and existing Git integration were verified with Vercel’s
API. The production deployment independently reports `plan: hobby`, verifying the
free account despite the account-level billing endpoint denying access. The
player is deployed at https://radio.mattvildibill.com with working HTTPS and
evergreen playback. This token cannot create Blob stores (Vercel returned 403);
no store was created. Do not substitute an upgrade, trial, credit balance, billing
alert, or paid fallback for a free plan that stops at its limit.

## Local development

```sh
cd /workspace/radio
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
```

No secrets are required to run the player with the evergreen interlude. Tests use
SQLite as a disposable adapter and controlled provider doubles; they do not
establish real Gemini, Blob, Postgres, Blue or scheduled-cloud success.

## Free-only production setup

1. Verify the owning Vercel account is **Hobby**, with hard free limits. Do not
   change account-wide settings. The current Schedules beta supports Hobby with
   a 15-minute jitter window and hard monthly run limits. Legacy Cron Jobs differ.
2. Provision one **radio-only Postgres database** on a verified free plan (for
   example Neon Free, with no paid upgrade or overages). Connect it only to radio
   and set `DATABASE_URL` in radio's server-side Production environment. Use TLS.
   A Vercel token does not automatically authorize a new database provider account.
3. Create one **public Vercel Blob store dedicated to radio**, on the verified
   Hobby account, and connect only radio. Set its `BLOB_READ_WRITE_TOKEN`. Hobby
   stops access when free usage is exceeded; it does not bill overages.
4. In Google AI Studio create/select a **dedicated radio API project with billing
   disabled**. A Gemini consumer subscription is not proof of API access. Inspect
   the actual free-tier model limits in AI Studio, including text and two-speaker
   speech. Set `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_TTS_MODEL` only in
   radio's server-side settings. Never place credentials in source or chat.
5. Confirm the specific text model and TTS model work with the account. Measure a
   short real edition: two text calls (writer + independent editor) and one TTS
   call, including tokens, time and quota. Listen to it. Check that the selected
   TTS model supports Kore/Puck in `multiSpeakerVoiceConfig`. If free TTS is
   unavailable, leave generation disabled; do not select a paid fallback.
6. `CRON_SECRET` and `BLUE_DRAFT_SECRET` are separate random radio-only secrets.
   Production values were created directly in radio's Vercel settings. Do not
   rotate or overwrite existing values unnecessarily.
7. Initialize the dedicated database using authenticated
   `POST /api/admin/initialize`. No public request creates schema automatically.
8. Once free plans and actual quotas are verified, set
   `RADIO_FREE_TIER_VERIFIED=1`, `RADIO_GENERATION_ENABLED=1`, and
   `RADIO_MAX_DAILY_EDITIONS=1` initially. These flags record an operator's completed
   verification; they do not perform or prove billing verification themselves.
9. After a real edition passes audio/listener checks, run
   `python -m scripts.enable_schedule` with the verified settings available, and
   deploy the resulting `vercel.json` to **only** the existing radio project.
   Four UTC opportunities (00:00, 06:00, 12:00, 18:00, plus up to 15 minutes jitter)
   are bounded by the database daily attempt limit. Raise the limit to at most 4
   only after measured free quota supports it. Failed attempts count against it.

Provider requests never automatically retry quota failures or switch models.
Audio duration is bounded to 30–300 seconds and compressed to 48kbps MP3. At
400MB of published audio or 1,000 coverage records the generator stops safely
pending maintenance; it never deletes coverage history or silently incurs costs.
Unpublished uploads after a failed transaction can be orphaned. Inspect and remove
only confirmed radio orphans during maintenance; free Blob hard limits still apply.

Public sources currently used: BBC World RSS, NPR News RSS, NASA news releases.
Only recent (48h) dated entries are considered. Unsupported redirects and failed
feeds are skipped. Source excerpts and Blue submissions are untrusted data.
No full-article scraping, paid news API or model web-search tool is used.

## Publication and failure behavior

The Postgres writer lease serializes generation. Each six-hour UTC slot has a
stable publication ID. A completed slot can be retried without narrating or
publishing again; failed attempts are capped and count against daily usage.

All retained development history is provided to both the writer and a separate
editorial review. Exact normalized developments are rejected in code; the editor
must reject semantic paraphrases without material new facts. This model-based
judgment is not perfect and requires evaluation against real news before activation.
Coverage and publication state are committed together, only after complete audio
is uploaded and its size/content type verified. Generation or upload failure
leaves the previous edition unchanged. A database outage falls back to the bundled
evergreen audio; it does not expose an incomplete edition.

## Listening

**Play something new** chooses the newest unheard edition, with completed listens
stored on the device. It reports when caught up; no account or tracking is needed.
**Tune in live** joins an hourly UTC program snapshot at the current offset. The
latest edition available at the start of the hour alternates with evergreen
audio. Newly published editions enter live rotation at the next UTC hour, while
on-demand listeners can hear them immediately. Live joins do not mark an edition
heard. User interaction is required for mobile audio playback.

The interlude is an original 60-second synthesized instrumental, not a news report
or an example of Gemini speech. Its source recipe is documented in
`scripts/make_interlude.py`. Synthetic host disclosure appears in the player and
is required in generated introductions. Transcript turns distinguish reporting,
questions and commentary; stories include source links and material changes.

## Blue handoff

No Blue connection or task is configured. Configure only a new radio-specific task
once Blue access is available. It should submit one deeper feature, never own the
routine schedule, and use its dedicated bearer credential:

```http
POST https://radio.mattvildibill.com/api/blue/drafts
Authorization: Bearer <BLUE_DRAFT_SECRET>
Content-Type: application/json

{
  "id": "blue-feature-2026-11-13",
  "title": "A concise feature title",
  "thesis": "The grounded question this feature investigates, in at least thirty characters.",
  "evidence": "Specific attributed facts, relevant context, uncertainty and a grounded counterargument.",
  "sources": [
    {"title": "Primary public source", "url": "https://example.org/primary"},
    {"title": "Independent context", "url": "https://example.org/context"}
  ]
}
```

Replace example sources with real evidence. Requests are limited to 16KB; up to
four submissions per day are accepted. Use a stable draft ID: an identical retry
returns `already_received`, and changed content under that ID returns 409. Drafts
expire from consideration after 24 hours. The routine writer may skip a draft
that lacks evidence or repeats coverage. A 202 confirms receipt, not publication.
Verify one real Blue task delivery and subsequent consumption separately.

## Deployment and acceptance

Run `python scripts/verify_scope.py` before pushing/deploying. The existing Vercel
Git integration targets `main`; pushing may automatically deploy. Never create
another Vercel project or run an interactive command that could relink it.

The custom domain was added only to radio and Vercel reports it verified and
correctly configured. No DNS records were changed. Vercel's recommended CNAME,
if a future correction is needed, is `radio` →
`6c55931fe06d8ece.vercel-dns-017.com.`; recheck the exact value before changing DNS.

Required production acceptance still includes:

- Real text generation and two-speaker narration, listened to and checked against sources.
- Real Postgres/Blob atomic publication and retry tests.
- Mobile playback and two-browser shared-clock tests against production HTTPS.
- Duplicate development and genuine follow-up replay against real editorial models.
- Failed generation leaving the last complete production edition playable.
- Two distinct **scheduled cloud executions**, documented by schedule execution IDs
  and distinct publication IDs. Manual invocations and local background processes
  do not satisfy this check.
- Real Blue handoff, if connected; its absence must not stop routine editions.

Reference documentation checked during implementation:
[Schedules limits](https://vercel.com/docs/schedules/limits),
[Schedules configuration](https://vercel.com/docs/schedules/configuration),
[Hobby limits](https://vercel.com/docs/plans/hobby),
[Blob free limits](https://vercel.com/docs/vercel-blob/usage-and-pricing).
