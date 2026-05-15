# Skill Hub

Monorepo: **Fastify REST API** in `backend/`, **Next.js 15** UI in `frontend/`.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+

## Quick start

```bash
# 1 — backend (port 3000)
cd backend
cp .env.example .env   # set DATABASE_URL
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev

# 2 — frontend (port 3001), in a new terminal
cd frontend
npm install
npm run dev
```

| Service | URL |
|---|---|
| Backend API | http://localhost:3000 |
| Frontend | http://localhost:3001 |

---

## Backend (`backend/`)

Built with **Fastify**, **Prisma 6**, **PostgreSQL**, **Zod**, **TypeScript**.

### Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | API port (default `3000`) |
| `HOST` | Bind address (default `0.0.0.0`) |
| `PAYMENT_CONFIRMATION_TOKEN` | Optional shared secret for payment confirmation |

### Database models

| Model | Description |
|---|---|
| `Provider` | Service provider with wallet addresses and trust level |
| `Service` | AI/compute service offered by a provider |
| `Job` | A unit of work requested by a user wallet |
| `Escrow` | On-chain escrow record tied to a job |

#### Enums

- **ProviderStatus**: `REGISTERED` · `ACTIVE` · `SUSPENDED`
- **TrustLevel**: `UNVERIFIED` · `VERIFIED` · `CERTIFIED` · `HOSTED`
- **ServiceStatus**: `REGISTERED` · `ACTIVE` · `INACTIVE` · `SUSPENDED`
- **JobStatus**: `CREATED` · `FUNDED` · `RUNNING` · `SUBMITTED` · `ACCEPTED` · `SETTLED` · `FAILED` · `EXPIRED` · `REFUNDED` · `DISPUTED`
- **EscrowStatus**: `UNFUNDED` · `LOCKED` · `RELEASED` · `REFUNDED` · `DISPUTED`

### Useful scripts

```bash
npm run db:migrate   # create & apply a new migration
npm run db:seed      # seed demo provider + service
npm run db:studio    # open Prisma Studio
```

### REST API

#### Providers

| Method | Path | Description |
|---|---|---|
| `GET` | `/providers` | List all providers |
| `GET` | `/providers/:id` | Get provider + services |
| `POST` | `/providers` | Create provider |
| `PATCH` | `/providers/:id` | Update provider |
| `DELETE` | `/providers/:id` | Delete provider |

#### Services

| Method | Path | Description |
|---|---|---|
| `GET` | `/services?provider_id=&status=` | List services (filterable) |
| `GET` | `/services/:id` | Get service + provider |
| `POST` | `/services` | Create service |
| `PATCH` | `/services/:id` | Update service |
| `DELETE` | `/services/:id` | Delete service |

#### Jobs

| Method | Path | Description |
|---|---|---|
| `GET` | `/jobs?user_wallet=&service_id=&status=` | List jobs (filterable) |
| `GET` | `/jobs/:id` | Get job + escrow + service |
| `POST` | `/jobs` | Create job (`CREATED`) |
| `PATCH` | `/jobs/:id/status` | Transition job status |

Valid job status transitions:

```
CREATED → FUNDED | EXPIRED
FUNDED  → RUNNING | REFUNDED | EXPIRED
RUNNING → SUBMITTED | FAILED | EXPIRED
SUBMITTED → ACCEPTED | DISPUTED | EXPIRED
ACCEPTED → SETTLED | DISPUTED
FAILED / EXPIRED → REFUNDED
DISPUTED → SETTLED | REFUNDED
```

#### Escrows

| Method | Path | Description |
|---|---|---|
| `GET` | `/escrows/:id` | Get escrow by id |
| `GET` | `/jobs/:job_id/escrow` | Get escrow for a job |
| `POST` | `/escrows` | Create escrow (`UNFUNDED`) |
| `POST` | `/escrows/:id/fund` | `UNFUNDED → LOCKED` |
| `POST` | `/escrows/:id/release` | `LOCKED → RELEASED` |
| `POST` | `/escrows/:id/refund` | `LOCKED/DISPUTED → REFUNDED` |
| `POST` | `/escrows/:id/dispute` | `LOCKED → DISPUTED` |

Health check: `GET /health` → `{ ok: true }`

---

## Frontend (`frontend/`)

Built with **Next.js 15** (App Router), **Tailwind CSS v4**, **TypeScript**.

### Environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Backend URL (default `http://localhost:3000`) |

The homepage is a **server component** that fetches providers and services from the backend at render time and displays them as a card grid with trust badges and status indicators.

---

## Repo layout

| Path | Purpose |
|---|---|
| `backend/` | Fastify API, Prisma schema, migrations, seed |
| `backend/src/routes/` | `providers.ts` · `services.ts` · `jobs.ts` · `escrows.ts` |
| `backend/src/lib/` | Prisma client, HTTP error helpers, serializers |
| `backend/prisma/` | `schema.prisma`, migrations, seed |
| `frontend/` | Next.js 15 App Router |
| `frontend/app/` | `layout.tsx` · `page.tsx` · `globals.css` |
