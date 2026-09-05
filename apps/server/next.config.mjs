/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The server is route handlers plus one health page; nothing is prerendered
  // from a database, so the build never needs DATABASE_URL.
  serverExternalPackages: ['postgres'],
};

export default nextConfig;
