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

Si tu veux que l'exemple signe et envoie les transactions, renseigne aussi `RPC_URL` et `PROVIDER_OWNER_PK` dans `example/.env`. La clé doit correspondre au `owner_wallet` de `example/config/provider.json`.

Tu peux ensuite appeler les exemples depuis la racine du repo :

```bash
npm run health --prefix example
npm run providers:list --prefix example
npm run register:provider --prefix example
npm run register:service --prefix example
```

## Configuration

Les scripts lisent seulement `API_URL`, `RPC_URL` et `PROVIDER_OWNER_PK` depuis l'environnement. Tu peux partir de `.env.example` :

```bash
cp example/.env.example example/.env
```

Les payloads d'enregistrement sont dans :

```text
example/config/provider.json
example/config/service.json
```

Les scripts exécutables sont dans :

```text
example/scripts/
```

Les scripts chargent automatiquement `example/.env` quand ils sont lancés via `npm --prefix example`.

Tu peux ensuite exécuter :

```bash
npm run register:provider --prefix example
npm run register:service --prefix example
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
  status,
});
```

L'API retourne une transaction préparée pour `AgentHubRegistry.registerProvider`. Si `PROVIDER_OWNER_PK` et `RPC_URL` sont présents, le script signe et broadcast la transaction avec ethers. Sinon, il affiche seulement la transaction préparée.

## Register un service

`scripts/register-service.ts` lit `example/config/service.json`, puis appelle :

```ts
client.services.create(service);
```

Le provider référencé par `provider_id` doit déjà exister côté API. L'API retourne une transaction préparée pour `AgentHubRegistry.registerService`. Si `PROVIDER_OWNER_PK` et `RPC_URL` sont présents, le script signe et broadcast la transaction avec ethers. Sinon, il affiche seulement la transaction préparée.
