"""
Smoke-test Python endpoint hosted by Vercel.

URL: /api/hello

Routing (no prefix, no rewrites):
  - Vercel checks Next.js routes (app/api/*) first.
  - If no Next.js route matches the path, Vercel falls back to the
    project-root `api/<name>.py` files.
  - This file maps to `/api/hello` based on its path. Since there is no
    `app/api/hello/route.ts`, Vercel serves Python here.

Pattern for adding more Python endpoints: create `api/<name>.py` with its
own FastAPI app (or BaseHTTPRequestHandler). Each file is its own
serverless function. Share code via a `_lib/` sibling module (the `_`
prefix keeps Vercel from treating it as a route).
"""

from fastapi import FastAPI

app = FastAPI(title="autoclaw /api/hello", docs_url=None, redoc_url=None)


@app.get("/api/hello")
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
