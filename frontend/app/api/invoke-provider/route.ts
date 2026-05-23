import { NextRequest, NextResponse } from "next/server";
import {
  providerChatUrl,
  type InvokeProviderChatBody,
} from "../../lib/provider-chat";

/**
 * Server-side proxy so the browser can trigger the provider agent without CORS.
 * The provider must handle `job_request_id` and complete Skill Hub start/finish.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      api_base_url?: string;
      message?: string;
      job_request_id?: string;
      job_id?: string;
      provider_request_id?: string;
      skillhub_api_url?: string;
    };

    const apiBaseUrl = body.api_base_url?.trim();
    const message = body.message?.trim();
    const jobRequestId = body.job_request_id?.trim();
    const jobId = body.job_id?.trim();
    const providerRequestId = body.provider_request_id?.trim();
    const skillhubApiUrl = body.skillhub_api_url?.trim();

    if (!apiBaseUrl || !message || !jobRequestId || !skillhubApiUrl) {
      return NextResponse.json(
        { error: "api_base_url, message, job_request_id, and skillhub_api_url are required" },
        { status: 400 },
      );
    }

    const url = providerChatUrl(apiBaseUrl);
    const payload: InvokeProviderChatBody = {
      message,
      job_request_id: jobRequestId,
      skillhub_api_url: skillhubApiUrl,
      ...(jobId ? { job_id: jobId } : {}),
      ...(providerRequestId ? { provider_request_id: providerRequestId } : {}),
    };

    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });

    const text = await upstream.text();
    let parsed: { reply?: string; error?: string } = {};
    try {
      parsed = JSON.parse(text) as { reply?: string; error?: string };
    } catch {
      parsed = { error: text.slice(0, 500) };
    }

    if (!upstream.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: upstream.status,
          error:
            parsed.error ??
            (text.slice(0, 500) || `Provider returned ${upstream.status}`),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      status: upstream.status,
      reply: typeof parsed.reply === "string" ? parsed.reply : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "invoke_provider_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
