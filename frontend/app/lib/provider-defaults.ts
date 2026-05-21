/** JSON Schema sent on every provider registration — plain-text in / out. */
export const PLAIN_TEXT_INPUT_SCHEMA = {
  type: "string",
  title: "Plain text",
  description: "User question or prompt as plain text",
} as const;

export const PLAIN_TEXT_OUTPUT_SCHEMA = {
  type: "string",
  title: "Plain text",
  description: "Agent response as plain text",
} as const;

export const DEFAULT_PROVIDER_TIMEOUT_SECONDS = 300;
