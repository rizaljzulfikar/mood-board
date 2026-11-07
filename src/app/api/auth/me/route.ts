import { apiError, json, requireUser } from "@/lib/api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return json({ user });
  } catch (e) {
    return apiError(e);
  }
}
