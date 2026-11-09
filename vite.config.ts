import { qwikVite } from "@qwik.dev/core/optimizer";
import { defineConfig } from "vite";

// Client-only (CSR) app: index.html -> src/main.tsx, which calls render() several times.
export default defineConfig({
  plugins: [qwikVite({ csr: true })],
});
