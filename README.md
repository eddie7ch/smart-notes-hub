# Smart Notes Hub

A full-stack notes & task manager with retrieval-augmented (RAG) semantic
search and an AI chat assistant that can answer questions using your own
notes as context. Built end-to-end (architecture, implementation, deployment,
docs) as a single solo project.

**Live demo:** [smart-notes-hub-651554012781.us-central1.run.app](https://smart-notes-hub-651554012781.us-central1.run.app) — deployed on Google Cloud Run

## Why this project

Built as a single, cohesive demonstration of full-stack + cloud + AI skills:

| Requirement | Where it lives |
|---|---|
| React + TypeScript frontend | [`client/`](client) — Vite + React 18 + TS |
| Backend API (Node.js) | [`server/`](server) — Express + TypeScript |
| GCP deployment | [`Dockerfile`](Dockerfile) — single-container deploy to Cloud Run |
| System design / architecture | Layered routes → services → data (see below) |
| Git & documentation culture | This README, [ADRs](#architecture-decisions), [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| LLM APIs (OpenAI & Anthropic) | [`server/src/services/aiProvider.ts`](server/src/services/aiProvider.ts) — swappable provider |
| Vector database / embeddings | [`server/src/services/embeddings.ts`](server/src/services/embeddings.ts) + [`server/src/routes/search.ts`](server/src/routes/search.ts) |
| GCE (VMs) / VPC networking | [`infra/gce-watchdog-startup.sh`](infra/gce-watchdog-startup.sh) — custom VPC + GCE VM watchdog, see below |
| API auth & rate limiting | [`server/src/middleware/auth.ts`](server/src/middleware/auth.ts), [`server/src/middleware/rateLimit.ts`](server/src/middleware/rateLimit.ts) |
| Structured logging | [`server/src/logger.ts`](server/src/logger.ts) — pino + pino-http, request IDs |
| Automated tests + CI gate | [`server/test/`](server/test) (vitest + supertest), enforced in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| Secrets management | Google Secret Manager (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`), IAM-bound to the Cloud Run service account |
| Uptime monitoring & alerting | Cloud Monitoring uptime check + email alert policy on `/health` (see below) |

## Architecture

```mermaid
flowchart LR
    UI[React client] -->|REST| API[Express API]
    API --> Items[items routes\nCRUD]
    API --> Search[search route\ncosine similarity]
    API --> Chat[chat route\nRAG]
    Items --> DB[(SQLite\nnode:sqlite)]
    Search --> DB
    Chat --> Search
    Chat --> Provider[AI provider\nOpenAI / Anthropic]
    Items -.embed on write.-> OpenAIEmbed[OpenAI embeddings]
```

- Every note/task is embedded (OpenAI `text-embedding-3-small`) on write and
  the vector is stored alongside the row in SQLite.
- `/api/search` embeds the query and ranks stored items by cosine similarity
  — a minimal, dependency-free vector search suitable for a single-user app.
- `/api/chat` runs the same retrieval step, stuffs the top matches into the
  system prompt, and asks the configured LLM provider to answer with
  citations — a small, from-scratch RAG pipeline.

### GCE + VPC watchdog

A small `e2-micro` GCE VM (`smart-notes-hub-watchdog`) runs in its own custom
VPC (`smart-notes-hub-vpc` / `smart-notes-hub-subnet`, `10.10.0.0/24`) and
polls the Cloud Run app's `/health` endpoint every 15 minutes via a systemd
timer, logging uptime results locally on the VM. Provisioned with:

- Custom-mode VPC + dedicated subnet (not the default network)
- Firewall rule restricting SSH to Google's IAP range (`35.235.240.0/20`)
  only — no SSH port exposed to the public internet
- VM created with `--no-service-account --no-scopes` (least privilege —
  the watchdog only needs outbound HTTPS, not GCP API access)
- Access via `gcloud compute ssh --tunnel-through-iap` (IAP TCP forwarding,
  no static SSH keys/bastion host)

See [`infra/gce-watchdog-startup.sh`](infra/gce-watchdog-startup.sh) for the
full startup script and provisioning commands below.

## Architecture decisions

- **`node:sqlite` over a hosted DB** — zero extra infrastructure/cost for a
  single-user demo, same pattern proven in the `gcp-cloudrun-demo` project.
- **In-app cosine similarity over a hosted vector DB (Chroma/Pinecone)** —
  at demo scale (dozens–hundreds of items) a full vector database is
  unnecessary; the interface is isolated in `search.ts` so swapping in a
  real vector store later is a contained change.
- **Provider abstraction for chat (`aiProvider.ts`)** — lets the LLM backend
  switch between OpenAI and Anthropic via one env var, without touching the
  RAG pipeline. Embeddings always use OpenAI since Anthropic has no
  embeddings endpoint.
- **Single Cloud Run service** — the server serves the built client's static
  files directly, so one container/one deploy covers the whole app.
- **`/health` instead of `/healthz`** — Cloud Run's edge intercepts
  `/healthz` and returns Google's own 404 before it reaches the container.
- **Custom VPC + IAP-only SSH for the watchdog VM** — avoids exposing port
  22 to `0.0.0.0/0`; IAP tunneling authenticates via IAM instead of a
  standing bastion host or public SSH keys.

## API

All routes below `/api` require an `x-api-key` header (except where noted).
All routes are also rate-limited (120 req/min general, 20 req/min on the AI
endpoints).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | none | Health check (used by Cloud Run, GCE watchdog, and Cloud Monitoring) |
| GET | `/api/items` | `x-api-key` | List all notes/tasks |
| POST | `/api/items` | `x-api-key` | Create a note/task `{ type, title, content, status? }` |
| PUT | `/api/items/:id` | `x-api-key` | Update a note/task |
| DELETE | `/api/items/:id` | `x-api-key` | Delete a note/task |
| POST | `/api/search` | `x-api-key` | Semantic search `{ query, k? }` |
| POST | `/api/chat` | `x-api-key` | RAG chat `{ message }` → `{ answer, sources }` |

**Honest caveat:** `API_KEY`/`VITE_API_KEY` is a single shared token baked
into the public client bundle at build time. It cannot provide real
confidentiality — anyone inspecting the deployed JS can read it. Its actual
purpose is bot/scraper deterrence and to give the rate limiter a stable key
to key off, **not** per-user authentication. Real secrets (the OpenAI/
Anthropic API keys) never reach the client — they're injected server-side
only, via Secret Manager.

## Local development

```bash
npm install
cp server/.env.example server/.env   # add OPENAI_API_KEY (and ANTHROPIC_API_KEY if used)
npm run dev:server                   # http://localhost:8080
npm run dev:client                   # http://localhost:5173 (proxies /api to :8080)
npm run test --workspace server      # vitest unit + integration tests
```

`server/.env` also supports `API_KEY` (protects `/api/*`; if unset outside
`NODE_ENV=production` the middleware fails open for easier local dev) and
`LOG_LEVEL` (pino level, default `info`).

## Deployment

Deployed to Google Cloud Run as a single container:

```bash
gcloud run deploy smart-notes-hub \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars AI_CHAT_PROVIDER=openai,NODE_ENV=production,API_KEY=<token> \
  --set-secrets OPENAI_API_KEY=OPENAI_API_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest
```

Real LLM credentials are stored in Secret Manager and mounted as env vars at
deploy time — they're never committed to the repo or baked into the client
bundle. `API_KEY` is the app's own non-secret bot-deterrence token (see
[API](#api) above); its client-side counterpart lives in
[`client/.env.production`](client/.env.production), which Vite bakes into
the production bundle at build time.

Note: `data.db` lives at `/tmp` inside the container, so data resets on
cold start/instance recycling — acceptable for a demo, not for production
(would move to Cloud SQL or a persisted volume for that).

### Monitoring & alerting

A Cloud Monitoring uptime check polls `/health` over HTTPS every 5 minutes;
an alert policy fires an email notification if the check fails:

```bash
gcloud monitoring uptime create smart-notes-hub-health \
  --resource-type=uptime-url \
  --resource-labels=host=smart-notes-hub-651554012781.us-central1.run.app,project_id=gcp-cloudrun-demo-1831 \
  --path=/health --protocol=https --port=443 --period=5
```

The email notification channel and alert policy (triggering when the mean
fraction of passing checks drops below 1 over a 20-minute window) were
created via the Monitoring REST API — both stay within Cloud Monitoring's
free tier at this check frequency.

### GCE + VPC watchdog setup

```bash
gcloud compute networks create smart-notes-hub-vpc --subnet-mode=custom
gcloud compute networks subnets create smart-notes-hub-subnet \
  --network=smart-notes-hub-vpc --region=us-central1 --range=10.10.0.0/24
gcloud compute firewall-rules create allow-iap-ssh \
  --network=smart-notes-hub-vpc --direction=INGRESS --action=ALLOW \
  --rules=tcp:22 --source-ranges=35.235.240.0/20
gcloud compute instances create smart-notes-hub-watchdog \
  --zone=us-central1-a --machine-type=e2-micro \
  --network=smart-notes-hub-vpc --subnet=smart-notes-hub-subnet \
  --image-family=debian-12 --image-project=debian-cloud \
  --no-service-account --no-scopes \
  --metadata-from-file=startup-script=infra/gce-watchdog-startup.sh
```

## What's still not "true" enterprise-scale

Being honest about the remaining gaps, in order of what would matter most
in a real production system:

- **No managed relational database** — SQLite on ephemeral container disk;
  a real deployment would use Cloud SQL (Postgres), which has no free tier
  (~$20+/month minimum) — deliberately deferred pending explicit budget
  approval.
- **No private networking between Cloud Run and other services** — a
  Serverless VPC Access connector (~$8-13/month minimum) would be needed to
  put a database or internal APIs behind the custom VPC; also deferred for
  the same cost reason. The GCE watchdog VM already lives in that VPC today.
- **No true per-user auth** — the API key is a single shared,
  publicly-visible token (see the [API](#api) caveat above), not
  session-based/OAuth per-user identity.
- **Single region** — no multi-region failover or load balancing.

Everything else (auth middleware, rate limiting, structured logging,
automated tests in CI, Secret Manager, uptime monitoring + alerting, custom
VPC + IAP-only VM access) is implemented and live.

## Tech stack

`React` · `TypeScript` · `Vite` · `Node.js` · `Express` · `node:sqlite` ·
`OpenAI API` · `Anthropic API` · `Docker` · `Google Cloud Run` · `Compute Engine` ·
`VPC` · `IAP` · `GitHub Actions` · `pino` (structured logging) ·
`express-rate-limit` · `vitest` + `supertest` (CI-gated tests) ·
`Secret Manager` · `Cloud Monitoring` (uptime checks + alerting)
