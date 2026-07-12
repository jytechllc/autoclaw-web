import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const PRIORITY_FILES = [
  "app/[locale]/page.tsx",
  "components/LanguageSwitcher.tsx",
  "app/[locale]/docs/enterprise-diagram/page.tsx",
  "app/globals.css",
  "app/[locale]/docs/page.tsx",
  "app/[locale]/privacy/page.tsx",
  "app/[locale]/terms/page.tsx",
];

function safeRead(relPath, maxChars = 12000) {
  const absPath = path.join(root, relPath);
  if (!existsSync(absPath)) return null;
  const raw = readFileSync(absPath, "utf8");
  const trimmed = raw.length > maxChars ? `${raw.slice(0, maxChars)}\n\n/* truncated */\n` : raw;
  return `## ${relPath}\n\n\`\`\`tsx\n${trimmed}\n\`\`\`\n`;
}

function runRg(args) {
  try {
    return execFileSync("rg", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stdout = error?.stdout?.toString?.() || "";
    return stdout.trim();
  }
}

const responsiveHits = runRg([
  "-n",
  "--glob",
  "!node_modules",
  "--glob",
  "!dist",
  "--glob",
  "!build",
  "(sm:|md:|lg:|xl:|2xl:|mobile|md:hidden|hidden md:|overflow-x|w-screen|min-w-|max-w-|sticky|fixed|translate-x|grid-cols-|flex-col|truncate)",
  "app",
  "components",
]).split("\n").filter(Boolean).slice(0, 250).join("\n");

const changedFiles = runRg([
  "--files",
  "app",
  "components",
]).split("\n").filter(Boolean).slice(0, 200);

const filesSection = PRIORITY_FILES
  .map((relPath) => safeRead(relPath))
  .filter(Boolean)
  .join("\n");

const packageJson = safeRead("package.json", 6000);

const generatedAt = new Date().toISOString();

process.stdout.write(`# Mobile UI Audit Context

- Generated: ${generatedAt}
- Repo: ${path.basename(root)}
- Focus: mobile navigation, responsive layout, locale switching, overflow, clipped controls, tap targets

## Candidate UI files

${changedFiles.map((file) => `- ${file}`).join("\n")}

## Responsive grep hits

\`\`\`
${responsiveHits || "(no responsive hits found)"}
\`\`\`

${packageJson || ""}

${filesSection}
`);
