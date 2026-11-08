/** Short-lived signed room tickets: proof of project membership for the realtime hub. */
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

export type RoomTicketClaims = { projectId: string; userId: string; name: string };

const DEFAULT_TTL_MS = 30_000;

function ticketKey(secret?: string): Uint8Array {
  return new TextEncoder().encode(secret ?? env("REALTIME_SECRET"));
}

export async function signRoomTicket(
  projectId: string,
  userId: string,
  name: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<string> {
  return new SignJWT({ projectId, name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(new Date(Date.now() + ttlMs))
    .sign(ticketKey());
}

export async function verifyRoomTicket(
  ticket: string,
  secret?: string
): Promise<RoomTicketClaims | null> {
  try {
    const { payload } = await jwtVerify(ticket, ticketKey(secret));
    const { projectId, sub, name } = payload;
    if (typeof projectId !== "string" || typeof sub !== "string" || typeof name !== "string") {
      return null;
    }
    return { projectId, userId: sub, name };
  } catch {
    return null;
  }
}
