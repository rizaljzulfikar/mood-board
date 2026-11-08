import { describe, it, expect } from "vitest";
import { generateTempPassword } from "@/lib/session";

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

describe("generateTempPassword", () => {
  it("returns a 16-character password", () => {
    expect(generateTempPassword()).toHaveLength(16);
  });

  it("uses only unambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      const password = generateTempPassword();
      for (const ch of password) {
        expect(ALPHABET, `unexpected character: ${ch}`).toContain(ch);
      }
    }
  });

  it("generates different passwords across calls", () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      if (generateTempPassword() !== generateTempPassword()) return;
    }
    throw new Error("generateTempPassword produced identical passwords 10 times in a row");
  });
});
