import type { NextConfig } from "next";

// Mirrors the dev proxy that used to live in frontend-legacy/vite.config.js:
// the browser calls same-origin `/api/*`, Next.js strips the prefix and
// forwards to the FastAPI backend. In production, set NEXT_PUBLIC_API_URL
// and/or terminate this rewrite at your reverse proxy instead.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://127.0.0.1:5001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_ORIGIN}/:path*`,
      },
    ];
  },
  // Mirrors legacy's <Navigate replace to="/login" /> routes for these two
  // old paths (App.jsx lines 36-37).
  async redirects() {
    return [
      { source: "/login/student", destination: "/login", permanent: false },
      { source: "/login/teacher", destination: "/login", permanent: false },
    ];
  },
};

export default nextConfig;
