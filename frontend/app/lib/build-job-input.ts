type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

const TEXT_FIELD_PRIORITY = [
  "prompt",
  "text",
  "message",
  "query",
  "input",
  "content",
  "uri",
] as const;

function asSchema(value: unknown): JsonSchema | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonSchema;
}

function primaryStringField(schema: JsonSchema): string | null {
  const properties = schema.properties;
  if (!properties) return null;

  for (const key of TEXT_FIELD_PRIORITY) {
    if (properties[key]?.type === "string") return key;
  }

  for (const [key, field] of Object.entries(properties)) {
    if (field?.type === "string") return key;
  }

  return null;
}

/** Map a single user text field to the provider's registered JSON Schema input shape. */
export function buildJobInputFromSchema(
  inputSchema: unknown,
  userText: string,
): unknown {
  const trimmed = userText.trim();
  const schema = asSchema(inputSchema);

  if (!schema) {
    return { prompt: trimmed };
  }

  if (schema.type === "string") {
    return trimmed;
  }

  if (schema.type === "object") {
    const field = primaryStringField(schema);
    if (field) {
      return { [field]: trimmed };
    }

    const keys = Object.keys(schema.properties ?? {});
    if (keys.length === 1) {
      return { [keys[0]!]: trimmed };
    }
  }

  return { prompt: trimmed };
}

/** Human-readable hint for the job form (e.g. `input.prompt`). */
export function describeJobInputField(inputSchema: unknown): string {
  const schema = asSchema(inputSchema);

  if (!schema) {
    return "input.prompt";
  }

  if (schema.type === "string") {
    return "input (plain string)";
  }

  if (schema.type === "object") {
    const field = primaryStringField(schema);
    if (field) {
      return `input.${field}`;
    }
  }

  return "input";
}
