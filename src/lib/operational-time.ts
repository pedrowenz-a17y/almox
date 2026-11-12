/** The ERP displays operational timestamps in São Paulo, regardless of device zone. */
const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function operationalDateInput(iso: string | null) {
  if (!iso || !Number.isFinite(new Date(iso).getTime())) return "";
  const parts = Object.fromEntries(formatter.formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Convert the stated wall clock using IANA rules, without using the device zone. */
export function operationalDateISO(input: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return null;
  const wall = Date.parse(`${input}:00Z`);
  if (!Number.isFinite(wall)) return null;
  let candidate = wall;
  for (let attempt = 0; attempt < 3; attempt++) {
    const represented = operationalDateInput(new Date(candidate).toISOString());
    const delta = wall - Date.parse(`${represented}:00Z`);
    if (!delta) break;
    candidate += delta;
  }
  const result = new Date(candidate).toISOString();
  return operationalDateInput(result) === input ? result : null;
}
