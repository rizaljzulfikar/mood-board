import { describe, it, expect } from "vitest";
import { User } from "@/lib/models/User";

describe("User schema defaults", () => {
  it("defaults role to user and mustChangePassword to false", () => {
    const user = new User({ email: "a@b.co", name: "A", passwordHash: "x" });
    expect(user.role).toBe("user");
    expect(user.mustChangePassword).toBe(false);
  });
});
