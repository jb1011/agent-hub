import type { JobStatus, ListJobsQuery } from "../../backend/sdk/dist/index.js";
import { API_URL, userClient } from "../lib/sdk-client.ts";

const JOB_STATUSES = new Set<JobStatus>([
  "CREATED",
  "FUNDED",
  "RUNNING",
  "SUBMITTED",
  "ACCEPTED",
  "SETTLED",
  "FAILED",
  "EXPIRED",
  "REFUNDED",
  "DISPUTED",
]);

const [, , ...args] = process.argv;

function usage(exitCode = 0): never {
  console.log(`
Usage: npm run jobs:list --prefix example -- [filters]

Filters:
  --status <status>                       CREATED | FUNDED | RUNNING | SUBMITTED | ACCEPTED | SETTLED | FAILED | EXPIRED | REFUNDED | DISPUTED
  --request-id <request_id>               Filter by API job request_id
  --job-id <job_id>                       Filter by on-chain job_id
  --user-wallet <address>                 Filter by user wallet
  --provider-request-id <request_id>      Filter by provider API request_id

Short form:
  npm run jobs:list --prefix example -- FUNDED
`);
  process.exit(exitCode);
}

function readOption(name: string): string | undefined {
  const exact = args.indexOf(name);
  if (exact >= 0) return args[exact + 1];

  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function readQuery(): ListJobsQuery | undefined {
  if (args.includes("--help") || args.includes("-h")) usage();

  const status = readOption("--status") ?? (args[0]?.startsWith("--") ? undefined : args[0]);
  const query: ListJobsQuery = {
    request_id: readOption("--request-id"),
    job_id: readOption("--job-id"),
    user_wallet: readOption("--user-wallet"),
    provider_request_id: readOption("--provider-request-id"),
  };

  if (status) {
    if (!JOB_STATUSES.has(status as JobStatus)) {
      throw new Error(`Unknown job status "${status}". Run with --help to see valid statuses.`);
    }
    query.status = status as JobStatus;
  }

  const compactQuery = Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined)
  ) as ListJobsQuery;

  return Object.keys(compactQuery).length > 0 ? compactQuery : undefined;
}

const query = readQuery();
const signedUserClient = await userClient();
const jobs = await signedUserClient.jobs.list(query);

console.log(`Skill Hub API: ${API_URL}`);
console.log(`Found ${jobs.length} job(s)`);
console.log(JSON.stringify(jobs, null, 2));
