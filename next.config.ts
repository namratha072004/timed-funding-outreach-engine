import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["undici"],
  poweredByHeader: false,
};
export default config;
