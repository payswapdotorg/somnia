import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ["*.space-z.ai"],
  // Phase 2: prisma client regenerated (Job.endFramePath/board, Generation.videoPath)
  // triggers a dev server restart so the fresh client is loaded.
  // Phase 3: prisma client regenerated (Job.parentJobId/editInstruction, Asset.label/variantKey).
  // Phase 6 (serverless runtime layer):
  //   - afterFiles rewrite: /generated/* falls through to /api/media/* when no
  //     static file matches. Locally the static files exist and are served
  //     directly (byte-for-byte the old behavior); on serverless, runtime-
  //     written media streams from the writable scratch dir with Range support.
  //   - outputFileTracingIncludes: the ffmpeg-static binary must travel
  //     with the serverless bundle — it is a plain file the tracer cannot
  //     see. (The Phase 6 SQLite seed.db include is gone with T10's Postgres
  //     migration — the durable schema now lives on Neon.)
  //   - serverExternalPackages: keep Prisma's query engine AND the ffmpeg-static
  //     binary package external so they are required natively at runtime —
  //     bundling ffmpeg-static virtualizes __dirname and breaks its internal
  //     binary resolution (binary lives in the traced node_modules tree).
  async rewrites() {
    return {
      afterFiles: [
        {
          source: "/generated/:path*",
          destination: "/api/media/:path*",
        },
      ],
    };
  },
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/ffmpeg-static/**"],
  },
  serverExternalPackages: ["@prisma/client", "prisma", "ffmpeg-static"],
};

export default nextConfig;
