// Story 2.4: CSV Member Import (FR-008) -- Task 2's CSV tokenizer.
//
// No CSV parsing library exists anywhere in this monorepo, and the import
// template is a fixed, well-defined 6-column shape -- an RFC4180-subset
// parser is enough for real-world Excel/Sheets exports without pulling in a
// dependency. Pure function, no I/O: does not itself validate column names
// or row count (that's mapCsvRows/validateCsvImport's job).
export function parseCsvRows(rawText: string): string[][] {
  // Excel commonly prefixes a saved CSV with a UTF-8 BOM -- left in place,
  // it attaches to the first header cell (e.g. "﻿member_name") and
  // fails the exact-name column match on an otherwise-valid template.
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < len) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // \r\n line endings: skip the \r, the following \n (if any) ends the
      // row on the next iteration.
      i += 1;
      continue;
    }
    if (char === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  // A trailing "\n" at end-of-file already closed the last row above --
  // only emit one more row here if there's genuinely pending content
  // (no trailing newline, or a final unterminated field).
  if (field !== "" || row.length > 0) {
    pushRow();
  }

  return rows;
}
