import { describe, it, expect } from "vitest";
import nextConfig from "../next.config";

describe("next config", () => {
  it("keeps ws out of the server bundle", () => {
    // Bundling ws makes webpack resolve the optional native bufferutil addon to
    // a stub without mask(), so every realtime publish frame throws and is
    // silently dropped. ws must be required from node_modules at runtime.
    expect(nextConfig.serverExternalPackages).toContain("ws");
  });
});
