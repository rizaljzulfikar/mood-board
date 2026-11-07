import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  verifySessionToken,
} from "@/lib/session";

describe("password hashing", () => {
  it("round-trips a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("secret123");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips a token to its subject", async () => {
    const token = await signSessionToken("507f1f77bcf86cd799439011");
    const payload = await verifySessionToken(token);
    expect(payload?.sub).toBe("507f1f77bcf86cd799439011");
  });

  it("rejects garbage tokens", async () => {
    expect(await verifySessionToken("not-a-jwt")).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const token = await signSessionToken(
      "507f1f77bcf86cd799439011",
      new Date(Date.now() - 1000)
    );
    expect(await verifySessionToken(token)).toBeNull();
  });
});
