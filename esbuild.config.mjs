import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { fileURLToPath } from "url";
import path from "path";

const production = process.argv[2] === "production";
const pluginDir = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  banner: {
    js: "/* Vault Web Obsidian plugin */",
  },
  bundle: true,
  entryPoints: [path.join(pluginDir, "main.ts")],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  logLevel: "info",
  minify: production,
  outfile: path.join(pluginDir, "main.js"),
  platform: "node",
  sourcemap: production ? false : "inline",
  target: "es2022",
});
