import { readFile } from "node:fs/promises";

export async function readJsonConfig<T>(relativePath: string): Promise<T> {
  const url = new URL(`../${relativePath.replace(/^\.\//, "")}`, import.meta.url);
  const raw = await readFile(url, "utf8");
  return JSON.parse(raw) as T;
}
