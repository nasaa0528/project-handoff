import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": here("./src"),
      // `@handoff/schema` hashes with node:crypto, which the browser does not
      // have. The app hashes through src/sign/notes.ts over Web Crypto, and
      // this shim makes any other call fail loudly instead of bundling a Node
      // built-in. It stays on under test as well, so a stray call from app
      // code fails in CI rather than only in a browser; notes.test.ts takes
      // its reference digest from Node's own "crypto" module instead.
      "node:crypto": here("./src/shims/node-crypto.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
