/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: ['10.179.32.203', '127.0.0.1'],
  reactStrictMode: true,
};

module.exports = nextConfig;
