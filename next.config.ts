import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  experimental: { useTypeScriptCli: false },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; connect-src 'self'" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
        ],
      },
      {
        source: "/auth/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};
export default config;
