import type { NextConfig } from "next";

if (process.env.VERCEL) {
  throw new Error(
    "This milestone is local-only. Configure authentication and storage before deployment.",
  );
}

const config: NextConfig = {
  distDir: ".next-life-os",
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};
export default config;
