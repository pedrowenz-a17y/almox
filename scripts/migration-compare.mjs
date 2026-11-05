import { readFile } from "node:fs/promises";

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error("Uso: node scripts/migration-compare.mjs snapshot-origem.json snapshot-destino.json");
  process.exit(1);
}
try {
  const [before, after] = await Promise.all([source, target].map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  if (before.format !== "almox-migration-snapshot-v1" || after.format !== before.format) throw new Error("Invalid format");
  const differences = [];
  for (const table of new Set([...Object.keys(before.tables), ...Object.keys(after.tables)])) {
    const a = before.tables[table]; const b = after.tables[table];
    if (JSON.stringify(a) !== JSON.stringify(b)) differences.push(`Tabela ${table}: contagem, campos ou impressão digital divergente.`);
  }
  if (JSON.stringify(before.balances) !== JSON.stringify(after.balances)) differences.push("Saldos por produto/localização divergentes.");
  if (differences.length) {
    differences.forEach((message) => console.error(message));
    console.error("Comparação reprovada. Não efetive a troca do banco até explicar e aprovar cada divergência.");
    process.exitCode = 2;
  } else console.log("Comparação aprovada: registros operacionais comparados e saldos por produto/localização preservados.");
} catch {
  console.error("Não foi possível comparar os snapshots. Confira os caminhos e o formato dos arquivos.");
  process.exitCode = 1;
}
