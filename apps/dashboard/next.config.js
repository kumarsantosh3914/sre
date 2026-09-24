/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image.
  output: 'standalone',
  poweredByHeader: false,
};

module.exports = nextConfig;
