# Skill Hub SDK examples

Ce dossier montre comment consommer le SDK local depuis `backend/sdk`.

Les scripts importent directement `../backend/sdk/dist/index.js`, donc il faut compiler le SDK avant de les lancer :

```bash
npm run build --prefix backend/sdk
```

Installe aussi les dépendances du dossier d'exemple :

```bash
npm install --prefix example
```

Dans un autre terminal, lance le backend :

```bash
npm run dev --prefix backend
```

Pour `register:provider`, le backend doit aussi connaître le registry contract via `AGENT_HUB_REGISTRY_ADDRESS`, ou via `AGENT_HUB_CHAIN_ID` / `ESCROW_CHAIN_ID` avec un fichier de déploiement disponible.

Si tu veux que l'exemple signe et envoie les transactions, renseigne aussi `RPC_URL` et `SIGNER_WALLET_PK` dans `example/.env`. La clé doit correspondre au signer attendu par la transaction : `owner_wallet` pour register provider, `user_wallet` pour create job.

Tu peux ensuite appeler les exemples depuis la racine du repo :

```bash
npm run health --prefix example
npm run providers:list --prefix example
npm run register:provider --prefix example
npm run create:job --prefix example
npm run start:job --prefix example
npm run accept:job --prefix example
npm run refund:queue --prefix example -- <jobId>
npm run refund:final --prefix example -- <jobId>
```

## Configuration

Les scripts lisent seulement `API_URL`, `RPC_URL` et `SIGNER_WALLET_PK` depuis l'environnement. Tu peux partir de `.env.example` :

```bash
cp example/.env.example example/.env
```

Les payloads d'enregistrement sont dans :

```text
example/config/provider.json
example/config/job.json
example/config/start-job.json
example/config/acceptance.json
```

Les scripts exécutables sont dans :

```text
example/scripts/
```

Les scripts chargent automatiquement `example/.env` quand ils sont lancés via `npm --prefix example`.

Tu peux ensuite exécuter :

```bash
npm run register:provider --prefix example
npm run create:job --prefix example
npm run start:job --prefix example
npm run accept:job --prefix example
npm run refund:queue --prefix example -- <jobId>
npm run refund:final --prefix example -- <jobId>
```

## Register un provider

`scripts/register-provider.ts` appelle :

```ts
client.providers.create({
  provider_id,
  name,
  description,
  owner_wallet,
  payout_wallet,
  api_base_url,
  trust_level,
  service_type,
  input_schema,
  output_schema,
  price_usdc,
  max_concurrent_jobs,
  timeout_seconds,
  status,
});
```

L'API retourne une transaction préparée pour `AgentHubRegistry.registerProvider`. Si `SIGNER_WALLET_PK` et `RPC_URL` sont présents, le script signe et broadcast la transaction avec ethers. Sinon, il affiche seulement la transaction préparée.

## Create un job

`scripts/create-job.ts` lit `example/config/job.json`, puis appelle :

```ts
client.jobs.create(job);
```

Le provider référencé par `provider_id` doit déjà exister côté API. L'API retourne une transaction préparée pour `AgentHubEscrow.createJob`.

Si `SIGNER_WALLET_PK` et `RPC_URL` sont présents, le script :

1. récupère le prix du provider avec `client.providers.get(provider_id)`,
2. lit `paymentToken()` sur le contrat escrow,
3. vérifie `allowance(user_wallet, escrow)`,
4. envoie `approve(escrow, price_usdc)` si l'allowance est insuffisante,
5. signe et broadcast `createJob`.

Sinon, il affiche seulement la transaction préparée.

## Start un job

`scripts/start-job.ts` lit `example/config/start-job.json`, puis appelle :

```ts
const authorization = await client.jobs.requestStartAuthorization(job_id, {
  expires_in_seconds,
});

const provider_signature = await signer.signTypedData(
  authorization.typed_data.domain,
  authorization.typed_data.types,
  authorization.typed_data.value
);

const started = await client.jobs.startJob(job_id, {
  provider_signature,
  expires_in_seconds,
});

const output = { text: `1 + 1 = ${1 + 1}` };

const finished = await client.jobs.finishJob(job_id, {
  output,
});
```

L'appel `startJob` retourne `input` avec les métadonnées de la transaction relayée (`transaction_hash`, `relayer_address`, `block_number`, `gas_used`). Ensuite le script fait un compute trivial (`1 + 1`) et appelle `job-finish` avec `output`. `SIGNER_WALLET_PK` doit correspondre au provider signer attendu par le contrat.

## Accept un job

`scripts/accept-job.ts` lit `example/config/acceptance.json`, puis appelle :

```ts
const acceptanceRequest = await client.jobs.requestAcceptance(job_id, {
  output,
  expires_in_seconds,
});

const user_signature = await signer.signTypedData(
  acceptanceRequest.typed_data.domain,
  acceptanceRequest.typed_data.types,
  acceptanceRequest.typed_data.value
);

const accepted = await client.jobs.acceptance(job_id, {
  output,
  output_commitment: acceptanceRequest.settle_with_user_signature_args.output_commitment,
  expires_at: acceptanceRequest.settle_with_user_signature_args.expires_at,
  user_signature,
});
```

Cela correspond au flow REST :

```text
POST {{baseUrl}}/jobs/{{jobId}}/acceptance-request
sign EIP-712 JobAcceptance
POST {{baseUrl}}/jobs/{{jobId}}/acceptance
```

`SIGNER_WALLET_PK` doit correspondre au `user_wallet` du job.

## Refund apres timeout

Les deux endpoints ne prennent pas de body. Ils retournent une transaction preparee a signer et envoyer cote wallet.

Appel HTTP direct :

```bash
curl -X POST "$API_URL/jobs/$JOB_ID/refund-after-queue-timeout"
curl -X POST "$API_URL/jobs/$JOB_ID/refund-after-final-timeout"
```

Avec le SDK :

```ts
const queueRefundTx = await client.jobs.refundAfterQueueTimeout(jobId);
const finalRefundTx = await client.jobs.refundAfterFinalTimeout(jobId);
```

Avec les scripts d'exemple :

```bash
npm run refund:queue --prefix example -- <jobId>
npm run refund:final --prefix example -- <jobId>
```

Tu peux aussi mettre `JOB_ID` dans l'environnement et lancer les commandes sans argument. Si `SIGNER_WALLET_PK` et `RPC_URL` sont presents, les scripts broadcastent la transaction; sinon ils affichent seulement la transaction preparee.
