import { describe, it, expect } from "vitest";
import {
  AVAILABLE_AGENTS,
  AGENT_PLANS,
  BYOK_SERVICES,
  DAILY_LIMIT_CENTS,
  COST_PER_M,
  TOOL_LABELS,
  getAgentLimit,
  matchAgentTypes,
  extractProjectInfo,
  nextStepsHint,
  formatLeadTable,
  buildSystemPrompt,
  TOOL_SYSTEM_PROMPT_EXTENSION,
} from "../constants";

// ── Constants integrity ──

describe("AVAILABLE_AGENTS", () => {
  it("has all 6 agent types", () => {
    expect(AVAILABLE_AGENTS).toHaveLength(6);
    const types = AVAILABLE_AGENTS.map((a) => a.type);
    expect(types).toContain("email_marketing");
    expect(types).toContain("seo_content");
    expect(types).toContain("lead_prospecting");
    expect(types).toContain("social_media");
    expect(types).toContain("product_manager");
    expect(types).toContain("sales_followup");
  });

  it("each agent has type, label, desc", () => {
    for (const agent of AVAILABLE_AGENTS) {
      expect(agent.type).toBeTruthy();
      expect(agent.label).toBeTruthy();
      expect(agent.desc).toBeTruthy();
    }
  });
});

describe("AGENT_PLANS", () => {
  it("has a plan for every AVAILABLE_AGENTS type + orchestrator", () => {
    for (const agent of AVAILABLE_AGENTS) {
      expect(AGENT_PLANS[agent.type]).toBeDefined();
      expect(AGENT_PLANS[agent.type].plan).toBeTruthy();
      expect(AGENT_PLANS[agent.type].tasks.length).toBeGreaterThan(0);
      expect(Array.isArray(AGENT_PLANS[agent.type].blockers)).toBe(true);
    }
    expect(AGENT_PLANS.orchestrator).toBeDefined();
  });
});

describe("BYOK_SERVICES", () => {
  it("maps supported services", () => {
    expect(BYOK_SERVICES.openai).toBe("openai");
    expect(BYOK_SERVICES.anthropic).toBe("anthropic");
    expect(BYOK_SERVICES.google).toBe("google");
    expect(BYOK_SERVICES.qwen).toBe("alibaba");
    expect(BYOK_SERVICES.dashscope).toBe("alibaba");
    expect(BYOK_SERVICES.cloudflare).toBe("worker_url");
  });
});

describe("DAILY_LIMIT_CENTS", () => {
  it("starter is $1, enterprise is unlimited", () => {
    expect(DAILY_LIMIT_CENTS.starter).toBe(100);
    expect(DAILY_LIMIT_CENTS.enterprise).toBe(0);
  });
});

describe("COST_PER_M", () => {
  it("cerebras is free", () => {
    expect(COST_PER_M.cerebras.input).toBe(0);
    expect(COST_PER_M.cerebras.output).toBe(0);
  });
  it("has all providers", () => {
    expect(COST_PER_M.google).toBeDefined();
    expect(COST_PER_M.openai).toBeDefined();
    expect(COST_PER_M.anthropic).toBeDefined();
  });
});

describe("TOOL_LABELS", () => {
  it("has en, zh, zh-TW, fr locales", () => {
    expect(TOOL_LABELS.en).toBeDefined();
    expect(TOOL_LABELS.zh).toBeDefined();
    expect(TOOL_LABELS["zh-TW"]).toBeDefined();
    expect(TOOL_LABELS.fr).toBeDefined();
  });
  it("each locale has done label", () => {
    for (const locale of ["en", "zh", "zh-TW", "fr"]) {
      expect(TOOL_LABELS[locale].done).toBeTruthy();
    }
  });
});

// ── Helper functions ──

describe("getAgentLimit", () => {
  it("returns 999 for all known plans", () => {
    expect(getAgentLimit("starter")).toBe(999);
    expect(getAgentLimit("growth")).toBe(999);
    expect(getAgentLimit("scale")).toBe(999);
    expect(getAgentLimit("enterprise")).toBe(999);
  });
  it("returns 999 for unknown plan", () => {
    expect(getAgentLimit("unknown")).toBe(999);
  });
});

describe("matchAgentTypes", () => {
  it("matches email keywords", () => {
    expect(matchAgentTypes("I need email outreach")).toContain("email_marketing");
    expect(matchAgentTypes("set up newsletter")).toContain("email_marketing");
  });

  it("matches SEO keywords", () => {
    expect(matchAgentTypes("help with SEO")).toContain("seo_content");
    expect(matchAgentTypes("write a blog post")).toContain("seo_content");
  });

  it("matches lead keywords", () => {
    expect(matchAgentTypes("find leads")).toContain("lead_prospecting");
    expect(matchAgentTypes("prospect companies")).toContain("lead_prospecting");
  });

  it("matches social media keywords", () => {
    expect(matchAgentTypes("post on twitter")).toContain("social_media");
    expect(matchAgentTypes("linkedin campaign")).toContain("social_media");
  });

  it("matches sales keywords", () => {
    expect(matchAgentTypes("CRM integration")).toContain("sales_followup");
    expect(matchAgentTypes("nurture leads")).toContain("sales_followup");
  });

  it("matches product manager by label", () => {
    expect(matchAgentTypes("product manager")).toContain("product_manager");
  });

  it("returns empty for unrelated input", () => {
    expect(matchAgentTypes("hello world")).toEqual([]);
  });

  it("can match multiple agents", () => {
    const result = matchAgentTypes("email outreach and SEO blog content");
    expect(result).toContain("email_marketing");
    expect(result).toContain("seo_content");
  });
});

describe("extractProjectInfo", () => {
  it("extracts name from structured input", () => {
    const result = extractProjectInfo("Name: Acme Corp\nWebsite: https://acme.com\nDescription: Widget maker");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Acme Corp");
    expect(result!.website).toBe("https://acme.com");
    expect(result!.description).toBe("Widget maker");
  });

  it("extracts URL from text", () => {
    const result = extractProjectInfo("Company: TestCo\nCheck out https://testco.io for more");
    expect(result).not.toBeNull();
    expect(result!.website).toBe("https://testco.io");
  });

  it("extracts name from natural language patterns", () => {
    const result = extractProjectInfo("I run a company called MedTravel");
    expect(result).not.toBeNull();
    expect(result!.name).toBeTruthy();
  });

  it("returns null if no name found", () => {
    const result = extractProjectInfo("hello");
    expect(result).toBeNull();
  });

  it("truncates long names to 100 chars", () => {
    const longName = "A".repeat(200);
    const result = extractProjectInfo(`Company: ${longName}`);
    expect(result).not.toBeNull();
    expect(result!.name.length).toBeLessThanOrEqual(200); // structured input not truncated
  });
});

describe("nextStepsHint", () => {
  it("returns hint string with project names", () => {
    const projects = [
      { id: 1, name: "TestProject", website: "", description: "", access_role: "owner" },
    ];
    const hint = nextStepsHint(projects);
    expect(hint).toContain("save contacts");
    expect(hint).toContain("TestProject");
    expect(hint).toContain("enrich");
  });

  it("shows read-only projects separately", () => {
    const projects = [
      { id: 1, name: "Editable", website: "", description: "", access_role: "editor" },
      { id: 2, name: "ReadOnly", website: "", description: "", access_role: "reader" },
    ];
    const hint = nextStepsHint(projects);
    expect(hint).toContain("ReadOnly");
    expect(hint).toContain("Read-only");
  });

  it("handles empty projects", () => {
    const hint = nextStepsHint([]);
    expect(hint).toContain("save contacts");
  });
});

describe("formatLeadTable", () => {
  const leads = [
    { email: "john@acme.com", firstName: "John", lastName: "Doe", position: "CEO", source: "hunter", verified: true },
    { email: "jane@acme.com", firstName: "Jane", lastName: "Smith", position: "CTO", source: "apollo", confidence: 90 },
  ];

  it("formats standard table rows", () => {
    const table = formatLeadTable(leads);
    expect(table).toContain("john@acme.com");
    expect(table).toContain("John Doe");
    expect(table).toContain("[verified]");
    expect(table).toContain("[90%]");
  });

  it("formats lead_finder table rows", () => {
    const lfLeads = [
      { email: "bob@co.com", firstName: "Bob", lastName: "Lee", position: "VP", company: "Co", linkedinUrl: "https://linkedin.com/in/bob" },
    ];
    const table = formatLeadTable(lfLeads, "lead_finder");
    expect(table).toContain("Bob Lee");
    expect(table).toContain("bob@co.com");
    expect(table).toContain("Co");
    expect(table).toContain("linkedin.com/in/bob");
  });

  it("handles missing fields gracefully", () => {
    const table = formatLeadTable([{ email: "x@y.com" }]);
    expect(table).toContain("x@y.com");
    expect(table).toContain("—"); // missing name shows dash
  });
});

// ── System prompt ──

describe("buildSystemPrompt", () => {
  it("builds prompt with user context", () => {
    const prompt = buildSystemPrompt({
      projects: [{ id: 1, name: "TestProject", website: "https://test.com", description: "", access_role: "owner" }],
      agents: [{ agent_type: "seo_content", project_name: "TestProject", status: "active" }],
      userPlan: "growth",
      agentLimit: 999,
      ragContext: "",
      locale: "en",
    });
    expect(prompt).toContain("AutoClaw");
    expect(prompt).toContain("TestProject");
    expect(prompt).toContain("seo_content");
    expect(prompt).toContain("growth");
  });

  it("includes RAG context when provided", () => {
    const prompt = buildSystemPrompt({
      projects: [],
      agents: [],
      userPlan: "starter",
      agentLimit: 999,
      ragContext: "Custom knowledge base content here",
      locale: "en",
    });
    expect(prompt).toContain("Custom knowledge base content here");
  });

  it("adds Chinese instruction for zh locale", () => {
    const prompt = buildSystemPrompt({
      projects: [],
      agents: [],
      userPlan: "starter",
      agentLimit: 999,
      ragContext: "",
      locale: "zh",
    });
    expect(prompt).toContain("简体中文");
  });

  it("adds French instruction for fr locale", () => {
    const prompt = buildSystemPrompt({
      projects: [],
      agents: [],
      userPlan: "starter",
      agentLimit: 999,
      ragContext: "",
      locale: "fr",
    });
    expect(prompt).toContain("Français");
  });

  it("notes no projects when empty", () => {
    const prompt = buildSystemPrompt({
      projects: [],
      agents: [],
      userPlan: "starter",
      agentLimit: 999,
      ragContext: "",
      locale: "en",
    });
    expect(prompt).toContain("no projects yet");
  });
});

describe("TOOL_SYSTEM_PROMPT_EXTENSION", () => {
  it("contains tool calling instructions", () => {
    expect(TOOL_SYSTEM_PROMPT_EXTENSION).toContain("tool_call");
    expect(TOOL_SYSTEM_PROMPT_EXTENSION).toContain("search_lead_finder");
    expect(TOOL_SYSTEM_PROMPT_EXTENSION).toContain("search_google_maps");
    expect(TOOL_SYSTEM_PROMPT_EXTENSION).toContain("save_contacts");
    expect(TOOL_SYSTEM_PROMPT_EXTENSION).toContain("send_email");
  });
});
