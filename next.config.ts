import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["yahoo-finance2", "googleapis"],
  // Development only. The indicator defaults to bottom-left, which is where
  // the theme selector lives, and it sat on top of the System button.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
