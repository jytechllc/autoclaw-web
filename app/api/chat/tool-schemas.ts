/**
 * Structured tool schemas for native function calling (module B).
 *
 * These mirror the tools implemented in ./tools.ts (executeTool). They are sent
 * to the model as native Bedrock "tool use" definitions; when a non-Bedrock
 * provider handles the request, chatWithTools() flattens them into the legacy
 * text protocol automatically — so this list is the single source of truth.
 */

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const stringArray = { type: "array", items: { type: "string" } };

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "search_lead_finder",
    description:
      "Find people by job title, location, and industry. Best for 'find Sales Directors at European energy companies'. Already returns contacts.",
    input_schema: {
      type: "object",
      properties: {
        job_titles: stringArray,
        locations: stringArray,
        industries: stringArray,
      },
    },
  },
  {
    name: "search_google_maps",
    description:
      "Search for businesses/companies by category and location on Google Maps. Use to find companies, factories, stores, installers, or distributors in a place.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "e.g. 'solar panel manufacturers Germany'" },
        max_results: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_leads",
    description:
      "General-purpose lead/contact search by industry keywords and job titles. Returns companies and contacts.",
    input_schema: {
      type: "object",
      properties: {
        keywords: stringArray,
        job_titles: stringArray,
        industries: stringArray,
      },
    },
  },
  {
    name: "search_google",
    description: "Search Google for company/industry/market information and public research.",
    input_schema: {
      type: "object",
      properties: { queries: stringArray },
      required: ["queries"],
    },
  },
  {
    name: "crawl_website",
    description:
      "Crawl and extract content from a website (supports JS-rendered SPAs). Use to understand a specific company before searching for its customers.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "prospect_domain",
    description: "Find decision-maker contacts at a specific company domain (e.g. tesla.com).",
    input_schema: {
      type: "object",
      properties: { domain: { type: "string" } },
      required: ["domain"],
    },
  },
  {
    name: "prospect_multi",
    description: "Find contacts across multiple company domains at once.",
    input_schema: {
      type: "object",
      properties: { domains: stringArray },
      required: ["domains"],
    },
  },
  {
    name: "enrich_domains",
    description:
      "Enrich company domains with email patterns, contacts, and quality scores. Run after search_google_maps to turn companies into actionable leads.",
    input_schema: {
      type: "object",
      properties: { domains: stringArray },
      required: ["domains"],
    },
  },
  {
    name: "save_contacts",
    description:
      "Save search results to a specific project's contact list. Always include project_name; ask the user which project if unknown.",
    input_schema: {
      type: "object",
      properties: {
        project_name: { type: "string" },
        from_last_search: { type: "boolean" },
        emails: stringArray,
      },
    },
  },
  {
    name: "enrich_contacts",
    description: "Enrich existing project contacts with seniority, department, and industry insights.",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "number" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "send_email",
    description:
      "Send an email to one or more contacts via Brevo/SendGrid. Provide subject and body, or a template name. High-impact: only call when the user's intent to send is explicit.",
    input_schema: {
      type: "object",
      properties: {
        to: { description: "A single email string or an array of email strings." },
        subject: { type: "string" },
        body: { type: "string" },
        template: { type: "string" },
      },
      required: ["to"],
    },
  },
];
