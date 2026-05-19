/**
 * xPilot image generation helper.
 * Submits a text-to-image task to the xPilot gateway and polls until it
 * completes, returning the final image URL(s). Used for email hero images.
 *
 * xPilot image API:
 *   POST /image/generate  → { task_id, status, outputs?, poll_url? }
 *   GET  <poll_url>       → { task_id, status, outputs, error }
 */

const XPILOT_API_KEY = process.env.XPILOT_API_KEY;
const XPILOT_BASE_URL = process.env.XPILOT_BASE_URL || "https://xpilot.jytech.us/api/v1";
const XPILOT_ORIGIN = new URL(XPILOT_BASE_URL).origin;

// Default text-to-image model — fast and good for marketing imagery.
export const DEFAULT_EMAIL_IMAGE_MODEL = "bytedance/seedream-v4";

export interface EmailImageResult {
  url: string;
  model: string;
  costCents: number;
}

interface GenerateOpts {
  prompt: string;
  model?: string;
  aspectRatio?: string; // e.g. "16:9", "1:1"
  /** Max time to wait for an async task before giving up (ms). */
  timeoutMs?: number;
}

/**
 * Generate one image via xPilot. Resolves once the task completes.
 * Throws on auth failure, API error, task failure, or timeout.
 */
export async function generateEmailImage(opts: GenerateOpts): Promise<EmailImageResult> {
  if (!XPILOT_API_KEY) throw new Error("XPILOT_API_KEY not configured");

  const model = opts.model || DEFAULT_EMAIL_IMAGE_MODEL;
  const timeoutMs = opts.timeoutMs ?? 50_000;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${XPILOT_API_KEY}`,
  };

  // 1. Submit the task
  const submitRes = await fetch(`${XPILOT_BASE_URL}/image/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      prompt: opts.prompt,
      aspect_ratio: opts.aspectRatio || "16:9",
      mode: "t2i",
    }),
  });
  if (!submitRes.ok) {
    const err = await submitRes.text();
    throw new Error(`xpilot image submit ${submitRes.status}: ${err.slice(0, 200)}`);
  }
  const submit = await submitRes.json() as {
    task_id: string;
    status: string;
    outputs?: string[];
    poll_url?: string;
    cost_cents?: number;
  };
  const costCents = submit.cost_cents ?? 0;

  // 2a. Sync models return the result immediately
  if (submit.status === "completed" && submit.outputs?.length) {
    return { url: submit.outputs[0], model, costCents };
  }

  // 2b. Async — poll until done or timeout
  if (!submit.poll_url) {
    throw new Error(`xpilot image: no outputs and no poll_url (status: ${submit.status})`);
  }
  const pollUrl = submit.poll_url.startsWith("http")
    ? submit.poll_url
    : `${XPILOT_ORIGIN}${submit.poll_url}`;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollRes = await fetch(pollUrl, { headers });
    if (!pollRes.ok) continue; // transient — keep polling
    const poll = await pollRes.json() as {
      status: string;
      outputs?: string[];
      error?: string;
    };
    if (poll.status === "completed" && poll.outputs?.length) {
      return { url: poll.outputs[0], model, costCents };
    }
    if (poll.status === "failed" || poll.error) {
      throw new Error(`xpilot image failed: ${poll.error || "unknown error"}`);
    }
  }
  throw new Error(`xpilot image timed out after ${timeoutMs}ms`);
}
