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
$ npm run create-job -- '{"create_job_args":{"provider_id":"1","request_id":"0x428532fb5bc6f3163b2dce769dfe3d70c397632386307ede126ab51184a860e0","input_commitment":"0x84dfc6b9fdcbb76398888160e7593d4a8c307927173d817ec507d7b5b6ba86b2","queue_timeout_seconds":3600,"expires_at":1778974718,"delivery_attester_signature":"0xdd180a7003b0d7f6e8d21b6547e30942020e847771ef775e53f510580c54c281431045a9761f651d7f0fbece4e7e0a99468a6cdefc905bcf5190355c34e247901b"}}'
```

For larger payloads, use a JSON file:

```shell
$ npm run create-job -- --file args/create-job-args.json
```

### Generate Provider Signature

Set `WALLET_PROVIDER_PRIVATE_KEY` in `.env`, then sign a backend `typed_data` payload from `POST /jobs/:id/start-authorization-request`:

```shell
$ npm run generate-provider-signature -- --file args/start-job-typed-data.json
```

The script prints JSON with `start_job_args.provider_signature` added. To write it to a file:

```shell
$ npm run generate-provider-signature -- --file args/start-job-typed-data.json --out args/start-job-args.json
```

### Start Job

Set `RPC_URL` and `WALLET_PROVIDER_PRIVATE_KEY` in `.env`. `AGENT_HUB_ESCROW_ADDRESS` is optional when `deployments/<chainId>.json` exists.

Then pass either the signed payload from `generate-provider-signature` or the nested `start_job_args` object:

```shell
$ npm run start-job -- '{"start_job_args":{"job_id":"4","expires_at":1893456000,"provider_signature":"0xd4594491327d21e1df49e8cfe779a505ef502b628656dd3cdc6e36e9454c84f86b531080fdfa70f880193bd22ad67d4a3dccf3bb87769d93e9f252d914082a161b"}}'
```

For larger payloads, use a JSON file:

```shell
$ npm run start-job -- --file args/start-job-args.json
```

### Refund With No Delivery Attestation

Set `RPC_URL` and `WALLET_USER_PRIVATE_KEY` in `.env`. `AGENT_HUB_ESCROW_ADDRESS` is optional when `deployments/<chainId>.json` exists.

Then pass either the full API response object or the nested `refund_with_no_delivery_attestation_args` object:

```shell
$ npm run refund-with-no-delivery-attestation -- '{"refund_with_no_delivery_attestation_args":{"job_id":"4","checked_at":1779041199,"expires_at":1779044799,"no_delivery_attester_signature":"0x822b95632aff6e7228599457d7cde0fa9df7539a0313870fccfb2ca1a4e524197c923cf10feac38a3672e6f15a2aaebd1ee6499fd4f1406af1aab04c61b0344c1c"}}'
```

For larger payloads, use a JSON file:

```shell
$ npm run refund-with-no-delivery-attestation -- --file args/refund-with-no-delivery-attestation-args.json
```

### Generate User Signature

Set `WALLET_USER_PRIVATE_KEY` in `.env`, then sign a backend `typed_data` payload:

```shell
$ npm run generate-user-signature -- --file args/settle-with-user-signature-typed-data.json
```

The script prints JSON with `settle_with_user_signature_args.user_signature` added. To write it to a file:

```shell
$ npm run generate-user-signature -- --file args/settle-with-user-signature-typed-data.json --out args/settle-with-user-signature-args.json
```

### Settle With User Signature

Set `RPC_URL` and `WALLET_PROVIDER_PRIVATE_KEY` in `.env`. `AGENT_HUB_ESCROW_ADDRESS` is optional when `deployments/<chainId>.json` exists.

Then pass either the full API response object or the nested `settle_with_user_signature_args` object:

```shell
$ npm run settle-with-user-signature -- --file args/settle-with-user-signature-args.json
```

### Register Provider

Provider registration happens through the backend `/providers` endpoint, which signs a `RegisterProviderAuthorization` (EIP-712, same `deliveryAttester` as `createJob`) and returns a prepared `registerProvider` transaction with `expires_at` and `registration_attester_signature`.

### Sign And Send Transaction

Set `RPC_URL` and `signer_pk` in `.env`, then pass a transaction JSON file:

```json
{
  "to": "0x...",
  "data": "0x...",
  "value": "0",
  "from": "0x...",
  "chain_id": 5042002
}
```

Run:

```shell
$ npm run sign-send-tx -- --file args/tx.json
```

The script checks that `from` matches `signer_pk`, checks that `chain_id` matches the RPC, fills `nonce`, `gasLimit`, and gas fees when missing, signs the transaction locally, sends the signed raw transaction, then waits for the receipt.

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
