import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { accessEmailSetup } from "@/services/access-emails";
export const GET = api(async () => json(await accessEmailSetup(await requireUser("users:manage"))));
