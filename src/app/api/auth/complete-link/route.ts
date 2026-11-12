import { api, json } from "@/lib/http";
import { completeImplicitLink } from "@/services/password-access";
export const maxDuration = 60;
export const POST = api(async request => json(await completeImplicitLink(await request.json())));
