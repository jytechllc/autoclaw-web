import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Brevo Webhook endpoint — receives real-time email event notifications.
 *
 * Configure in Brevo: Settings → Webhooks → Add Webhook
 * URL: https://your-domain.com/api/webhooks/brevo
 * Events: delivered, opened, click, hard_bounce, soft_bounce, spam, unsubscribed
 *
 * Brevo sends POST with JSON body:
 * { "event": "delivered", "email": "recipient@example.com", "message-id": "<...>", "ts_event": 1234567890, ... }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  // Brevo can send single event or batch
  const events = Array.isArray(body) ? body : [body];

  const sql = getDb();
  let processed = 0;

  for (const evt of events) {
    const event = evt.event as string;
    const messageId = (evt["message-id"] || evt.messageId) as string;
    const recipientEmail = evt.email as string;
    const timestamp = evt.ts_event ? new Date(evt.ts_event * 1000).toISOString() : new Date().toISOString();

    if (!event || (!messageId && !recipientEmail)) continue;

    try {
      // Map Brevo event to our status
      let newStatus: string | null = null;
      switch (event) {
        case "delivered":
          newStatus = "delivered";
          break;
        case "opened":
        case "unique_opened":
          // Update opened_at but don't change status if already delivered
          if (messageId) {
            await sql`
              UPDATE email_logs SET opened_at = COALESCE(opened_at, ${timestamp}), status = 'opened'
              WHERE message_id = ${messageId}
            `;
          } else if (recipientEmail) {
            await sql`
              UPDATE email_logs SET opened_at = COALESCE(opened_at, ${timestamp}), status = 'opened'
              WHERE recipient_email = ${recipientEmail} AND status IN ('delivered', 'sent', 'requests') AND opened_at IS NULL
            `;
          }
          processed++;
          continue;
        case "click":
          if (messageId) {
            await sql`
              UPDATE email_logs SET clicked_at = COALESCE(clicked_at, ${timestamp}), status = 'clicked'
              WHERE message_id = ${messageId}
            `;
          }
          processed++;
          continue;
        case "hard_bounce":
        case "soft_bounce":
          newStatus = "bounced";
          break;
        case "spam":
        case "complaint":
          newStatus = "error";
          break;
        case "unsubscribed":
          newStatus = "error";
          break;
        default:
          continue;
      }

      if (!newStatus) continue;

      const errorMessage = event === "hard_bounce" ? "Hard bounce" : event === "soft_bounce" ? "Soft bounce" : event === "spam" ? "Marked as spam" : null;

      if (messageId) {
        await sql`
          UPDATE email_logs SET
            status = ${newStatus},
            error_message = COALESCE(${errorMessage}, error_message),
            bounced_at = ${event.includes("bounce") ? timestamp : null}
          WHERE message_id = ${messageId}
        `;
      } else if (recipientEmail) {
        await sql`
          UPDATE email_logs SET
            status = ${newStatus},
            error_message = COALESCE(${errorMessage}, error_message),
            bounced_at = ${event.includes("bounce") ? timestamp : null}
          WHERE recipient_email = ${recipientEmail} AND status IN ('sent', 'requests')
          AND id = (SELECT id FROM email_logs WHERE recipient_email = ${recipientEmail} AND status IN ('sent', 'requests') ORDER BY created_at DESC LIMIT 1)
        `;
      }
      processed++;
    } catch (e) {
      console.error("[brevo-webhook] Error processing event:", event, e);
    }
  }

  return NextResponse.json({ received: events.length, processed });
}

// Brevo may send GET to verify the webhook URL
export async function GET() {
  return NextResponse.json({ status: "ok", service: "brevo-webhook" });
}
