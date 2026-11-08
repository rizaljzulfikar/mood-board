import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `ws` must stay a runtime dependency. Bundling it makes webpack resolve the
  // optional native `bufferutil` addon to a stub without `mask()`, so the
  // publisher socket crashes on every frame while broadcasting is silently
  // best-effort. Keeping it external lets ws fall back to its JS masker.
  serverExternalPackages: ["ws"],
};

export default nextConfig;
