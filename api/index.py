"""
FastAPI app hosted as a Vercel Python serverless function.

Routing:
  - This file lives at `api/index.py` (top-level `api/`, NOT `app/api/`).
  - `vercel.json` rewrites `/api/py/(.*)` → `/api/index`, so any request
    under `/api/py/*` is delegated to this FastAPI app.
  - FastAPI's `root_path` matches the rewrite prefix so routes can be
    written without the `/api/py` prefix (e.g. `@app.get("/hello")`).

Adding endpoints: just register more `@app.<verb>` routes here, or split
into routers and `app.include_router(...)`. Deps go in `../requirements.txt`.
"""

from fastapi import FastAPI

app = FastAPI(
    title="AutoClaw Python API",
    version="0.1.0",
    root_path="/api/py",
    docs_url="/docs",
)


@app.get("/hello")
def hello() -> dict:
    import os
    import platform
    import sys

    return {
        "ok": True,
        "message": "Hello from FastAPI on Vercel",
        "runtime": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "vercel_region": os.environ.get("VERCEL_REGION", "unknown"),
            "vercel_env": os.environ.get("VERCEL_ENV", "local"),
        },
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
