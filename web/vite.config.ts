import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  build: {
    outDir: "../docs",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/onnxruntime-web")) {
            return "vendor-ort";
          }
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
});
