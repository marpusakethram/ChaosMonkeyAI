/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL || "http://127.0.0.1:8000";

const nextConfig = {
  output: "standalone",
  async rewrites() {
    // The browser only ever talks to this origin; the API stays on the private network.
    return [{ source: "/api/v1/:path*", destination: `${API_URL}/api/v1/:path*` }];
  },
};

export default nextConfig;
