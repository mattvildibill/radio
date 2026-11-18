# Ask the Hosts pilot — verification record

Date: November 18, 2026. Branch: `codex/ask-the-hosts-pilot`.

## Verified locally

- `pytest -q`: **18 passed**. Vercel protection admission and origin checks; Production start
  denial; missing configuration fails closed; signed research tickets cannot be
  forged or moved to a new browser session; research must finish with sources
  before tickets are issued; both hosts receive server-defined voices/context;
  close capabilities are scoped; quota errors make one request and do not expose
  provider diagnostics or keys; request size limits and security headers.
- `npm test`: **6 passed**. Media-silence handoffs; one silence-recovery cue then
  stop; monologue cap; inactive-host sound does not advance the active turn;
  deterministic nine-minute handoff simulation; safe source URLs and replay labels.
- `npm run check`: all three browser modules parse successfully.
- Chromium local browser: the actual IndexedDB library stored a **24,596-byte**
  mix of two explicitly labeled synthetic tones. The actual app replay UI showed
  “Recording,” original date and time, `America/Denver`, age, duration, and source
  link. After a full page reload it played to completion: media
  `currentTime = duration = 2.939763`, `ended = true`, `error = null`.
- Browser fixture injected a research quota failure. UI returned to idle, both
  hosts showed “Off air,” and the explicit no-retry error appeared. No session
  request or real provider request was made.
- Actual app layout rendered without horizontal overflow at 1165px. No app-origin
  browser error/warning appeared in the inspected logs; unrelated browser
  extension metadata errors were present.

The browser fixture is separate from the app and exists only on localhost. It
bypasses authentication for the fixture UI and supplies a deliberate quota
failure. It is never imported or mounted by the production/Preview entrypoint.
The saved test tones are **not AI speech** and are not evidence of host chemistry.

## Protected Preview deployment

The existing radio Git integration deployed application commit
`63827128c80ac3133df2799779f63b4ac19869d5` successfully. GitHub's Vercel status
reported “Deployment has completed”; the Vercel bot reported **Ready**, the same
radio project/team IDs, and this branch Preview:

https://radio-git-codex-ask-the-hosts-pilot-mattvildibills-projects.vercel.app

Deployment details:
https://vercel.com/mattvildibills-projects/radio/6pPBZmpLdcZcYNYL4JfUTgh42q2k

Draft PR: https://github.com/mattvildibill/radio/pull/1

An unauthenticated HTTPS request to the Preview returned **302 to Vercel SSO**,
confirming the deployment is protected. It did not reach the application. No
Production deployment was requested. Project identity here is evidenced by the
Git integration, not a successful direct Vercel project API inspection.

## External access blockers

- Vercel connector returns HTTP 404 for `radio` by name and by the project ID
  recorded in the repository, under the known team ID and the user-confirmed
  `mattvildibills-projects` slug. A name-scoped list returned no project.
- Only radio was targeted. No other repo/project was inspected or changed.
- With user-approved browser fallback, the exact radio dashboard redirected to
  Vercel sign-in. Two secure sign-in requests (the second explicitly requested by the user)
  returned `declined`. No credentials
  were retrieved, exposed, or entered by the agent.
- No usable Vercel CLI credential is available in this execution environment.
- Automatic approval review rejected the protected-fetch connector because it
  creates or reuses a temporary share link. No share link was created or reused
  by that attempt. Authentication/protection was not weakened.

## Not yet verified — required before acceptance

- The new Preview `OPENAI_API_KEY` through the app; no real OpenAI call has run.
- GPT-Live access, actual two-session startup, actual reciprocal input audio,
  audible contextual responses, or voice audition/level tuning. Gleam/Vesper and
  the initial gains are candidates pending a real audition.
- Whether the chosen producer model accepts this bounded web-search/structured
  output request with this project's API access.
- Typed follow-up changing a real spoken discussion.
- Real conversation recording and playback after reload on the private Preview.
- Both real sessions reporting final usage after stop, timeout, or disconnect.
- Full nine-minute real operation, physical mobile/Safari playback, interrupted
  WebRTC recovery, or browser-crash billing behavior.
- Application access and deployed environment configuration behind Preview
  protection. No production rollout is authorized.

**OpenAI usage incurred by this work so far: zero requests, $0.** Local tests use
fixtures, not the newly added key. The $15 project budget was not changed.

## Next executable acceptance sequence

1. Restore access to the existing radio Vercel project (connector or browser).
2. Confirm project identity, existing free plan, Git link, and Preview protection.
3. Use only the existing Preview `OPENAI_API_KEY`; leave all existing keys and
   integrations alone. No separate pilot passphrase is required.
4. Open the stable branch Preview in a Vercel-authenticated browser. The app
   verifies the outer protection gate before admitting a browser session.
5. Run a short sourced question (about 60–90 seconds), audition both voices and
   adjust levels/handoff timing based on actual audio. Inject a typed follow-up.
6. Explicitly record, stop, confirm both final session usage events, reload the
   same preview origin and play the saved conversation. Retain usage/notes and
   report only observed results. Stop on any spend/quota error; do not retry it.

## Access simplification after connection troubleshooting

Removed the extra app passphrase setup. The app now relies on the existing Vercel
Authentication gate, verifies that an unauthenticated probe to the exact fixed
radio branch hostname is redirected to Vercel SSO, and fails closed for public,
unknown, failed, non-Preview or different-host responses. A Secure/HttpOnly cookie
identifies the authenticated browser for signed brief capabilities. Six new
negative protection cases plus inert-probe and host-restriction checks pass.
The combined suite is now **18 Python + 6 JavaScript tests**.

The connector continues to return 404 after reinstall and explicit team consent.
A fresh tool-controlled Cloud Chrome tab still redirects to login; the user's
regular Codex Browser panel has a separate signed-in session. This is an agent
access limitation. No additional login or passphrase is needed for the user to
try the stable Preview from their existing signed-in browser. Real provider
acceptance is still pending; no API success is inferred from these local checks.
