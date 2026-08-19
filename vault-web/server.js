const http = require("http");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const VAULT_ROOT =
  process.env.VAULT_ROOT || "C:\\Users\\Миша\\Мой диск\\Zettelkasten";
const PORT = Number(process.env.PORT || 4177);
const HOST = "127.0.0.1";
const APP_DIR = __dirname;
const ACCESS_TOKEN = process.env.VAULT_WEB_TOKEN || crypto.randomBytes(32).toString("hex");
const BASE_ORIGIN = `http://${HOST}:${PORT}`;
const HIDDEN_DIRS = new Set([
  ".git",
  ".obsidian",
  "node_modules",
  ".trash",
  ".tmp.drivedownload",
  ".tmp.driveupload",
]);

function send(res, status, body, type = "application/json; charset=utf-8") {
  const payload =
    typeof body === "string" || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body);
  const length = Buffer.isBuffer(payload)
    ? payload.length
    : Buffer.byteLength(payload, "utf8");
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Length": length,
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === BASE_ORIGIN;
}

function authorized(req, url) {
  const header = req.headers["x-vault-web-token"];
  const query = url.searchParams.get("token");
  const token = Array.isArray(header) ? header[0] : header || query;
  return token === ACCESS_TOKEN;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 5_000_000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function vaultPath(relPath = "") {
  const normalized = path
    .normalize(String(relPath).replace(/\\/g, "/"))
    .replace(/^(\.\.[/\\])+/, "");
  const absolute = path.resolve(VAULT_ROOT, normalized);
  const root = path.resolve(VAULT_ROOT);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error("Path escapes vault root");
  }
  return absolute;
}

function toVaultRelative(absPath) {
  return path.relative(VAULT_ROOT, absPath).replace(/\\/g, "/");
}

function noteTitleFromPath(filePath) {
  return path.basename(filePath).replace(/\.md$/i, "");
}

function normalizeWikiTarget(target) {
  return String(target || "")
    .split("|")[0]
    .split("#")[0]
    .trim()
    .replace(/\.md$/i, "");
}

function extractWikiLinks(content) {
  const links = [];
  const seen = new Set();
  const re = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = re.exec(content))) {
    const target = normalizeWikiTarget(match[1]);
    if (!target || seen.has(target.toLowerCase())) continue;
    seen.add(target.toLowerCase());
    links.push(target);
  }
  return links;
}

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && HIDDEN_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!HIDDEN_DIRS.has(entry.name)) await walk(abs, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const stat = await fs.stat(abs);
    out.push({
      path: toVaultRelative(abs),
      name: entry.name.replace(/\.md$/i, ""),
      modified: stat.mtimeMs,
      size: stat.size,
    });
  }
  return out;
}

async function findMarkdownByTitle(title) {
  const wanted = title.replace(/\.md$/i, "").toLowerCase();
  const files = await walk(VAULT_ROOT);
  return files.find((file) => file.name.toLowerCase() === wanted);
}

async function linkGraphFor(relPath) {
  const files = await walk(VAULT_ROOT);
  const byTitle = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  const currentTitle = noteTitleFromPath(relPath).toLowerCase();
  const currentContent = await fs.readFile(vaultPath(relPath), "utf8");
  const outgoing = extractWikiLinks(currentContent).map((target) => {
    const note = byTitle.get(target.toLowerCase());
    return note || { name: target, path: "", missing: true };
  });

  const backlinks = [];
  for (const file of files) {
    if (file.path === relPath) continue;
    const content = await fs.readFile(vaultPath(file.path), "utf8");
    const links = extractWikiLinks(content).map((link) => link.toLowerCase());
    if (links.includes(currentTitle)) backlinks.push(file);
  }
  backlinks.sort((a, b) => b.modified - a.modified);
  return { outgoing, backlinks };
}

function obsidianUrlFor(relPath) {
  const vault = path.basename(path.resolve(VAULT_ROOT));
  const file = relPath.replace(/\\/g, "/");
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
}

async function api(req, res, url) {
  if (!sameOrigin(req)) {
    return send(res, 403, { error: "Forbidden origin" });
  }
  if (!authorized(req, url)) {
    return send(res, 401, { error: "Unauthorized" });
  }

  if (url.pathname === "/api/notes" && req.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const files = await walk(VAULT_ROOT);
    const filtered = q
      ? files.filter((file) => file.path.toLowerCase().includes(q))
      : files;
    filtered.sort((a, b) => b.modified - a.modified);
    return send(res, 200, filtered.slice(0, 500));
  }

  if (url.pathname === "/api/status" && req.method === "GET") {
    return send(res, 200, {
      ok: true,
      vaultRoot: VAULT_ROOT,
      appDir: APP_DIR,
    });
  }

  if (url.pathname === "/api/note" && req.method === "GET") {
    const rel = url.searchParams.get("path");
    if (!rel || !rel.endsWith(".md")) return send(res, 400, { error: "Bad path" });
    const content = await fs.readFile(vaultPath(rel), "utf8");
    return send(res, 200, { path: rel, content });
  }

  if (url.pathname === "/api/note" && req.method === "PUT") {
    const body = await parseBody(req);
    if (!body.path || !body.path.endsWith(".md")) {
      return send(res, 400, { error: "Bad path" });
    }
    await fs.writeFile(vaultPath(body.path), String(body.content || ""), "utf8");
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/api/note" && req.method === "POST") {
    const body = await parseBody(req);
    const rawTitle = String(body.title || "").trim();
    if (!rawTitle) return send(res, 400, { error: "Title is required" });
    const safeTitle = rawTitle.replace(/[<>:"/\\|?*]/g, "-");
    const folder = String(body.folder || "Base").replace(/\\/g, "/");
    const rel = `${folder}/${safeTitle}.md`;
    const abs = vaultPath(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const template = [
      "---",
      "type: concept-note",
      "inbox_status:",
      "  - Входящие",
      "---",
      "",
      `# ${rawTitle}`,
      "",
    ].join("\n");
    await fs.writeFile(abs, template, { encoding: "utf8", flag: "wx" });
    return send(res, 201, { path: rel, content: template });
  }

  if (url.pathname === "/api/resolve" && req.method === "GET") {
    const title = url.searchParams.get("title") || "";
    const sectionless = title.split("#")[0].split("|")[0].trim();
    const file = await findMarkdownByTitle(sectionless);
    return file ? send(res, 200, file) : send(res, 404, { error: "Not found" });
  }

  if (url.pathname === "/api/links" && req.method === "GET") {
    const rel = url.searchParams.get("path");
    if (!rel || !rel.endsWith(".md")) return send(res, 400, { error: "Bad path" });
    return send(res, 200, await linkGraphFor(rel));
  }

  if (url.pathname === "/api/obsidian-url" && req.method === "GET") {
    const rel = url.searchParams.get("path");
    if (!rel || !rel.endsWith(".md")) return send(res, 400, { error: "Bad path" });
    return send(res, 200, { url: obsidianUrlFor(rel) });
  }

  return false;
}

async function staticFile(req, res, url) {
  if (!sameOrigin(req)) {
    return send(res, 403, "Forbidden origin", "text/plain; charset=utf-8");
  }
  let rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  rel = rel.replace(/^\/+/, "");
  const abs = path.resolve(APP_DIR, rel);
  if (abs !== APP_DIR && !abs.startsWith(APP_DIR + path.sep)) {
    return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  }
  if (rel === "index.html") {
    const [html, css, js] = await Promise.all([
      fs.readFile(path.join(APP_DIR, "index.html"), "utf8"),
      fs.readFile(path.join(APP_DIR, "styles.css"), "utf8"),
      fs.readFile(path.join(APP_DIR, "app.js"), "utf8"),
    ]);
    const inline = html
      .replace('<link rel="stylesheet" href="/styles.css" />', `<style>${css}</style>`)
      .replace('<script defer src="/main.js"></script>', `<script>window.__VAULT_WEB_TOKEN__=${JSON.stringify(ACCESS_TOKEN)};</script><script>${js}</script>`);
    return send(res, 200, inline, "text/html; charset=utf-8");
  }
  const ext = path.extname(abs).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
  };
  try {
    const data = await fs.readFile(abs);
    send(res, 200, data, types[ext] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${HOST}:${PORT}`);
      if (req.method === "OPTIONS") {
        if (sameOrigin(req)) {
          send(res, 204, "", "text/plain; charset=utf-8");
        } else {
          send(res, 403, "Forbidden origin", "text/plain; charset=utf-8");
        }
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const handled = await api(req, res, url);
        if (handled === false) send(res, 404, { error: "Not found" });
        return;
      }
      await staticFile(req, res, url);
    } catch (error) {
      send(res, 500, { error: error.message });
    }
  })
  .listen(PORT, HOST, () => {
    console.log(`Vault Web: http://${HOST}:${PORT}`);
    console.log(`Vault root: ${VAULT_ROOT}`);
  });
