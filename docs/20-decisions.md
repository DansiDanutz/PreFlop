# 20 · Decision hints (TypeSafe AI Jev)

**Status:** built; off until `JEV_API_KEY` is set. Advice only, in every surface.

## What it is

PreFlop asks TypeSafe AI's **Jev** decision model (the System One API) small, typed questions and shows the answers beside the operator's own controls. Jev is not a chat model: it takes a *state* (JSON) and *questions* of three kinds and returns, for each question, a decision with calibrated probabilities and a confidence.

| Question type | Answer |
|---|---|
| `noul` | the probability that the answer is yes, `noul: 0..1` (at least 0.5 reads as yes; near 0.5 means unsure) |
| `choice` | one of the given `criteria` keys, with a probability per key |
| `score` | a number on a legend |

The request is one `POST` to `JEV_API_URL` (`https://api.typesafe.ai/v1/systemone` by default) with `Authorization: Bearer <JEV_API_KEY>` and `{ model, state, questions }`. Text and JSON only: no images are sent, and nothing a player typed is sent either. Each call is a few hundred input tokens.

## Where it is used

Every use is a **hint**. No round is settled or voided, no table paused, no alert resolved and no balance changed because of an answer. The person decides; the hint says what the model would do and how sure it is.

| Surface | Question | Where the answer shows |
|---|---|---|
| **Alert triage** | For each open alert: `triage` ∈ dismiss · watch · pause table · escalate, and `money_at_risk` (yes/no) | Console → Integrity → **Alerts**, column *Suggested* |
| **Round review** | For each round in `REVIEW` or `EVIDENCE_REJECTED`: `outcome` ∈ settle · void · escalate, from the dealer/floor entries and the capture record | Console → Integrity → **Review queue**, column *Suggested* |
| **Organization applications** | For each application still `new`: `decision` ∈ approve · ask more · reject, and `complete` (enough detail to set the org up?), from the kind, the details with names and contact fields withheld at every depth (their paths listed, never their values) and free text replaced by its length, and duplicate signals (the same contact already owns an organization, had an application approved, holds an owner claim link, or has another open application) | Console → People & orgs → **Organizations → Applications**, column *Suggested* |
| **Promotion review** | For each promotion `pending_review`: `decision` ∈ approve · edit wording · reject, and `misleading`, from the title, body, link, kind, value, budget and period | Console → Growth → **Promotions → Review queue**, *Suggested:* under each item |
| **Agent applications** | For each agent `applied`: `decision` ∈ approve · hold · reject, from the note, the account's age, the proposed recruiter, whether the account was an agent before and how many players carry its code | Console → Growth → **Agents → Applications**, *Suggested:* under each applicant |
| **Card reading** (docs/19) | For each card the browser read: `accept`, from the match confidence and the margin to the runner-up glyph | Manual table webcam panel and the Card reader test page: *Adviser:* badges per card, and which cards to check by eye |

All but the reading check run in the **worker** (`decisionsOnce`, on its own loop): open alerts, rounds in review, new applications, promotions in review and agent applications without a hint are asked about, a few per pass, and the answers stored in `decision_hints (kind, ref, model, answers, error, created_at)`. The console reads them with the alert or the round. Nothing is asked twice while it has an answer. A question the service refused (HTTP 422, a bad key, or an answer that left a question out) is stored as an error and asked again at most four more times, ten minutes apart, in case the key or the service was fixed; a rate limit or outage (429/529, or unreachable) ends the pass after one retry and the rest waits for the next pass. The hint pass runs on its own loop in the worker, beside the game tick and the mail loop, so a slow adviser never delays a settlement, a refund or the heartbeat.

The reading check runs on request: `POST /v1/admin/manual/reading-check` (admin or ops) with the cards and scores, one question per card. Without a key it answers `{ enabled: false }` and the console shows nothing; the reading stands on its own.

**Free text is a known blind spot.** An applicant's message reaches the adviser only as its length, so the `complete` answer is about the structured fields; the questions say so and tell the adviser to answer near even when a long message is present, and to keep suggesting *ask more* for thin structured facts, with lower confidence rather than a different choice. The reviewer, who reads the message, decides.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `JEV_API_KEY` | unset = off | The TypeSafe AI key. A secret, never in the repository or a chat. Staging: add it as a GitHub repository secret named `JEV_API_KEY` (Settings → Secrets and variables → Actions), then run the `Fly secrets` workflow with name `JEV_API_KEY`, the value left empty and apps `both`; the run copies the encrypted secret to Fly. At least 16 characters; production refuses demo values. |
| `JEV_API_URL` | `https://api.typesafe.ai/v1/systemone` | Must be https in production. |
| `JEV_MODEL` | `jev-latest` | The model name sent with every request. |

Both the API (when `RUN_WORKER=true`) and the standalone worker read the key; the API also needs it for the reading check. `GET /v1/admin/metrics` → `instance.decisions` reports whether it is on, the model, and this process's calls, failures and tokens. Start-up logs one line: `decision hints: jev-latest (docs/20)` or `decision hints: off`.

## Boundaries

- **Advice only.** The code paths that move money (`rounds/service.ts`, `bets/`, `payments/`) never read a hint, and no hint is a precondition of anything.
- **No player data.** The state holds alert kinds and details, round states, card codes and recognition scores, an application's kind and typed details with every name and contact key withheld at every depth (the adviser sees which fields were provided, not their values), free text replaced by its length (a name inside prose cannot be told from any other word, so prose never travels) and email- or phone-shaped text redacted from the short values that do, a promotion's public text and numbers and an agent applicant's own note, both with email- and phone-shaped text redacted. No names, emails, balances or bets.
- **Degrades to nothing.** Without a key, or when the service is down, every surface is exactly what it was before this document.
- **Not a chat or vision model.** Jev reads JSON; it does not look at the camera frame. Card recognition stays in the browser (docs/19).

## Code

`apps/api/src/lib/decisions.ts` (the client, the questions, hint storage), `apps/api/src/worker.ts` (`decisionsOnce`), `apps/api/src/routes/admin.ts` (`/v1/admin/alerts`, `/v1/admin/review-queue`, `/v1/admin/applications`, `/v1/admin/manual/reading-check`), `routes/growth.ts` (`/v1/admin/promotions`), `routes/agents.ts` (`/v1/admin/agents`), `packages/db/migrations/022_decision_hints.sql`, `apps/console/src/components/decisions.tsx`. Tests: `apps/api/test/decisions.test.ts` (request shape, parsing, retries, worker pass, routes, config).
