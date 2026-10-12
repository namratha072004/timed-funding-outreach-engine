import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["undici"],
  poweredByHeader: false,
  // The Rubric now lives under Settings.
  redirects: async () => [{ source: "/rubric", destination: "/settings", permanent: false }],
};
export default config;
