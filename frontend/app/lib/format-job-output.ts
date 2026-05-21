const TEXT_KEYS = ["reply", "text", "message", "content", "result", "output"] as const;

function unescapeNewlines(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function extractTextValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(value) as unknown;
        const extracted = extractTextValue(parsed);
        if (extracted !== null) return extracted;
      } catch {
        // Plain text that happens to start with { or [
      }
    }
    return unescapeNewlines(value);
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.uri === "string") return unescapeNewlines(record.uri);

    for (const key of TEXT_KEYS) {
      if (typeof record[key] === "string") {
        return unescapeNewlines(record[key] as string);
      }
    }

    const keys = Object.keys(record);
    if (keys.length === 1 && typeof record[keys[0]!] === "string") {
      return unescapeNewlines(record[keys[0]!] as string);
    }
  }

  return null;
}

/** Render job.output for the UI (plain text schema, uri objects, etc.). */
export function formatJobOutput(output: unknown): string {
  if (output == null) return "";
  const text = extractTextValue(output);
  if (text !== null) return text;
  return JSON.stringify(output, null, 2);
}
