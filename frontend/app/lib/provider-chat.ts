/** Resolve provider chat URL from registered `api_base_url` (base or …/chat). */
export function providerChatUrl(apiBaseUrl: string): string {
  const base = apiBaseUrl.trim().replace(/\/$/, "");
  if (/\/chat$/i.test(base)) return base;
  return `${base}/chat`;
}

export type InvokeProviderChatBody = {
  message: string;
  job_request_id: string;
  skillhub_api_url: string;
};

export type InvokeProviderChatResult = {
  ok: boolean;
  status: number;
  reply?: string;
  error?: string;
};
