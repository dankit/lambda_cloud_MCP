import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/** Merge project `.env` / `.env.local` (etc.) into `process.env` so tests see `POKE_API_KEY` like Next does. Shell vars win if already set. */
export default defineConfig(({ mode }) => {
  const cwd = process.cwd();
  const merged = {
    ...loadEnv("development", cwd, ""),
    ...loadEnv("test", cwd, ""),
    ...loadEnv(mode, cwd, ""),
  };
  for (const [key, val] of Object.entries(merged)) {
    if (process.env[key] === undefined && val !== "") {
      process.env[key] = val;
    }
  }

  return {
    test: {
      environment: "node",
      include: ["**/*.test.ts"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
