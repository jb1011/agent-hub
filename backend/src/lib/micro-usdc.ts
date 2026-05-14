/** USDC has 6 decimals; amounts are stored as integer micro-units (1 USDC = 1_000_000). */
const MAX_MICRO = BigInt("999999999999999999"); // practical cap

export function parseMicroUsdc(input: string | number | bigint): bigint {
  if (typeof input === "bigint") {
    if (input < 0n) throw new Error("amount must be non-negative");
    if (input > MAX_MICRO) throw new Error("amount too large");
    return input;
  }
  if (typeof input === "number") {
    if (!Number.isInteger(input) || input < 0) throw new Error("amount must be a non-negative integer");
    return parseMicroUsdc(BigInt(input));
  }
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error("amount must be a base-10 integer string");
  const v = BigInt(trimmed);
  if (v > MAX_MICRO) throw new Error("amount too large");
  return v;
}

export function microUsdcToString(micro: bigint): string {
  return micro.toString();
}
