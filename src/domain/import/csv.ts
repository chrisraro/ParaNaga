/** Minimal RFC 4180 CSV reader: quoted fields, escaped quotes, CRLF/LF, embedded newlines, BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let line = 1;
  // true once the current record has seen any character (so a trailing newline adds no empty row)
  let started = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' && field === "") {
      // opening quote of a quoted field
      started = true;
      i++;
      let closed = false;
      while (i < text.length) {
        const c = text[i]!;
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        if (c === "\n") line++;
        field += c;
        i++;
      }
      if (!closed) throw new Error(`CSV: unterminated quoted field starting before line ${line}`);
      const next = text[i];
      if (next !== undefined && next !== "," && next !== "\n" && next !== "\r") {
        throw new Error(`CSV: unexpected character after closing quote on line ${line}`);
      }
      continue;
    }
    if (ch === '"') throw new Error(`CSV: stray quote inside an unquoted field on line ${line}`);
    if (ch === ",") {
      started = true;
      endField();
      i++;
      continue;
    }
    if (ch === "\r" && text[i + 1] === "\n") {
      endRow();
      line++;
      i += 2;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      endRow();
      line++;
      i++;
      continue;
    }
    started = true;
    field += ch;
    i++;
  }
  if (started || field !== "" || row.length > 0) endRow();
  return rows;
}

export type CsvTable = { header: string[]; rows: Record<string, string>[] };

export function parseCsvObjects(input: string): CsvTable {
  const [header, ...body] = parseCsv(input);
  if (!header) throw new Error("CSV: empty file");
  if (new Set(header).size !== header.length) throw new Error("CSV: duplicate header column");
  const rows = body.map((cells, idx) => {
    if (cells.length !== header.length) {
      throw new Error(`CSV: row ${idx + 2} has ${cells.length} fields, expected ${header.length}`);
    }
    return Object.fromEntries(header.map((h, k) => [h, cells[k]!]));
  });
  return { header, rows };
}
