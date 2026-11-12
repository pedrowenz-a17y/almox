import { requireUser, requireAnyUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import {
  createInventorySchedule,
  listInventorySchedules,
} from "@/services/inventory-schedules";

export const GET = api(async () =>
  json(await listInventorySchedules(await requireAnyUser(["inventory:count", "inventory:read"]))),
);
export const POST = api(async (request) =>
  json(
    await createInventorySchedule(
      await requireUser("inventory:adjust"),
      await request.json(),
    ),
    201,
  ),
);
