import { api, json } from "@/lib/http";
import { passwordContext } from "@/services/password-access";
export const GET = api(async () => json(await passwordContext()));
