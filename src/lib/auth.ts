/** Request-context auth helpers (cookies via next/headers). Pure crypto lives in session.ts. */
import { cookies } from "next/headers";
import { connectDB } from "./db";
import { User } from "./models/User";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSessionToken,
  verifySessionToken,
} from "./session";

export type SessionUser = { id: string; email: string; name: string };

export async function startSession(userId: string): Promise<void> {
  const token = await signSessionToken(userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    // Local self-hosted app served over plain HTTP; do not mark Secure.
    secure: false,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  await connectDB();
  const user = await User.findById(payload.sub);
  if (!user) return null;
  return { id: String(user._id), email: user.email, name: user.name };
}
