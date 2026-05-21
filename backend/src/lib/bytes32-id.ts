import { hexlify, randomBytes } from "ethers";

export function generateBytes32Id(): string {
  return hexlify(randomBytes(32));
}
