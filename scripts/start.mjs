import { cp, access } from "node:fs/promises";
import { spawn } from "node:child_process";
await access(".next/standalone/server.js").catch(() => {
  throw new Error("Execute npm run build antes de iniciar a aplicação.");
});
await cp("public", ".next/standalone/public", { recursive: true });
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: process.env.APP_BIND || "0.0.0.0",
  },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.kill(signal));
server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
