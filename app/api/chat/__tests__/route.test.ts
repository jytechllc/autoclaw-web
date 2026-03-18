import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock all external dependencies before importing the route
vi.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  resolveUserPlan: vi.fn().mockResolvedValue("starter"),
}));

vi.mock("@/lib/ai", () => ({
  chatWithAI: vi.fn().mockResolvedValue({ content: "Hello!", provider: "google", model: "gemini", usage: null }),
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((v: string) => v),
  encrypt: vi.fn((v: string) => v),
}));

vi.mock("@/lib/leads", () => ({
  prospectDomain: vi.fn(),
  prospectMultipleDomains: vi.fn(),
}));

vi.mock("@/lib/rag", () => ({
  searchKnowledgeBase: vi.fn().mockResolvedValue([]),
  buildRagContext: vi.fn().mockReturnValue(""),
}));

import { POST, GET } from "../route";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

function mockSqlFn() {
  const fn = vi.fn().mockResolvedValue([]);
  return fn as unknown as ReturnType<typeof getDb>;
}

function createRequest(body: unknown, method = "POST"): NextRequest {
  const url = "http://localhost:3000/api/chat";
  if (method === "GET") {
    return new NextRequest(url, { method: "GET" });
  }
  return new NextRequest(url, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/chat - input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth0.getSession).mockResolvedValue(null);
    const req = createRequest({ message: "hello" });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 for invalid JSON body", async () => {
    vi.mocked(auth0.getSession).mockResolvedValue({
      user: { email: "test@test.com", name: "Test", sub: "auth0|123" },
      tokenSet: { accessToken: "test", expiresAt: Date.now() + 3600 },
    } as any);
    vi.mocked(getDb).mockReturnValue(mockSqlFn());

    const req = new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      body: "not json{{{",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid request body");
  });

  it("returns 400 when message is missing", async () => {
    vi.mocked(auth0.getSession).mockResolvedValue({
      user: { email: "test@test.com", name: "Test", sub: "auth0|123" },
      tokenSet: { accessToken: "test", expiresAt: Date.now() + 3600 },
    } as any);
    vi.mocked(getDb).mockReturnValue(mockSqlFn());

    const req = createRequest({ project_id: "1" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Message required");
  });

  it("returns 400 when message is empty string", async () => {
    vi.mocked(auth0.getSession).mockResolvedValue({
      user: { email: "test@test.com", name: "Test", sub: "auth0|123" },
      tokenSet: { accessToken: "test", expiresAt: Date.now() + 3600 },
    } as any);
    vi.mocked(getDb).mockReturnValue(mockSqlFn());

    const req = createRequest({ message: "" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Message required");
  });

  it("returns 400 when message is not a string", async () => {
    vi.mocked(auth0.getSession).mockResolvedValue({
      user: { email: "test@test.com", name: "Test", sub: "auth0|123" },
      tokenSet: { accessToken: "test", expiresAt: Date.now() + 3600 },
    } as any);
    vi.mocked(getDb).mockReturnValue(mockSqlFn());

    const req = createRequest({ message: 12345 });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Message required");
  });

  it("returns 400 when message is null", async () => {
    vi.mocked(auth0.getSession).mockResolvedValue({
      user: { email: "test@test.com", name: "Test", sub: "auth0|123" },
      tokenSet: { accessToken: "test", expiresAt: Date.now() + 3600 },
    } as any);
    vi.mocked(getDb).mockReturnValue(mockSqlFn());

    const req = createRequest({ message: null });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Message required");
  });
});

describe("GET /api/chat - input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth0.getSession).mockResolvedValue(null);
    const req = createRequest(null, "GET");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns empty messages for unknown user", async () => {
    vi.mocked(auth0.getSession).mockResolvedValue({
      user: { email: "unknown@test.com", name: "Unknown", sub: "auth0|999" },
      tokenSet: { accessToken: "test", expiresAt: Date.now() + 3600 },
    } as any);
    vi.mocked(getDb).mockReturnValue(mockSqlFn());

    const req = createRequest(null, "GET");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.messages).toEqual([]);
  });
});
