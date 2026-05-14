# Skill Hub

Monorepo: **Fastify API** in `backend/`, **React (Vite)** UI in `frontend/`.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+

## Backend (`backend/`)

```bash
cd backend
cp .env.example .env   # set DATABASE_URL
npm install
npx prisma migrate deploy
npm run db:seed        # optional demo users
npm run dev            # http://localhost:3000
```

Health: `GET http://localhost:3000/health`  
Users API: `GET http://localhost:3000/api/users`

See previous API details in this file — same routes, paths unchanged. Env vars: `DATABASE_URL`, `PORT`, `HOST`, `PAYMENT_CONFIRMATION_TOKEN`.

## Frontend (`frontend/`)

```bash
cd frontend
cp .env.example .env   # VITE_API_BASE_URL=http://localhost:3000 (default)
npm install
npm run dev            # usually http://localhost:5173
```

The app loads **`GET {VITE_API_BASE_URL}/api/users`** and shows a table (with refresh). Start the **backend** first so the request succeeds.

## Repo layout

| Path | Purpose |
|------|---------|
| `backend/` | Prisma schema, migrations, seed, Fastify `src/` |
| `frontend/` | Vite + React + TypeScript |

## Next steps

Auth for `builderId` / `buyerId`, Arc payment indexer calling `confirm-payment`, execution proxy — same as before.
