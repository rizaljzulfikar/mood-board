import { endSession } from "@/lib/auth";
import { apiError, json } from "@/lib/api";

export const runtime = "nodejs";

export async function POST() {
  try {
    await endSession();
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
