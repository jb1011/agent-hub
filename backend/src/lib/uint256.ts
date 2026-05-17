import { z } from "zod";

export const UINT256_MAX = (1n << 256n) - 1n;
export const UINT256_MAX_DECIMAL = UINT256_MAX.toString();

const UINT256_DECIMAL_PATTERN = /^(0|[1-9]\d*)$/;

export function isUint256String(value: string): boolean {
  if (!UINT256_DECIMAL_PATTERN.test(value)) return false;
  if (value.length > UINT256_MAX_DECIMAL.length) return false;
  return BigInt(value) <= UINT256_MAX;
}

export function uint256StringSchema(fieldName: string) {
  return z
    .string()
    .refine(isUint256String, `${fieldName}_must_be_uint256_decimal_string`);
}
