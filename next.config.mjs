/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // In development the Python research function runs as a local server (python -m finn.server).
  // On Vercel, /api/research.py is deployed as a serverless function and no rewrite applies.
  async rewrites() {
    return process.env.NODE_ENV === "development"
      ? [{ source: "/api/research", destination: "http://127.0.0.1:8787/api/research" }]
      : [];
  },
};
export default config;
