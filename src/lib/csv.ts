function escape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export type CSVColumn<T> = { key: keyof T; header: string };

export function toCSV<T extends Record<string, unknown>>(
  rows: T[],
  columns: CSVColumn<T>[],
): string {
  const head = columns.map((c) => escape(c.header)).join(",");
  const body = rows
    .map((r) => columns.map((c) => escape(r[c.key])).join(","))
    .join("\n");
  return `${head}\n${body}\n`;
}

/** Linha de cabeçalho (sem newline final). */
export function csvHeaderLine<T>(columns: CSVColumn<T>[]): string {
  return columns.map((c) => escape(c.header)).join(",");
}

/** Uma linha CSV (sem newline final). */
export function csvRow<T extends Record<string, unknown>>(
  row: T,
  columns: CSVColumn<T>[],
): string {
  return columns.map((c) => escape(row[c.key])).join(",");
}
