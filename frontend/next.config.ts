import type { NextConfig } from "next";

// Development only: `next dev` has no reverse proxy in front of it, so the
// browser's same-origin `/api/*` calls are forwarded to the FastAPI backend
// here. In production the Caddy proxy routes `/api/*` to the API containers
// itself (the Next.js image never talks to the browser's `/api` path), so no
// rewrite is emitted into the production build.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://127.0.0.1:5001";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return [{ source: "/api/:path*", destination: `${BACKEND_ORIGIN}/:path*` }];
  },
  async redirects() {
    return [
      { source: "/login/student", destination: "/login", permanent: false },
      { source: "/login/teacher", destination: "/login", permanent: false },
    ];
  },
};

export default nextConfig;
