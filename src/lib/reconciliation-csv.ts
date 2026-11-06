/** Strict CSV reader: escaped quotes and quoted line breaks, no guessed delimiter. */
export function readReconciliationCsv(csv: string, delimiter: ";" | ",") {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  const source = csv.replace(/^\uFEFF/, "");
  const pushField = () => {
    row.push(field.trim());
    field = "";
    closedQuote = false;
  };
  const pushRow = () => {
    pushField();
    if (row.some((cell) => cell !== "")) rows.push(row);
    row = [];
    if (rows.length > 1001)
      throw new Error("O arquivo deve conter no máximo 1.000 linhas de dados.");
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else field += char;
    } else if (char === delimiter) pushField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      pushRow();
    } else if (char === '"') {
      if (field || closedQuote)
        throw new Error(
          "Aspas inválidas no CSV. Use aspas em volta do campo completo.",
        );
      quoted = true;
    } else if (closedQuote) {
      if (char !== " " && char !== "\t")
        throw new Error("Há conteúdo depois do fechamento de aspas no CSV.");
    } else field += char;
    if (row.length > 8 || field.length > 4000)
      throw new Error(
        "Campo ou quantidade de colunas acima do limite do modelo CSV.",
      );
  }
  if (quoted) throw new Error("O CSV contém um campo com aspas não fechadas.");
  if (field || row.length || closedQuote) pushRow();
  return rows;
}

/** Spreadsheet exports must not turn labels/codes into executable formulas. */
export function safeCsvCell(value: string) {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
