/** Pure session primitives: password hashing and JWT sign/verify. No request context. */
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "./session-cookie";

export { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS };

const BCRYPT_ROUNDS = 10;

// Unambiguous alphabet: no i/l/o (lowercase), no I/L/O (uppercase), no 0/1.
const TEMP_PASSWORD_ALPHABET =
  "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TEMP_PASSWORD_LENGTH = 16;

export function generateTempPassword(): string {
  let password = "";
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    password += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return password;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

function sessionKey(): Uint8Array {
  return new TextEncoder().encode(env("JWT_SECRET"));
}

export async function signSessionToken(
  sub: string,
  expiresAt: Date = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(sessionKey());
}

export async function verifySessionToken(
  token: string
): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey());
    return typeof payload.sub === "string" ? { sub: payload.sub } : null;
  } catch {
    return null;
  }
}
