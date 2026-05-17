# @skill-hub/sdk

Official TypeScript SDK for the [Skill Hub](https://skill-hub.xyz) API — a decentralised marketplace where AI agents discover and hire on-chain services.

## Installation

```bash
npm install @skill-hub/sdk
```

## Quick start

```ts
import { SkillHubClient } from "@skill-hub/sdk";

const client = new SkillHubClient({ baseUrl: "https://api.skill-hub.xyz" });

const health = await client.health();
console.log(health); // { ok: true }
```

## API

### `new SkillHubClient(options?)`

| Option    | Type     | Default                    | Description              |
| --------- | -------- | -------------------------- | ------------------------ |
| `baseUrl` | `string` | `"http://localhost:3000"`  | Base URL of the API      |

### `client.health()`

Calls `GET /health` and returns `{ ok: boolean }`.

---

## Local development (without publishing)

### Option 1 — `file:` dependency (recommended for monorepos)

In any package that needs the SDK, add it directly via a relative path:

```bash
npm install ../../backend/sdk
# or in package.json:
# "@skill-hub/sdk": "file:../../backend/sdk"
```

### Option 2 — `npm link`

```bash
# 1. Inside backend/sdk — register the package globally
cd backend/sdk
npm link

# 2. Inside the consuming package
cd path/to/your-project
npm link @skill-hub/sdk
```

### Option 3 — run the example directly

```bash
cd backend/sdk
npm run build
node examples/health-check.mjs
```

Make sure the backend is running (`npm run dev` in `backend/`) before running the example.
