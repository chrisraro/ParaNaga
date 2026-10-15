import { parseCsv } from "./csv";

/** field_survey_template.csv is header-only; the columns are the survey import format. */
export function parseSurveyTemplate(csv: string): string[] {
  const [header, ...rest] = parseCsv(csv);
  if (!header || header.length === 0) throw new Error("Survey template: missing header row");
  if (rest.some((r) => r.some((c) => c !== ""))) {
    throw new Error("Survey template: unexpected data row (template must be header-only)");
  }
  if (new Set(header).size !== header.length) throw new Error("Survey template: duplicate column name");
  if (header.some((h) => h.trim() === "")) throw new Error("Survey template: empty column name");
  return header;
}
