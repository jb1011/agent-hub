import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      email,
      name,
      company,
      agentPurpose,
      hadIssues,
      setupTime,
      rating,
      other,
    } = body;

    if (!email || !name || !company || !agentPurpose || !hadIssues) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const recipientEmail = process.env.FEEDBACK_EMAIL ?? "feedback@agenthub.ai";

    const { error } = await resend.emails.send({
      from: "AgentHub Feedback <onboarding@resend.dev>",
      to: [recipientEmail],
      replyTo: email,
      subject: `[AgentHub Feedback] ${name} — ${company}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e5e5; border-radius: 4px;">
          <h2 style="margin: 0 0 24px; font-size: 20px; color: #0c0c0c;">
            New Feedback from <span style="color: #e85a00;">${name}</span>
          </h2>

          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #666; width: 40%; vertical-align: top;">Email</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #0c0c0c;">${email}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #666; vertical-align: top;">Name</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #0c0c0c;">${name}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #666; vertical-align: top;">Company / Agent</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #0c0c0c;">${company}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #666; vertical-align: top;">Agent Purpose</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #0c0c0c; white-space: pre-wrap;">${agentPurpose}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #666; vertical-align: top;">Had Issues?</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #0c0c0c; white-space: pre-wrap;">${hadIssues}</td>
            </tr>
            ${
              setupTime
                ? `<tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #666; vertical-align: top;">Setup Time</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #0c0c0c;">${setupTime}</td>
            </tr>`
                : ""
            }
            ${
              rating
                ? `<tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #666; vertical-align: top;">Experience Rating</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #e85a00; font-size: 18px;">${"★".repeat(Number(rating))}${"☆".repeat(5 - Number(rating))}</td>
            </tr>`
                : ""
            }
            ${
              other
                ? `<tr>
              <td style="padding: 10px 0; color: #666; vertical-align: top;">Other</td>
              <td style="padding: 10px 0; color: #0c0c0c; white-space: pre-wrap;">${other}</td>
            </tr>`
                : ""
            }
          </table>

          <p style="margin-top: 24px; font-size: 11px; color: #aaa;">Sent via AgentHub feedback form</p>
        </div>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Feedback route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
