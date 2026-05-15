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
