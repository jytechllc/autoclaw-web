import { describe, it, expect, vi } from "vitest";
import { executeTool, type ToolContext } from "../tools";

// Mock all external dependencies
vi.mock("@/lib/ai", () => ({
  chatWithAI: vi.fn().mockResolvedValue({ content: '[]', provider: "google", model: "gemini", usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }),
}));

vi.mock("@/lib/leads", () => ({
  prospectDomain: vi.fn().mockResolvedValue({ leads: [{ email: "test@example.com", firstName: "Test", lastName: "User", position: "CEO", source: "hunter" }], apolloCount: 0, hunterCount: 1, snovCount: 0 }),
  prospectMultipleDomains: vi.fn().mockResolvedValue({ results: [{ domain: "example.com", leads: [{ email: "a@b.com", firstName: "A", lastName: "B" }] }], totalLeads: 1, totalImported: 0 }),
  searchCompanies: vi.fn().mockResolvedValue([{ name: "TestCo", domain: "testco.com", industry: "Tech", location: "US", employeeCount: 50, contacts: [] }]),
  searchGoogleApify: vi.fn().mockResolvedValue("Google search results here"),
  crawlWebsiteApify: vi.fn().mockResolvedValue("Website content here"),
  searchLeadsApify: vi.fn().mockResolvedValue([{ email: "lead@co.com", firstName: "Lead", lastName: "Person", company: "LeadCo", position: "VP" }]),
  searchGoogleMaps: vi.fn().mockResolvedValue([{ name: "Biz1", website: "https://biz1.com", phone: "+1234", address: "123 St", category: "Tech" }]),
  searchLeadFinder: vi.fn().mockResolvedValue([{ email: "found@co.com", firstName: "Found", lastName: "Lead", position: "Dir", company: "FoundCo", linkedinUrl: "https://linkedin.com/in/found" }]),
  enrichCompanyDomains: vi.fn().mockResolvedValue([{ domain: "test.com", emails: ["a@test.com"], phones: ["+1"], emailPattern: "{first}@test.com", score: 80, grade: "A" }]),
}));

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const mockSql = Object.assign(
    vi.fn().mockResolvedValue([]),
    { catch: vi.fn().mockReturnThis() }
  ) as unknown as ToolContext["sql"];

  return {
    sql: mockSql,
    userId: 1,
    userPlan: "growth",
    projects: [{ id: 1, name: "TestProject", website: "https://test.com", description: "Test", access_role: "owner" }],
    agents: [],
    project_id: null,
    byok: {},
    selectedModel: "google/gemini-2.0-flash",
    apifyToken: "test-token",
    brevoApiKey: "",
    sendgridApiKey: "",
    sendStep: vi.fn(),
    ...overrides,
  };
}

describe("executeTool", () => {
  it("returns empty string for unknown tool", async () => {
    const ctx = createMockContext();
    const result = await executeTool("unknown_tool", {}, "", ctx);
    expect(result).toBe("");
  });

  describe("search_companies", () => {
    it("returns formatted company results", async () => {
      const ctx = createMockContext();
      const result = await executeTool("search_companies", { keywords: "tech", limit: 5 }, "Search tech companies", ctx);
      expect(result).toContain("TestCo");
      expect(result).toContain("testco.com");
      expect(result).toContain("Next steps");
    });
  });

  describe("prospect_domain", () => {
    it("returns formatted lead results", async () => {
      const ctx = createMockContext();
      const result = await executeTool("prospect_domain", { domain: "example.com" }, "Find contacts", ctx);
      expect(result).toContain("test@example.com");
      expect(result).toContain("Test User");
      expect(result).toContain("Lead search: example.com");
    });

    it("returns empty for missing domain", async () => {
      const ctx = createMockContext();
      const result = await executeTool("prospect_domain", {}, "", ctx);
      expect(result).toBe("");
    });
  });

  describe("prospect_multi", () => {
    it("returns multi-domain results", async () => {
      const ctx = createMockContext();
      const result = await executeTool("prospect_multi", { domains: ["example.com"] }, "", ctx);
      expect(result).toContain("example.com");
      expect(result).toContain("Total:");
    });

    it("returns empty for no domains", async () => {
      const ctx = createMockContext();
      const result = await executeTool("prospect_multi", { domains: [] }, "", ctx);
      expect(result).toBe("");
    });
  });

  describe("search_google", () => {
    it("returns Google results", async () => {
      const ctx = createMockContext();
      const result = await executeTool("search_google", { queries: ["test query"] }, "Google test", ctx);
      expect(result).toContain("Google search results");
    });

    it("fails without apify token", async () => {
      const ctx = createMockContext({ apifyToken: "" });
      const result = await executeTool("search_google", { queries: ["test"] }, "", ctx);
      expect(result).toContain("Apify API key not configured");
    });

    it("fails with empty queries", async () => {
      const ctx = createMockContext();
      const result = await executeTool("search_google", { queries: [] }, "", ctx);
      expect(result).toContain("provide at least one search query");
    });
  });

  describe("crawl_website", () => {
    it("returns crawled content", async () => {
      const ctx = createMockContext();
      const result = await executeTool("crawl_website", { url: "https://test.com" }, "", ctx);
      expect(result).toContain("Website content");
    });

    it("fails without apify token", async () => {
      const ctx = createMockContext({ apifyToken: "" });
      const result = await executeTool("crawl_website", { url: "https://test.com" }, "", ctx);
      expect(result).toContain("Apify API key not configured");
    });

    it("fails without URL", async () => {
      const ctx = createMockContext();
      const result = await executeTool("crawl_website", {}, "", ctx);
      expect(result).toContain("provide a URL");
    });
  });

  describe("search_leads_apify", () => {
    it("returns lead results", async () => {
      const ctx = createMockContext();
      const result = await executeTool("search_leads_apify", { keywords: ["tech"], job_titles: ["VP"] }, "Find tech VPs", ctx);
      expect(result).toContain("lead@co.com");
      expect(result).toContain("Next steps");
    });

    it("fails without apify token", async () => {
      const ctx = createMockContext({ apifyToken: "" });
      const result = await executeTool("search_leads_apify", { keywords: ["tech"] }, "", ctx);
      expect(result).toContain("Apify API key not configured");
    });
  });

  describe("search_google_maps", () => {
    it("returns business results", async () => {
      const ctx = createMockContext();
      const result = await executeTool("search_google_maps", { query: "restaurants NYC" }, "Find restaurants", ctx);
      expect(result).toContain("Biz1");
      expect(result).toContain("biz1.com");
      expect(ctx.sendStep).toHaveBeenCalledWith("search_google_maps");
    });

    it("fails without apify token", async () => {
      const ctx = createMockContext({ apifyToken: "" });
      const result = await executeTool("search_google_maps", { query: "test" }, "", ctx);
      expect(result).toContain("Apify API key not configured");
    });
  });

  describe("search_lead_finder", () => {
    it("returns lead finder results", async () => {
      const ctx = createMockContext();
      const result = await executeTool("search_lead_finder", { job_titles: ["Director"], locations: ["US"] }, "Find directors", ctx);
      expect(result).toContain("Found Lead");
      expect(result).toContain("FoundCo");
      expect(ctx.sendStep).toHaveBeenCalledWith("search_lead_finder");
    });

    it("fails without apify token", async () => {
      const ctx = createMockContext({ apifyToken: "" });
      const result = await executeTool("search_lead_finder", { job_titles: ["CTO"] }, "", ctx);
      expect(result).toContain("Apify API key not configured");
    });
  });

  describe("enrich_domains", () => {
    it("returns enrichment results", async () => {
      const ctx = createMockContext();
      const result = await executeTool("enrich_domains", { domains: ["test.com"] }, "Enrich test.com", ctx);
      expect(result).toContain("test.com");
      expect(result).toContain("a@test.com");
      expect(result).toContain("Score");
    });

    it("fails without apify token", async () => {
      const ctx = createMockContext({ apifyToken: "" });
      const result = await executeTool("enrich_domains", { domains: ["test.com"] }, "", ctx);
      expect(result).toContain("Apify API key not configured");
    });

    it("fails with empty domains", async () => {
      const ctx = createMockContext();
      const result = await executeTool("enrich_domains", { domains: [] }, "", ctx);
      expect(result).toContain("provide at least one domain");
    });
  });

  describe("save_contacts", () => {
    it("asks for project when none specified", async () => {
      const ctx = createMockContext();
      const result = await executeTool("save_contacts", {}, "", ctx);
      expect(result).toContain("specify which project");
    });

    it("rejects read-only project access", async () => {
      const ctx = createMockContext({
        projects: [{ id: 1, name: "ReadOnly", website: "", description: "", access_role: "reader" }],
      });
      const result = await executeTool("save_contacts", { project_name: "ReadOnly" }, "", ctx);
      expect(result).toContain("read-only");
    });
  });

  describe("send_email", () => {
    it("fails without email service configured", async () => {
      const ctx = createMockContext({ brevoApiKey: "", sendgridApiKey: "" });
      const result = await executeTool("send_email", { to: "test@test.com", subject: "Hi", body: "Hello" }, "", ctx);
      expect(result).toContain("No email service configured");
    });

    it("fails without recipient", async () => {
      const ctx = createMockContext({ brevoApiKey: "key" });
      const result = await executeTool("send_email", { subject: "Hi", body: "Hello" }, "", ctx);
      expect(result).toContain("specify a recipient");
    });
  });

  describe("enrich_contacts", () => {
    it("fails without project", async () => {
      const ctx = createMockContext({ projects: [], project_id: null });
      const result = await executeTool("enrich_contacts", {}, "", ctx);
      expect(result).toContain("No project found");
    });
  });
});
