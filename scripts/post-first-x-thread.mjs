import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TwitterApi } from "twitter-api-v2";

const ROOT = resolve("/Users/wlin/dev/autoclaw/autoclaw-web");
const ENV_PATH = resolve(ROOT, ".env.production");

function parseEnvFile(path) {
  const text = readFileSync(path, "utf8");
  const result = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const env = parseEnvFile(ENV_PATH);
const client = new TwitterApi({
  appKey: env.X_API_KEY,
  appSecret: env.X_API_SECRET,
  accessToken: env.X_ACCESS_TOKEN,
  accessSecret: env.X_ACCESS_TOKEN_SECRET,
}).readWrite;

const posts = [
  "Most outbound fails before the first email. Not because the copy is bad. Because the list is weak, the contact data is incomplete, and nobody owns follow-up. That's the problem we're fixing with AutoClaw. https://autoclaw.jytech.us",
  "AutoClaw helps B2B teams build pipeline with 4 steps: 1) target account lists 2) contact enrichment 3) cold email setup 4) follow-up automation. No extra SDR headcount required.",
  "If you're selling into the US market and want a quick sample, we'll show you target accounts and contacts for your ICP first. Then we can stand up a live outbound workflow in 14 days.",
  "Best fit right now: founder-led B2B SaaS, high-ticket agencies, and exporters targeting North America. If outbound matters this quarter, we're interested in talking."
];

const SEND = process.env.SEND === "1";

if (!SEND) {
  console.log("Dry run. Thread content:");
  posts.forEach((post, index) => console.log(`\n${index + 1}. ${post}`));
  process.exit(0);
}

try {
  const me = await client.v2.me();
  console.log(`Authenticated as ${me.data.username}`);
} catch (error) {
  console.error("X auth check failed before posting.");
  throw error;
}

let replyToId;
for (const post of posts) {
  const tweet = replyToId
    ? await client.v2.reply(post, replyToId)
    : await client.v2.tweet(post);
  replyToId = tweet.data.id;
  console.log(`Posted ${replyToId}`);
}
