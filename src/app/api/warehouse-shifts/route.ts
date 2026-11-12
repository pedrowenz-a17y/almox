import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { actOnWarehouseShift, listWarehouseShifts } from "@/services/warehouse-shifts";

export const GET = api(async request => json(await listWarehouseShifts(await requireUser(), request.nextUrl.searchParams.get("warehouseId") ?? "")));
export const POST = api(async request => json(await actOnWarehouseShift(await requireUser(), await request.json())));
