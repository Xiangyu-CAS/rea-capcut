import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
export default defineConfig(({ command }) => ({
  plugins: [
    {
      name: "reacut-csp",
      transformIndexHtml: (html: string) =>
        command === "build"
          ? html.replace(
              "<head>",
              "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: reacut-media:; media-src 'self' blob: reacut-media:; connect-src 'self' reacut-media:; object-src 'none'; base-uri 'self'; form-action 'none'\">",
            )
          : html,
    },
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            lib: false,
            rollupOptions: {
              input: "electron/main.ts",
              output: { format: "cjs", entryFileNames: "main.cjs" },
              external: ["electron", "@napi-rs/canvas"],
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              output: { format: "cjs", entryFileNames: "preload.cjs" },
            },
          },
        },
      },
    }),
  ],
  base: "./",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
}));
