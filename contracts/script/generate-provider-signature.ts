import "dotenv/config";

import fs from "fs";
import path from "path";
import { TypedDataDomain } from "@ethersproject/abstract-signer";
import { Wallet, utils } from "ethers";

type JsonObject = { [key: string]: unknown };

type TypedDataPayload = {
  typed_data?: {
    domain?: JsonObject;
    primaryType?: string;
    types?: Record<string, Array<{ name: string; type: string }>>;
    value?: JsonObject;
    message?: JsonObject;
  };
  start_job_args?: JsonObject;
};

type ValidTypedDataPayload = {
  typed_data: {
    domain: TypedDataDomain;
    primaryType: string;
    types: Record<string, Array<{ name: string; type: string }>>;
    value: JsonObject;
  };
  start_job_args: JsonObject;
};

const ROOT = path.resolve(__dirname, "..");
const USAGE = [
  "Usage:",
  "  npm run generate-provider-signature -- --file args/start-job-typed-data.json",
  "  npm run generate-provider-signature -- --file start-job-typed-data.json --out args/start-job-args.json",
  "  npm run generate-provider-signature -- '{\"typed_data\":{...},\"start_job_args\":{...}}'",
  "",
  "Env:",
  "  WALLET_PROVIDER_PRIVATE_KEY"
].join("\n");

function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== "") return value.trim();
  }

  return undefined;
}

function getProviderPrivateKey(): string {
  const privateKey = firstEnv([
    "WALLET_PROVIDER_PRIVATE_KEY",
    "PROVIDER_PRIVATE_KEY",
    "WALLET_PROVIDER",
    "wallet_provider"
  ]);
  if (!privateKey) {
    throw new Error("Missing required env var: WALLET_PROVIDER_PRIVATE_KEY");
  }

  const normalizedPrivateKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!utils.isHexString(normalizedPrivateKey, 32)) {
    throw new Error("WALLET_PROVIDER_PRIVATE_KEY must be a 32-byte hex private key");
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

function writeJsonFile(filePath: string, value: unknown): void {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  fs.writeFileSync(resolvedPath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseCliInput(): { input: unknown; outputPath?: string } {
  const args = process.argv.slice(2);

  if (args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  if (args.length === 0) {
    throw new Error(USAGE);
  }

  let input: unknown;
  let outputPath: string | undefined;
  const inlineJson: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--file" || arg === "-f") {
      if (!next) throw new Error(`Missing file path after ${arg}`);
      input = readJsonFile(next);
      index += 1;
      continue;
    }

    if (arg === "--out" || arg === "-o") {
      if (!next) throw new Error(`Missing file path after ${arg}`);
      outputPath = next;
      index += 1;
      continue;
    }

    inlineJson.push(arg);
  }

  if (input === undefined) {
    input = JSON.parse(inlineJson.join(" "));
  }

  return { input, outputPath };
}

function asTypedDataPayload(input: unknown): ValidTypedDataPayload {
  if (typeof input !== "object" || input === null) {
    throw new Error("Input must be a JSON object");
  }

  const payload = input as TypedDataPayload;
  if (typeof payload.typed_data !== "object" || payload.typed_data === null) {
    throw new Error("Missing typed_data object");
  }

  if (typeof payload.start_job_args !== "object" || payload.start_job_args === null) {
    throw new Error("Missing start_job_args object");
  }

  const { domain, primaryType, types } = payload.typed_data;
  const value = payload.typed_data.value ?? payload.typed_data.message;

  if (typeof domain !== "object" || domain === null) {
    throw new Error("Missing typed_data.domain object");
  }
  if (!primaryType || typeof primaryType !== "string") {
    throw new Error("Missing typed_data.primaryType");
  }
  if (primaryType !== "StartJobAuthorization") {
    throw new Error("typed_data.primaryType must be StartJobAuthorization");
  }
  if (typeof types !== "object" || types === null || !Array.isArray(types[primaryType])) {
    throw new Error(`Missing typed_data.types.${primaryType}`);
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Missing typed_data.value object");
  }

  return {
    typed_data: {
      domain: domain as TypedDataDomain,
      primaryType,
      types,
      value
    },
    start_job_args: payload.start_job_args
  };
}

function stripEip712DomainType(types: Record<string, Array<{ name: string; type: string }>>) {
  const { EIP712Domain, ...signableTypes } = types;
  void EIP712Domain;
  return signableTypes;
}

async function main(): Promise<void> {
  const { input, outputPath } = parseCliInput();
  const payload = asTypedDataPayload(input);
  const wallet = new Wallet(getProviderPrivateKey());
  const signableTypes = stripEip712DomainType(payload.typed_data.types);
  const signature = await wallet._signTypedData(
    payload.typed_data.domain,
    signableTypes,
    payload.typed_data.value
  );
  const recoveredAddress = utils.verifyTypedData(
    payload.typed_data.domain,
    signableTypes,
    payload.typed_data.value,
    signature
  );

  if (recoveredAddress !== wallet.address) {
    throw new Error(`Generated signature recovered ${recoveredAddress}, expected ${wallet.address}`);
  }

  const output = {
    ...payload,
    start_job_args: {
      ...payload.start_job_args,
      provider_signature: signature
    }
  };

  console.error(`Provider wallet: ${wallet.address}`);
  console.error(`Typed data digest: ${utils._TypedDataEncoder.hash(
    payload.typed_data.domain,
    signableTypes,
    payload.typed_data.value
  )}`);
  console.error(`Signature: ${signature}`);

  if (outputPath) {
    writeJsonFile(outputPath, output);
    console.error(`Wrote signed payload to ${outputPath}`);
    return;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
