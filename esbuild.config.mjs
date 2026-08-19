import esbuild from "esbuild";
import fs from "fs/promises";
import process from "process";
import { builtinModules } from "module";
import { fileURLToPath } from "url";
import path from "path";

const production = process.argv[2] === "production";
const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const nodeBuiltins = [...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)];
const bundledFiles = [
  "vault-web/app.js",
  "vault-web/assets/obsidian-logo.svg",
  "vault-web/index.html",
  "vault-web/main.js",
  "vault-web/server.js",
  "vault-web/styles.css",
  "vault-web/vendor/mermaid.min.js",
];

await fs.mkdir(path.join(pluginDir, "vault-web", "vendor"), { recursive: true });
await fs.copyFile(
  path.join(pluginDir, "node_modules", "mermaid", "dist", "mermaid.min.js"),
  path.join(pluginDir, "vault-web", "vendor", "mermaid.min.js"),
);
await fs.writeFile(
  path.join(pluginDir, "generated-assets.ts"),
  [
    "export const BUNDLED_WEB_APP_FILES = [",
    ...(await Promise.all(
      bundledFiles.map(async (file) => {
        const data = await fs.readFile(path.join(pluginDir, file));
        return `  { path: ${JSON.stringify(file)}, base64: ${JSON.stringify(data.toString("base64"))} },`;
      }),
    )),
    "] as const;",
    "",
  ].join("\n"),
);

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
    ...nodeBuiltins,
  ],
  format: "cjs",
  logLevel: "info",
  minify: production,
  outfile: path.join(pluginDir, "main.js"),
  platform: "node",
  sourcemap: production ? false : "inline",
  target: "es2022",
});
