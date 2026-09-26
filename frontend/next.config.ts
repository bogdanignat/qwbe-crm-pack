import type { NextConfig } from "next";

// Same trap as qwbe/web/next.config.mjs: Next dev only serves its chunks to hosts it knows.
// Opt LAN hosts in with QWBE_DEV_ORIGINS=192.168.1.154 (comma-separated).
const devOrigins = (process.env.QWBE_DEV_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// A build output directory chosen by the caller, used ONLY by the isolated UI
// fixture (e2e/ui/fixture.mjs): it builds and serves this app on an ephemeral
// port against mocked API answers, and must never write into `.next` -- that
// would clobber a running `next dev` or the output of `npm run build`. Unset in
// every normal build, where `.next` stays the default.
const distDir = (process.env.QWBE_DIST_DIR ?? "").trim();

// The tsconfig `next build` is allowed to REWRITE, used ONLY by the same fixture.
// Next adds its distDir's generated type globs to the tsconfig it is pointed at
// and reformats the file on the way out (lib/verify-typescript-setup.js:
// `resolvedTsConfigPath = join(dir, tsconfigPath || "tsconfig.json")`), so the
// fixture points it at a throwaway COPY. The tracked tsconfig.json is then never
// opened for writing at all: there is no snapshot to restore and no concurrent
// edit of it that a restore could clobber. Unset in every normal build, where
// `tsconfig.json` itself is the one Next configures.
const tsconfigPath = (process.env.QWBE_TSCONFIG ?? "").trim();

const nextConfig: NextConfig = {
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
  ...(distDir !== "" ? { distDir } : {}),
  ...(tsconfigPath !== "" ? { typescript: { tsconfigPath } } : {}),
};

export default nextConfig;
