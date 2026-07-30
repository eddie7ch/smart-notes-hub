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
| Vector database / embeddings | pgvector on Cloud SQL (Postgres) in production via [`server/src/db.ts`](server/src/db.ts), OpenAI embeddings via [`server/src/services/embeddings.ts`](server/src/services/embeddings.ts) |
| GCE (VMs) / VPC networking | [`infra/gce-watchdog-startup.sh`](infra/gce-watchdog-startup.sh) — custom VPC + GCE VM watchdog, see below |
| Per-user authentication | [`server/src/middleware/auth.ts`](server/src/middleware/auth.ts) — Firebase Authentication (email/password), Firebase ID tokens verified server-side |
| Managed relational database | Cloud SQL for PostgreSQL (`db-f1-micro`), via [`server/src/db.ts`](server/src/db.ts) — see below |
| Rate limiting | [`server/src/middleware/rateLimit.ts`](server/src/middleware/rateLimit.ts) |
| Structured logging | [`server/src/logger.ts`](server/src/logger.ts) — pino + pino-http, request IDs |
| Automated tests + CI gate | [`server/test/`](server/test) (vitest + supertest), enforced in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| Secrets management | Google Secret Manager (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DB_PASSWORD`), IAM-bound to the Cloud Run service account |
| Uptime monitoring & alerting | Cloud Monitoring uptime check + email alert policy on `/health` (see below) |

## Architecture

```mermaid
flowchart LR
    UI[React client] -->|Firebase ID token| API[Express API]
    UI -->|email/password| FirebaseAuth[Firebase Authentication]
    API -->|verifyIdToken| FirebaseAuth
    API --> Items[items routes\nCRUD, per-user]
    API --> Search[search route\nnearest-neighbor, per-user]
    API --> Chat[chat route\nRAG]
    Items --> DB[(Cloud SQL/pgvector\nPostgres, prod) / (SQLite, local dev)]
    Search --> DB
    Chat --> Search
    Chat --> Provider[AI provider\nOpenAI / Anthropic]
    Items -.embed on write.-> OpenAIEmbed[OpenAI embeddings]
```

- Every note/task is embedded (OpenAI `text-embedding-3-small`) on write and
  the vector is stored alongside the row, scoped to the owning user.
- `/api/search` embeds the query and ranks the calling user's own stored
  items by nearest-neighbor search. In production this runs as a real
  vector-database query — Postgres's `pgvector` extension on Cloud SQL,
  using the `<=>` cosine-distance operator so ranking happens in the
  database, not in a Node.js loop. Locally (SQLite, no pgvector available)
  it falls back to computing cosine similarity in JS — see
  `ItemRepository.semanticSearch` in [`server/src/db.ts`](server/src/db.ts).
- `/api/chat` runs the same retrieval step, stuffs the top matches into the
  system prompt, and asks the configured LLM provider to answer with
  citations — a small, from-scratch RAG pipeline.
- Users sign in with email/password via Firebase Authentication; the client
  attaches the resulting Firebase ID token as a `Bearer` token on every API
  call, and the server verifies it (`firebase-admin`) to identify the user
  and scope all data access — real per-user isolation, not a shared secret.

### Database: SQLite locally, Cloud SQL in production

[`server/src/db.ts`](server/src/db.ts) implements a repository interface
with two backends, selected automatically at startup:

- **`node:sqlite` (default)** — zero setup, used for local dev and when no
  Postgres env vars are set.
- **Cloud SQL for PostgreSQL (`db-f1-micro`, the cheapest tier)** — used in
  production when `INSTANCE_UNIX_SOCKET` (or `DATABASE_URL`) is set. Cloud
  Run connects to it over Cloud SQL's built-in Unix-domain-socket
  integration (`--add-cloudsql-instances`), which needs no Serverless VPC
  Access connector — saving the connector's ~$8-13/month recurring cost
  while still avoiding any public-internet hop between the two services.
  The instance is stopped (`--activation-policy=NEVER`) whenever it's not
  actively being demoed, to minimize cost (~$1-2/month idle vs ~$10-12/month
  running).
- **`pgvector` extension, enabled on the same Cloud SQL instance** — the
  `embedding` column is a native `vector(1536)` type (not JSON-in-a-TEXT-
  column), and `/api/search` ranks rows with pgvector's `<=>` cosine-distance
  operator directly in SQL. No extra service to run or pay for; it reuses
  the Postgres instance already provisioned above.

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

- **`node:sqlite` for local dev, Cloud SQL (Postgres) in production** — the
  dual-backend repository pattern in `db.ts` gives zero-setup local dev
  while still running a real managed database in production.
- **Cloud Run's native Cloud SQL socket integration over a paid VPC
  connector** — `--add-cloudsql-instances` gets private-ish, non-public
  connectivity to Cloud SQL without the recurring cost of a Serverless VPC
  Access connector.
- **Firebase Authentication (email/password) over a shared API key** — real
  per-user identity and data isolation, at no cost, without needing to
  stand up a custom auth server. Google Sign-In was considered but requires
  an OAuth client that Firebase Console normally provisions silently in the
  UI; there's no clean way to script that for a personal (non-Workspace)
  Google account, so email/password was used instead.
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

All routes below `/api` require a Firebase ID token as `Authorization: Bearer
<token>` (except where noted) and are scoped to the authenticated user. All
routes are also rate-limited (120 req/min general, 20 req/min on the AI
endpoints).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | none | Health check (used by Cloud Run, GCE watchdog, and Cloud Monitoring) |
| GET | `/api/items` | Bearer token | List the signed-in user's notes/tasks |
| POST | `/api/items` | Bearer token | Create a note/task `{ type, title, content, status? }` |
| PUT | `/api/items/:id` | Bearer token | Update a note/task (must be owned by the caller) |
| DELETE | `/api/items/:id` | Bearer token | Delete a note/task (must be owned by the caller) |
| POST | `/api/search` | Bearer token | Semantic search over the caller's own items `{ query, k? }` |
| POST | `/api/chat` | Bearer token | RAG chat over the caller's own items `{ message }` → `{ answer, sources }` |

Real secrets (OpenAI/Anthropic API keys, the Cloud SQL app password) never
reach the client — they're injected server-side only, via Secret Manager.
The Firebase web config values in `client/.env.production` (API key,
authDomain, projectId) are meant to be public per Firebase's own docs — they
identify the Firebase project, they don't grant access on their own.

## Local development

```bash
npm install
cp server/.env.example server/.env   # add OPENAI_API_KEY (and ANTHROPIC_API_KEY if used)
gcloud auth application-default login  # lets firebase-admin verify ID tokens locally
npm run dev:server                   # http://localhost:8080
npm run dev:client                   # http://localhost:5173 (proxies /api to :8080)
npm run test --workspace server      # vitest unit + integration tests
```

Locally, `db.ts` falls back to `node:sqlite` (no Postgres env vars needed).
`server/.env` also supports `LOG_LEVEL` (pino level, default `info`), and
`DATABASE_URL` if you want to point local dev at a real Postgres instance
instead of sqlite.

## Deployment

Deployed to Google Cloud Run as a single container:

```bash
gcloud run deploy smart-notes-hub \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances=gcp-cloudrun-demo-1831:us-central1:smart-notes-hub-db \
  --set-env-vars AI_CHAT_PROVIDER=openai,NODE_ENV=production,INSTANCE_UNIX_SOCKET=/cloudsql/gcp-cloudrun-demo-1831:us-central1:smart-notes-hub-db,DB_USER=app_user,DB_NAME=smart_notes_hub \
  --set-secrets OPENAI_API_KEY=OPENAI_API_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,DB_PASSWORD=DB_PASSWORD:latest
```

Real LLM credentials and the Cloud SQL app password are stored in Secret
Manager and mounted as env vars at deploy time — never committed to the repo
or baked into the client bundle. The client's Firebase web config lives in
[`client/.env.production`](client/.env.production), which Vite bakes into
the production bundle at build time (safe to be public, see [API](#api)).

Cloud SQL setup (one-time):

```bash
gcloud sql instances create smart-notes-hub-db \
  --database-version=POSTGRES_15 --tier=db-f1-micro \
  --region=us-central1 --no-backup --storage-type=HDD --storage-size=10GB
gcloud sql databases create smart_notes_hub --instance=smart-notes-hub-db
gcloud sql users create app_user --instance=smart-notes-hub-db --password=<generated>
gcloud projects add-iam-policy-binding gcp-cloudrun-demo-1831 \
  --member="serviceAccount:651554012781-compute@developer.gserviceaccount.com" \
  --role=roles/cloudsql.client
```

To minimize cost, the instance is stopped when not actively being demoed:

```bash
gcloud sql instances patch smart-notes-hub-db --activation-policy=NEVER   # stop (~$1-2/mo)
gcloud sql instances patch smart-notes-hub-db --activation-policy=ALWAYS # start before a demo (~$10-12/mo running)
```

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

Being honest about the remaining gap:

- **Single region** — no multi-region failover or load balancing.

Managed database (Cloud SQL), private-ish connectivity (Cloud Run's native
Cloud SQL socket integration, no public IP exposure needed), and true
per-user authentication (Firebase Authentication + per-user data isolation)
are all implemented and live — see [Architecture decisions](#architecture-decisions)
above. Everything else (rate limiting, structured logging, automated tests
in CI, Secret Manager, uptime monitoring + alerting, custom VPC + IAP-only
VM access) is implemented and live too.

## Tech stack

`React` · `TypeScript` · `Vite` · `Node.js` · `Express` · `node:sqlite` ·
`Cloud SQL` (PostgreSQL) · `Firebase Authentication` ·
`OpenAI API` · `Anthropic API` · `Docker` · `Google Cloud Run` · `Compute Engine` ·
`VPC` · `IAP` · `GitHub Actions` · `pino` (structured logging) ·
`express-rate-limit` · `vitest` + `supertest` (CI-gated tests) ·
`Secret Manager` · `Cloud Monitoring` (uptime checks + alerting)
