## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script <script> --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Deploy With TypeScript

Install the TypeScript deployment dependencies:

```shell
$ npm install
```

Copy `.env.example` to `.env`, then fill in `RPC_URL`, `PRIVATE_KEY`, `PAYMENT_TOKEN_ADDRESS`, and `TREASURY_ADDRESS`.
`OWNER_ADDRESS` and `DELIVERY_ATTESTER_ADDRESS` default to the deployer address when omitted.

Run:

```shell
$ npm run deploy
```

The script deploys `AgentHubConfig`, `AgentHubRegistry`, and `AgentHubEscrow` in order, then writes the deployed addresses to `deployments/<chainId>.json`.

### Create Job

Set `RPC_URL` and `WALLET_USER_PRIVATE_KEY` in `.env`. `AGENT_HUB_ESCROW_ADDRESS` is optional when `deployments/<chainId>.json` exists.

Then pass either the full API response object or the nested `create_job_args` object:

```shell
$ npm run create-job -- '{"create_job_args":{"service_id":"1","request_id":"0x428532fb5bc6f3163b2dce769dfe3d70c397632386307ede126ab51184a860e0","input_commitment":"0x84dfc6b9fdcbb76398888160e7593d4a8c307927173d817ec507d7b5b6ba86b2","queue_timeout_seconds":3600,"expires_at":1778974718,"delivery_attester_signature":"0xdd180a7003b0d7f6e8d21b6547e30942020e847771ef775e53f510580c54c281431045a9761f651d7f0fbece4e7e0a99468a6cdefc905bcf5190355c34e247901b"}}'
```

For larger payloads, use a JSON file:

```shell
$ npm run create-job -- --file create-job-args.json
```

### Register Provider And Service

Set `RPC_URL` and `WALLET_PROVIDER_PRIVATE_KEY` in `.env`. `AGENT_HUB_REGISTRY_ADDRESS` is optional when `deployments/<chainId>.json` exists.

Run with the default demo provider/service metadata:

```shell
$ npm run register-provider-service
```

Or provide metadata files:

```shell
$ npm run register-provider-service -- --provider-file provider.json --service-file service.json
```

The script hashes each JSON object into `metadataCommitment`, calls `registerProvider`, then uses the emitted provider id to call `registerService`. `price_usdc` is converted to USDC base units with 6 decimals.

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
