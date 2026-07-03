import { describe, it, expect } from "vitest";
import { csvEscape, toCsv } from "./csv";

describe("csvEscape", () => {
  it("passes plain values through", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(42)).toBe("42");
    expect(csvEscape(true)).toBe("true");
  });

  it("renders null/undefined as empty", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("quotes cells containing commas", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
  });

  it("quotes and doubles embedded quotes", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes cells containing newlines", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("keeps CJK text unquoted", () => {
    expect(csvEscape("春季大促")).toBe("春季大促");
  });
});

describe("toCsv", () => {
  it("builds header + rows with CRLF and a UTF-8 BOM", () => {
    const csv = toCsv(["a", "b"], [[1, 2], ["x,y", 'q"z']]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const body = csv.slice(1);
    expect(body).toBe('a,b\r\n1,2\r\n"x,y","q""z"\r\n');
  });

  it("handles empty rows array", () => {
    const csv = toCsv(["only", "header"], []);
    expect(csv).toBe("\uFEFFonly,header\r\n");
  });
});
