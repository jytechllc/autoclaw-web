#!/usr/bin/env python3
"""
Overnight Jira worker.

Three modes (sequenced by the workflow):

1. TRIAGE  — for each open TODO ticket in the project, ask an LLM to
            categorize: SCRIPTABLE / NEEDS_DESIGN / BLOCKED / STALE.
            Skips tickets already commented on by this bot.

2. COMPLETE — pick the highest-priority SCRIPTABLE ticket, ask the LLM to
            output full file contents, validate with `npx tsc --noEmit`,
            commit to a feature branch, open a draft PR, comment on Jira,
            transition to In Review.

3. REPLENISH — if zero SCRIPTABLE tickets exist after triage, ask the LLM
            to propose new backlog items based on features.md + roadmap.md,
            create them in Jira.

stdlib only — uses urllib + subprocess so no `pip install` needed in CI.

Env vars (workflow passes them in):
  JIRA_API_TOKEN    Atlassian API token (Basic auth with JIRA_EMAIL)
  JIRA_EMAIL        Account email
  JIRA_SITE_URL     e.g. https://jytech2023.atlassian.net
  JIRA_PROJECT_KEY  e.g. KAN
  MODELS_TOKEN      GitHub Models PAT (models:read). Falls back to GITHUB_TOKEN if unset.
  GITHUB_TOKEN      Auto-provided by Actions. Used for opening PRs.
  GITHUB_REPOSITORY Auto-provided by Actions, e.g. "jytechllc/autoclaw-web"
  WORKER_BRANCH_PREFIX  defaults to "bot/jira"
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# ---------- config ----------

REPO_ROOT = Path(__file__).resolve().parents[3]  # autoclaw-web/
SCRIPT_DIR = Path(__file__).resolve().parent
PROMPTS_PATH = SCRIPT_DIR / "prompts.md"

def _resolve_sibling(name: str, ci_dir: str) -> Path:
    """Sibling repos are at REPO_ROOT.parent/<name> locally,
    and REPO_ROOT/<ci_dir> when the CI workflow checks them out into a subfolder."""
    in_ci = REPO_ROOT / ci_dir
    if in_ci.exists():
        return in_ci
    return REPO_ROOT.parent / name

ARCH_ROOT = _resolve_sibling("autoclaw-technical-architecture-design", "arch-design")
BIZ_ROOT = _resolve_sibling("autoclaw-business-architecture-design", "biz-design")

JIRA_TOKEN = os.environ["JIRA_API_TOKEN"]
JIRA_EMAIL = os.environ["JIRA_EMAIL"]
JIRA_SITE = os.environ["JIRA_SITE_URL"].rstrip("/")
PROJECT_KEY = os.environ.get("JIRA_PROJECT_KEY", "KAN")

MODELS_TOKEN = os.environ.get("MODELS_TOKEN") or os.environ["GITHUB_TOKEN"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
GITHUB_REPO = os.environ.get("GITHUB_REPOSITORY", "jytechllc/autoclaw-web")
BRANCH_PREFIX = os.environ.get("WORKER_BRANCH_PREFIX", "bot/jira")

BOT_MARKER = "<!-- bot:jira-overnight -->"
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

# GitHub Models free tier limits we've actually hit in prod:
#   - 10 req/min per model (UserByModelByMinute)
#   - 24 req/min per user (UserByUser)
# Stay well below by sleeping ~8s between calls (≈7.5/min) and capping the
# number of triages per run. Triage uses gpt-4o-mini (separate model quota)
# so it doesn't fight the COMPLETE call (gpt-4o) for the same budget.
TRIAGE_MODEL = "gpt-4o-mini"
COMPLETE_MODEL = "gpt-4o"
MODEL_CALL_DELAY_SEC = 8
MAX_TRIAGE_PER_RUN = int(os.environ.get("MAX_TRIAGE_PER_RUN", "8"))

# Files the worker is permitted to create or modify. Anything outside this
# allowlist makes the COMPLETE step bail. Defensive — the LLM may suggest
# touching auth or schema files and we want to refuse.
#
# Arch + biz repos are intentionally NOT included — they live at
# arch-design/ and biz-design/ in CI but writing to them needs a separate
# push token. The bot reads them for context only.
ALLOWED_PATH_PATTERNS = [
    r"^docs/.*\.md$",
    r"^lib/.*\.ts$",
    r"^app/api/.*/route\.ts$",
    r"^scripts/.*\.(ts|sh|md|py)$",
    r"^\.github/.*",
]
BLOCKED_PATH_PATTERNS = [
    r"\.env(\..*)?$",
    r"package-lock\.json$",
    r"node_modules/",
    r"^lib/(credits|auth0|db)\.ts$",  # too sensitive for autonomous edits
    r"\.sql$",
]

# ---------- HTTP helpers ----------

def _http(method: str, url: str, *, headers: dict | None = None, data: bytes | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, method=method, data=data)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _jira(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    url = f"{JIRA_SITE}{path}"
    auth = base64.b64encode(f"{JIRA_EMAIL}:{JIRA_TOKEN}".encode()).decode()
    headers = {"Authorization": f"Basic {auth}", "Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    status, raw = _http(method, url, headers=headers, data=data)
    try:
        return status, json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return status, {"raw": raw.decode("utf-8", "replace")}


class RateLimitError(RuntimeError):
    """Raised when GitHub Models returns 429. Caller should bail, not retry —
    free-tier windows are 60s and we don't want the worker burning CI minutes
    in a sleep loop."""


def _models_call(messages: list[dict], model: str = COMPLETE_MODEL, max_tokens: int = 1500) -> str:
    body = json.dumps({
        "model": model,
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "messages": messages,
    }).encode()
    status, raw = _http(
        "POST",
        "https://models.inference.ai.azure.com/chat/completions",
        headers={
            "Authorization": f"Bearer {MODELS_TOKEN}",
            "Content-Type": "application/json",
        },
        data=body,
    )
    if status == 429:
        raise RateLimitError(raw.decode("utf-8", "replace")[:500])
    if status != 200:
        raise RuntimeError(f"GitHub Models call failed: {status} {raw.decode('utf-8', 'replace')[:500]}")
    obj = json.loads(raw)
    return obj["choices"][0]["message"]["content"]

# ---------- prompts ----------

def load_prompt(mode: str) -> str:
    text = PROMPTS_PATH.read_text()
    m = re.search(rf"## Mode: {mode}\n(.*?)(?=\n## Mode: |\Z)", text, re.S)
    if not m:
        raise RuntimeError(f"Prompt mode '{mode}' not found in prompts.md")
    return m.group(1).strip()

# ---------- Jira interactions ----------

def fetch_todo_tickets() -> list[dict]:
    jql = f'project={PROJECT_KEY} AND status="To Do"'
    fields = "summary,description,status,issuetype,priority,labels,parent,comment"
    status, body = _jira("GET", f"/rest/api/3/search/jql?jql={urllib.request.quote(jql)}&fields={fields}&maxResults=50")
    if status != 200:
        print(f"::warning::Jira search returned {status}: {body}", file=sys.stderr)
        return []
    return body.get("issues", [])


def adf_to_text(adf: dict | None) -> str:
    """Flatten a tiny subset of Atlassian Document Format to plain text."""
    if not adf:
        return ""
    out: list[str] = []
    def walk(node):
        t = node.get("type")
        if t == "text":
            out.append(node.get("text", ""))
        elif t == "paragraph":
            for c in node.get("content", []):
                walk(c)
            out.append("\n")
        else:
            for c in node.get("content", []):
                walk(c)
    walk(adf)
    return "".join(out).strip()


def has_bot_comment(issue: dict) -> bool:
    """Skip tickets the bot has already commented on in this cycle."""
    comments = issue.get("fields", {}).get("comment", {}).get("comments", [])
    for c in comments:
        if BOT_MARKER in adf_to_text(c.get("body", {})):
            return True
    return False


def post_jira_comment(key: str, text: str) -> None:
    body = {
        "body": {
            "type": "doc",
            "version": 1,
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": f"{BOT_MARKER} {text}"}]}
            ],
        }
    }
    status, _ = _jira("POST", f"/rest/api/3/issue/{key}/comment", body)
    if status not in (200, 201):
        print(f"::warning::Failed to comment on {key}: {status}", file=sys.stderr)


def get_transition_id(key: str, target_status: str) -> str | None:
    status, body = _jira("GET", f"/rest/api/3/issue/{key}/transitions")
    if status != 200:
        return None
    for t in body.get("transitions", []):
        if t.get("name", "").lower() == target_status.lower():
            return t.get("id")
    return None


def transition_jira(key: str, target_status: str) -> bool:
    tid = get_transition_id(key, target_status)
    if not tid:
        return False
    status, _ = _jira("POST", f"/rest/api/3/issue/{key}/transitions", {"transition": {"id": tid}})
    return status in (200, 204)

# ---------- path safety ----------

def is_path_allowed(path: str) -> bool:
    if any(re.search(p, path) for p in BLOCKED_PATH_PATTERNS):
        return False
    return any(re.match(p, path) for p in ALLOWED_PATH_PATTERNS)

# ---------- git / PR ----------

def run(cmd: list[str], *, cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    print(f"$ {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=cwd or REPO_ROOT, check=check, capture_output=True, text=True)


def open_draft_pr(branch: str, title: str, body: str) -> str | None:
    # Use gh CLI which is preinstalled in Actions and uses GITHUB_TOKEN auto
    env = {**os.environ, "GH_TOKEN": GITHUB_TOKEN}
    p = subprocess.run(
        ["gh", "pr", "create", "--draft", "--title", title, "--body", body, "--label", "ai-generated", "--base", "main", "--head", branch],
        cwd=REPO_ROOT, env=env, capture_output=True, text=True,
    )
    if p.returncode != 0:
        print(f"::warning::gh pr create failed: {p.stderr}", file=sys.stderr)
        return None
    return p.stdout.strip()

# ---------- top-level modes ----------

def mode_triage_and_complete() -> int:
    """The main per-day pipeline: triage open tickets, complete one if possible."""
    tickets = fetch_todo_tickets()
    if not tickets:
        print("::notice::No TODO tickets — handing off to REPLENISH mode")
        return mode_replenish()

    print(f"Found {len(tickets)} TODO tickets")
    triage_prompt = load_prompt("TRIAGE")
    features_md = (ARCH_ROOT / "features.md").read_text(errors="replace")[:8000]

    # Pre-filter: skip Epics and tickets the bot has already commented on
    # BEFORE counting against our per-run budget. The 429 in dry-run came from
    # triaging 38 tickets back-to-back, including some bot-touched ones.
    triageable = [
        i for i in tickets
        if i["fields"]["issuetype"]["name"] != "Epic" and not has_bot_comment(i)
    ]
    skipped = len(tickets) - len(triageable)
    if skipped:
        print(f"  pre-filtered {skipped} (Epics / already-attempted)")

    candidates: list[tuple[dict, dict]] = []  # (issue, triage_decision)
    triaged = 0

    for issue in triageable:
        if triaged >= MAX_TRIAGE_PER_RUN:
            print(f"::notice::Hit MAX_TRIAGE_PER_RUN={MAX_TRIAGE_PER_RUN}; remaining tickets deferred to next run")
            break

        key = issue["key"]
        summary = issue["fields"].get("summary", "")
        desc = adf_to_text(issue["fields"].get("description"))
        user_msg = f"TICKET {key}: {summary}\n\nDescription:\n{desc}\n\n---\n\nfeatures.md (excerpt):\n{features_md[:5000]}"

        # Throttle between calls (skip on first to avoid wasted delay)
        if triaged > 0:
            time.sleep(MODEL_CALL_DELAY_SEC)

        try:
            raw = _models_call([
                {"role": "system", "content": triage_prompt},
                {"role": "user", "content": user_msg},
            ], model=TRIAGE_MODEL, max_tokens=600)
        except RateLimitError as e:
            print(f"::warning::Hit GitHub Models rate limit during triage of {key}. Bailing — remaining tickets deferred. ({str(e)[:200]})")
            break
        except Exception as e:
            print(f"  triage failed for {key}: {e}")
            triaged += 1
            continue
        triaged += 1

        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            print(f"  triage non-JSON for {key}: {raw[:200]}")
            continue
        try:
            decision = json.loads(m.group(0))
        except json.JSONDecodeError:
            print(f"  triage invalid JSON for {key}")
            continue
        print(f"  {key}: {decision.get('decision')} — {decision.get('reason')}")
        if decision.get("decision") == "SCRIPTABLE":
            candidates.append((issue, decision))
            # Stop early: we only complete one ticket per run anyway. No point
            # burning the remaining triage budget on more candidates.
            print(f"  found a SCRIPTABLE candidate; stopping triage to save budget for COMPLETE")
            break

    if not candidates:
        # If we burned the budget without finding a SCRIPTABLE one, don't
        # replenish — there may still be SCRIPTABLE work, we just didn't see
        # it. Replenish only when we actually triaged everything.
        if triaged >= MAX_TRIAGE_PER_RUN or triaged < len(triageable):
            print("::notice::No SCRIPTABLE found in this batch. Will retry rest tomorrow.")
            return 0
        print("::notice::No SCRIPTABLE tickets after full triage. Replenishing backlog.")
        return mode_replenish()

    # Take the first SCRIPTABLE (Jira returns by recency; you can re-rank here)
    issue, decision = candidates[0]
    return mode_complete(issue, decision)


def mode_complete(issue: dict, decision: dict) -> int:
    key = issue["key"]
    summary = issue["fields"].get("summary", "")
    desc = adf_to_text(issue["fields"].get("description"))
    scope = decision.get("scope", {})
    file_paths = list(scope.get("files_to_create", [])) + list(scope.get("files_to_modify", []))

    for p in file_paths:
        if not is_path_allowed(p):
            post_jira_comment(key, f"Triage suggested writing `{p}`, which is outside the bot's allowlist. Refusing to auto-complete; needs human review.")
            return 0

    # Read current content of files-to-modify
    existing: dict[str, str] = {}
    for p in scope.get("files_to_modify", []):
        full = REPO_ROOT / p if (REPO_ROOT / p).exists() else (REPO_ROOT.parent / p)
        if full.exists():
            existing[p] = full.read_text(errors="replace")[:8000]

    complete_prompt = load_prompt("COMPLETE")
    files_block = "\n\n".join(f"=== EXISTING {p} ===\n{content}" for p, content in existing.items())
    user_msg = (
        f"TICKET {key}: {summary}\n\n"
        f"Description:\n{desc}\n\n"
        f"Triage scope:\n{json.dumps(scope, indent=2)}\n\n"
        f"Existing files (you may rewrite these):\n{files_block}"
    )
    # Small breather before COMPLETE — triage may have just used a slot on
    # the per-user quota even though gpt-4o is a different model bucket.
    time.sleep(MODEL_CALL_DELAY_SEC)
    try:
        raw = _models_call([
            {"role": "system", "content": complete_prompt},
            {"role": "user", "content": user_msg},
        ], model=COMPLETE_MODEL, max_tokens=2500)
    except RateLimitError as e:
        print(f"::warning::Rate limit hit when calling COMPLETE for {key}; will retry tomorrow. ({str(e)[:200]})")
        return 0
    except Exception as e:
        post_jira_comment(key, f"Tried to complete but the model call failed: {e}")
        return 1

    if raw.strip().startswith("SKIP"):
        post_jira_comment(key, f"Bot deferred: {raw.strip().splitlines()[0]}")
        return 0

    files = parse_files_block(raw)
    if not files:
        post_jira_comment(key, "Bot output didn't parse into file blocks. Skipping.")
        return 0
    for p in files:
        if not is_path_allowed(p):
            post_jira_comment(key, f"Bot output included disallowed path `{p}`. Refusing to apply.")
            return 0

    branch = f"{BRANCH_PREFIX}/{key.lower()}"
    # Skip if branch already exists upstream
    existing_branch = run(["git", "ls-remote", "--heads", "origin", branch], check=False)
    if existing_branch.stdout.strip():
        post_jira_comment(key, f"Branch `{branch}` already exists upstream. Skipping to avoid clobber.")
        return 0

    if DRY_RUN:
        print(f"DRY_RUN: would write {len(files)} files and open PR for {key}")
        return 0

    # Configure git for the bot
    run(["git", "config", "user.email", "bot@autoclaw.jytech.us"])
    run(["git", "config", "user.name", "AutoClaw Overnight Bot"])
    run(["git", "checkout", "-b", branch])

    # Write files
    for path, content in files.items():
        target = REPO_ROOT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        run(["git", "add", str(path)])

    # Validate
    if any(p.endswith((".ts", ".tsx")) for p in files):
        tsc = run(["npx", "--no", "tsc", "--noEmit"], check=False)
        if tsc.returncode != 0:
            post_jira_comment(key, f"Bot stopped: TypeScript check failed.\n```\n{tsc.stdout[-2000:]}\n{tsc.stderr[-1000:]}\n```")
            run(["git", "reset", "--hard", "HEAD"], check=False)
            run(["git", "checkout", "main"], check=False)
            run(["git", "branch", "-D", branch], check=False)
            return 0

    run(["git", "commit", "-m", f"[{key}] {summary}\n\nAutoClaw overnight bot. AI-generated — review every line.\n\nRefs: {JIRA_SITE}/browse/{key}\nCo-Authored-By: AutoClaw Overnight Bot <bot@autoclaw.jytech.us>"])
    push = run(["git", "push", "origin", branch], check=False)
    if push.returncode != 0:
        post_jira_comment(key, f"git push failed:\n```\n{push.stderr[-1000:]}\n```")
        return 0

    pr_body = (
        f"Auto-generated by [`overnight-jira-worker`](.github/workflows/overnight-jira-worker.yml) for [{key}]({JIRA_SITE}/browse/{key}).\n\n"
        f"**Review every line — this PR has not been seen by a human yet.**\n\n"
        f"Ticket: {summary}\n\n"
        f"Bot decision: SCRIPTABLE — {decision.get('reason', '')}\n\n"
        f"Files touched:\n" + "\n".join(f"- `{p}`" for p in files) + "\n"
    )
    url = open_draft_pr(branch, f"[{key}] {summary}", pr_body)
    if url:
        post_jira_comment(key, f"PR opened: {url}\nThe PR is **draft + ai-generated label**. Review before merge.")
        transition_jira(key, "In Review")
    return 0


def parse_files_block(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    cur_path: str | None = None
    cur_buf: list[str] = []
    for line in raw.splitlines():
        m = re.match(r"^=+\s*(.+?)\s*=+\s*$", line)
        if m:
            if cur_path:
                out[cur_path] = "\n".join(cur_buf).rstrip() + "\n"
            cur_path = m.group(1)
            cur_buf = []
        else:
            cur_buf.append(line)
    if cur_path:
        out[cur_path] = "\n".join(cur_buf).rstrip() + "\n"
    return out


def mode_replenish() -> int:
    """Backlog empty / all triaged BLOCKED — propose new items based on arch design."""
    features = (ARCH_ROOT / "features.md").read_text(errors="replace")[:8000]
    roadmap_path = BIZ_ROOT / "roadmap.md"
    roadmap = roadmap_path.read_text(errors="replace")[:4000] if roadmap_path.exists() else "(roadmap.md not available — bot has no business-arch checkout)"
    prompt = load_prompt("REPLENISH")
    raw = _models_call([
        {"role": "system", "content": prompt},
        {"role": "user", "content": f"features.md:\n{features}\n\n---\n\nroadmap.md:\n{roadmap}"},
    ], max_tokens=1800)
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        print(f"::warning::Replenish output didn't parse: {raw[:300]}")
        return 0
    obj = json.loads(m.group(0))
    created: list[str] = []
    for item in obj.get("items", [])[:5]:
        body = {
            "fields": {
                "project": {"key": PROJECT_KEY},
                "issuetype": {"name": item.get("type", "Story")},
                "summary": item.get("summary", "(bot-proposed)"),
                "description": {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {"type": "paragraph", "content": [{"type": "text", "text": f"{BOT_MARKER} Pillar: {item.get('pillar', '?')}\n\n{item.get('description', '')}"}]}
                    ],
                },
            }
        }
        if item.get("epic_key"):
            body["fields"]["parent"] = {"key": item["epic_key"]}
        status, resp = _jira("POST", "/rest/api/3/issue", body)
        if status in (200, 201) and resp.get("key"):
            created.append(resp["key"])
            print(f"  proposed {resp['key']}: {item.get('summary')}")
        else:
            print(f"  failed to create: {status} {resp}")
    print(f"::notice::Replenished backlog with {len(created)} tickets: {', '.join(created)}")
    return 0


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "replenish":
        return mode_replenish()
    return mode_triage_and_complete()


if __name__ == "__main__":
    sys.exit(main())
