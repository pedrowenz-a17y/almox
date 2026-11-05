import { spawnSync } from "node:child_process";
// A persistent Docker database for local development; credentials come from Compose .env.
const result = spawnSync("docker", ["compose", "--profile", "local-db", "up", "-d", "db"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
