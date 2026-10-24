import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // native addon / WASM loaders must stay outside the bundle (remote MCP endpoint)
  serverExternalPackages: ["@resvg/resvg-js"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
