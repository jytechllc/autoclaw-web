// Minimal CSV helpers — RFC 4180 escaping, Excel-friendly output.
// Kept dependency-free; used by client components for report exports.

export type CsvCell = string | number | boolean | null | undefined;

/** Escape one cell: quote when it contains a comma, quote, or newline. */
export function csvEscape(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  const s = String(cell);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build a CSV string. CRLF line endings + UTF-8 BOM so Excel opens it
 *  correctly (incl. CJK characters in campaign names). */
export function toCsv(headers: CsvCell[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** Trigger a client-side download. No-op outside the browser. */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
