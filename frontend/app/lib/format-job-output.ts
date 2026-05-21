/** Render job.output for the UI (plain text schema, uri objects, etc.). */
export function formatJobOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.uri === "string") return record.uri;
    if (typeof record.text === "string") return record.text;
  }
  return JSON.stringify(output, null, 2);
}
