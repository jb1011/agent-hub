import "dotenv/config";

import fs from "fs";
import path from "path";
import { BigNumber, Wallet, providers, utils } from "ethers";

type RawTxInput = {
  to: string;
  data: string;
  value: string | number;
  from: string;
  chain_id: string | number;
  nonce?: string | number;
  gas_limit?: string | number;
  gasLimit?: string | number;
  gas_price?: string | number;
  gasPrice?: string | number;
  max_fee_per_gas?: string | number;
  maxFeePerGas?: string | number;
  max_priority_fee_per_gas?: string | number;
  maxPriorityFeePerGas?: string | number;
};

const ROOT = path.resolve(__dirname, "..");
const USAGE = [
  "Usage:",
  "  npm run sign-send-tx -- --file args/tx.json",
  "  npm run sign-send-tx -- '{\"to\":\"0x...\",\"data\":\"0x...\",\"value\":\"0\",\"from\":\"0x...\",\"chain_id\":5042002}'",
  "",
  "Env:",
  "  RPC_URL",
  "  signer_pk or SIGNER_PK"
].join("\n");

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== "") return value.trim();
  }

  return undefined;
}

function getSignerPrivateKey(): string {
  const privateKey = firstEnv(["signer_pk", "SIGNER_PK"]);
  if (!privateKey) throw new Error("Missing required env var: signer_pk");

  const normalizedPrivateKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!utils.isHexString(normalizedPrivateKey, 32)) {
    throw new Error("signer_pk must be a 32-byte hex private key");
  }

  return normalizedPrivateKey;
}

function resolveJsonFilePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;

  const candidates = [
    path.resolve(process.cwd(), filePath),
    path.resolve(ROOT, filePath)
  ];

  if (path.dirname(filePath) === ".") {
    candidates.push(path.resolve(ROOT, "args", filePath));
  }

  const resolvedPath = candidates.find((candidate) => fs.existsSync(candidate));
  return resolvedPath ?? candidates[0];
}

function readJsonFile(filePath: string): unknown {
  const resolvedPath = resolveJsonFilePath(filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

function parseCliInput(): unknown {
  const args = process.argv.slice(2);

  if (args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  if (args.length === 0) throw new Error(USAGE);

  if (args[0] === "--file" || args[0] === "-f") {
    if (!args[1]) throw new Error("Missing file path after --file");
    return readJsonFile(args[1]);
  }

  return JSON.parse(args.join(" "));
}

function requireObject(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Input must be a JSON object");
  }

  return input as Record<string, unknown>;
}

function requireStringField(input: Record<string, unknown>, fieldName: keyof RawTxInput): string {
  const value = input[fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${String(fieldName)} must be a non-empty string`);
  }

  return value.trim();
}

function requireUintField(input: Record<string, unknown>, fieldName: keyof RawTxInput): BigNumber {
  const value = input[fieldName];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${String(fieldName)} must be a non-negative integer string or number`);
  }

  return asUint(value, String(fieldName));
}

function asOptionalUint(value: string | number | undefined, fieldName: string): BigNumber | undefined {
  if (value === undefined) return undefined;
  return asUint(value, fieldName);
}

function asUint(value: string | number, fieldName: string): BigNumber {
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return BigNumber.from(raw);
}

function asOptionalNumber(value: string | number | undefined, fieldName: string): number | undefined {
  if (value === undefined) return undefined;

  const raw = String(value);
  if (!/^\d+$/.test(raw)) throw new Error(`${fieldName} must be a non-negative integer`);

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${fieldName} must be a safe integer`);

  return parsed;
}

function getOptionalInputValue(input: RawTxInput, fields: Array<keyof RawTxInput>): string | number | undefined {
  for (const field of fields) {
    const value = input[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value as string | number;
    }
  }

  return undefined;
}

function asRawTxInput(input: unknown): RawTxInput {
  const objectInput = requireObject(input);
  const to = utils.getAddress(requireStringField(objectInput, "to"));
  const from = utils.getAddress(requireStringField(objectInput, "from"));
  const data = requireStringField(objectInput, "data");
  const chainId = requireUintField(objectInput, "chain_id");
  const value = requireUintField(objectInput, "value");

  if (!utils.isHexString(data)) throw new Error("data must be hex bytes");
  if (!chainId.lte(Number.MAX_SAFE_INTEGER.toString())) throw new Error("chain_id must be a safe integer");

  return {
    ...(objectInput as Partial<RawTxInput>),
    to,
    data,
    value: value.toString(),
    from,
    chain_id: chainId.toString()
  } as RawTxInput;
}

async function main(): Promise<void> {
  const input = asRawTxInput(parseCliInput());
  const provider = new providers.JsonRpcProvider(requiredEnv("RPC_URL"));
  const wallet = new Wallet(getSignerPrivateKey(), provider);
  const network = await provider.getNetwork();
  const signerAddress = await wallet.getAddress();
  const expectedChainId = Number(input.chain_id);

  if (network.chainId !== expectedChainId) {
    throw new Error(`RPC chain id is ${network.chainId}, but tx.chain_id is ${expectedChainId}`);
  }

  if (utils.getAddress(input.from) !== signerAddress) {
    throw new Error(`tx.from is ${input.from}, but signer address is ${signerAddress}`);
  }

  const txBase: providers.TransactionRequest = {
    to: input.to,
    data: input.data,
    value: BigNumber.from(input.value),
    from: signerAddress,
    chainId: expectedChainId,
    nonce: asOptionalNumber(input.nonce, "nonce") ?? await provider.getTransactionCount(signerAddress, "pending")
  };

  const providedGasLimit = asOptionalUint(
    getOptionalInputValue(input, ["gas_limit", "gasLimit"]),
    "gas_limit"
  );
  txBase.gasLimit = providedGasLimit ?? (await provider.estimateGas(txBase)).mul(120).div(100);

  const gasPrice = asOptionalUint(getOptionalInputValue(input, ["gas_price", "gasPrice"]), "gas_price");
  const maxFeePerGas = asOptionalUint(
    getOptionalInputValue(input, ["max_fee_per_gas", "maxFeePerGas"]),
    "max_fee_per_gas"
  );
  const maxPriorityFeePerGas = asOptionalUint(
    getOptionalInputValue(input, ["max_priority_fee_per_gas", "maxPriorityFeePerGas"]),
    "max_priority_fee_per_gas"
  );

  if (gasPrice && (maxFeePerGas || maxPriorityFeePerGas)) {
    throw new Error("Use either gas_price or EIP-1559 fee fields, not both");
  }

  if (gasPrice) {
    txBase.gasPrice = gasPrice;
  } else if (maxFeePerGas || maxPriorityFeePerGas) {
    if (!maxFeePerGas || !maxPriorityFeePerGas) {
      throw new Error("Both max_fee_per_gas and max_priority_fee_per_gas are required for EIP-1559 txs");
    }

    txBase.type = 2;
    txBase.maxFeePerGas = maxFeePerGas;
    txBase.maxPriorityFeePerGas = maxPriorityFeePerGas;
  } else {
    const feeData = await provider.getFeeData();
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      txBase.type = 2;
      txBase.maxFeePerGas = feeData.maxFeePerGas;
      txBase.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    } else if (feeData.gasPrice) {
      txBase.gasPrice = feeData.gasPrice;
    } else {
      throw new Error("Could not determine gas fees from provider");
    }
  }

  console.log(`Signing transaction on chain ${expectedChainId}`);
  console.log(`From: ${signerAddress}`);
  console.log(`To: ${input.to}`);
  console.log(`Value: ${txBase.value?.toString() ?? "0"}`);
  console.log(`Nonce: ${txBase.nonce}`);
  console.log(`Gas limit: ${txBase.gasLimit.toString()}`);

  const signedTx = await wallet.signTransaction(txBase);
  const parsedTx = utils.parseTransaction(signedTx);
  console.log(`Signed transaction hash: ${parsedTx.hash}`);

  const response = await provider.sendTransaction(signedTx);
  console.log(`Transaction sent: ${response.hash}`);

  const receipt = await response.wait();
  console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
  console.log(`Status: ${receipt.status === 1 ? "success" : "failed"}`);
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);

  if (receipt.status !== 1) {
    throw new Error(`Transaction ${response.hash} was mined but failed`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
