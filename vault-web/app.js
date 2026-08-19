const state = {
  notes: [],
  currentPath: "",
  dirty: false,
  mode: localStorage.getItem("vault-web-mode") || "edit",
  theme: localStorage.getItem("vault-web-theme") || "dark",
  saveTimer: 0,
};

const els = {
  list: document.querySelector("#noteList"),
  search: document.querySelector("#searchInput"),
  editor: document.querySelector("#editor"),
  preview: document.querySelector("#preview"),
  title: document.querySelector("#noteTitle"),
  path: document.querySelector("#notePath"),
  modeToggle: document.querySelector("#modeToggleButton"),
  themeToggle: document.querySelector("#themeToggleButton"),
  toggleSidebar: document.querySelector("#toggleSidebarButton"),
  toggleLinks: document.querySelector("#toggleLinksButton"),
  sidebarResize: document.querySelector("#sidebarResizeHandle"),
  linksResize: document.querySelector("#linksResizeHandle"),
  openObsidian: document.querySelector("#openObsidianButton"),
  saveStatus: document.querySelector("#saveStatus"),
  outgoingLinks: document.querySelector("#outgoingLinks"),
  backlinks: document.querySelector("#backlinks"),
  wikiSuggest: document.querySelector("#wikiSuggest"),
  newNoteButton: document.querySelector("#newNoteButton"),
  dialog: document.querySelector("#newNoteDialog"),
  newNoteForm: document.querySelector("#newNoteForm"),
  newNoteTitle: document.querySelector("#newNoteTitle"),
  newNoteFolder: document.querySelector("#newNoteFolder"),
};

const suggest = {
  items: [],
  active: 0,
  range: null,
};

const urlToken = new URLSearchParams(window.location.search).get("token");
const injectedToken = window.__VAULT_WEB_TOKEN__ || "";
const authToken = injectedToken || urlToken || sessionStorage.getItem("vault-web-token") || "";
if (authToken) sessionStorage.setItem("vault-web-token", authToken);

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem("vault-web-sidebar-collapsed", collapsed ? "1" : "0");
  els.toggleSidebar.textContent = collapsed ? "›" : "‹";
  els.toggleSidebar.title = collapsed ? "Показать список заметок" : "Скрыть список заметок";
  els.toggleSidebar.setAttribute("aria-label", els.toggleSidebar.title);
}

function setLinksCollapsed(collapsed) {
  document.body.classList.toggle("links-collapsed", collapsed);
  localStorage.setItem("vault-web-links-collapsed", collapsed ? "1" : "0");
  els.toggleLinks.textContent = collapsed ? "⌃" : "⌄";
  els.toggleLinks.title = collapsed ? "Показать панель ссылок" : "Скрыть панель ссылок";
  els.toggleLinks.setAttribute("aria-label", els.toggleLinks.title);
}

function setTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.body.classList.toggle("theme-light", state.theme === "light");
  document.body.classList.toggle("theme-dark", state.theme === "dark");
  localStorage.setItem("vault-web-theme", state.theme);
  const light = state.theme === "light";
  els.themeToggle.textContent = light ? "☀" : "☾";
  els.themeToggle.title = light ? "Переключиться на темную тему" : "Переключиться на светлую тему";
  els.themeToggle.setAttribute("aria-label", els.themeToggle.title);
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function setSidebarWidth(width) {
  const next = clamp(width, 220, Math.min(560, Math.round(window.innerWidth * 0.45)));
  document.documentElement.style.setProperty("--sidebar-width", `${next}px`);
  localStorage.setItem("vault-web-sidebar-width", String(next));
}

function setLinksHeight(height) {
  const next = clamp(height, 86, Math.min(420, Math.round(window.innerHeight * 0.45)));
  document.documentElement.style.setProperty("--links-height", `${next}px`);
  localStorage.setItem("vault-web-links-height", String(next));
}

function restorePanelSizes() {
  const sidebarWidth = Number(localStorage.getItem("vault-web-sidebar-width"));
  const linksHeight = Number(localStorage.getItem("vault-web-links-height"));
  if (Number.isFinite(sidebarWidth) && sidebarWidth > 0) setSidebarWidth(sidebarWidth);
  if (Number.isFinite(linksHeight) && linksHeight > 0) setLinksHeight(linksHeight);
}

function bindResizeHandles() {
  els.sidebarResize.addEventListener("pointerdown", (event) => {
    if (document.body.classList.contains("sidebar-collapsed")) return;
    event.preventDefault();
    els.sidebarResize.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing");

    const onMove = (moveEvent) => setSidebarWidth(moveEvent.clientX);
    const onDone = () => {
      document.body.classList.remove("resizing");
      els.sidebarResize.removeEventListener("pointermove", onMove);
      els.sidebarResize.removeEventListener("pointerup", onDone);
      els.sidebarResize.removeEventListener("pointercancel", onDone);
    };

    els.sidebarResize.addEventListener("pointermove", onMove);
    els.sidebarResize.addEventListener("pointerup", onDone);
    els.sidebarResize.addEventListener("pointercancel", onDone);
  });

  els.linksResize.addEventListener("pointerdown", (event) => {
    if (document.body.classList.contains("links-collapsed")) return;
    event.preventDefault();
    els.linksResize.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-links");

    const onMove = (moveEvent) => setLinksHeight(window.innerHeight - moveEvent.clientY);
    const onDone = () => {
      document.body.classList.remove("resizing-links");
      els.linksResize.removeEventListener("pointermove", onMove);
      els.linksResize.removeEventListener("pointerup", onDone);
      els.linksResize.removeEventListener("pointercancel", onDone);
    };

    els.linksResize.addEventListener("pointermove", onMove);
    els.linksResize.addEventListener("pointerup", onDone);
    els.linksResize.addEventListener("pointercancel", onDone);
  });
}

async function request(url, options) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Vault-Web-Token": authToken,
    },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

function basename(filePath) {
  return filePath.split("/").pop().replace(/\.md$/i, "");
}

function setSaveStatus(text, kind = "") {
  els.saveStatus.textContent = "";
  els.saveStatus.className = `save-status ${kind}`.trim();
  els.saveStatus.title = text;
  els.saveStatus.setAttribute("aria-label", text);
}

function renderList() {
  const active = state.currentPath;
  els.list.innerHTML = "";
  for (const note of state.notes) {
    const button = document.createElement("button");
    button.className = `note-item${note.path === active ? " active" : ""}`;
    button.innerHTML = `<div class="item-name"></div><div class="item-path"></div>`;
    button.querySelector(".item-name").textContent = note.name;
    button.querySelector(".item-path").textContent = note.path;
    button.addEventListener("click", () => openNote(note.path));
    els.list.append(button);
  }
}

async function loadNotes() {
  const q = encodeURIComponent(els.search.value.trim());
  state.notes = await request(`/api/notes?q=${q}`);
  renderList();
}

async function openNote(path) {
  if (state.dirty) await saveNote();
  const note = await request(`/api/note?path=${encodeURIComponent(path)}`);
  state.currentPath = note.path;
  state.dirty = false;
  els.editor.value = note.content;
  els.title.textContent = basename(note.path);
  els.path.textContent = note.path;
  setSaveStatus("Saved", "saved");
  setMode(state.mode);
  renderList();
  loadLinks();
}

async function saveNote() {
  if (!state.currentPath) return;
  setSaveStatus("Saving...", "saving");
  try {
    await request("/api/note", {
      method: "PUT",
      body: JSON.stringify({
        path: state.currentPath,
        content: els.editor.value,
      }),
    });
    state.dirty = false;
    els.path.textContent = state.currentPath;
    setSaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, "saved");
    window.clearTimeout(state.saveTimer);
    loadLinks();
  } catch (error) {
    setSaveStatus(`Save failed: ${error.message}`, "error");
    throw error;
  }
}

function scheduleSave() {
  state.dirty = true;
  setSaveStatus("Unsaved changes", "error");
  updateWikiSuggest();
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(saveNote, 900);
}

function renderLinkList(container, items, emptyText) {
  container.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "link-empty";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  for (const item of items) {
    const button = document.createElement("button");
    button.className = "link-item";
    button.disabled = item.missing || !item.path;
    button.innerHTML = `<div class="item-name"></div><div class="item-path"></div>`;
    button.querySelector(".item-name").textContent = item.missing ? `${item.name} (missing)` : item.name;
    button.querySelector(".item-path").textContent = item.path || "not found";
    if (!item.missing && item.path) button.addEventListener("click", () => openNote(item.path));
    container.append(button);
  }
}

async function loadLinks() {
  if (!state.currentPath) {
    renderLinkList(els.outgoingLinks, [], "Нет исходящих ссылок");
    renderLinkList(els.backlinks, [], "Нет обратных ссылок");
    return;
  }
  try {
    const links = await request(`/api/links?path=${encodeURIComponent(state.currentPath)}`);
    renderLinkList(els.outgoingLinks, links.outgoing || [], "Нет исходящих ссылок");
    renderLinkList(els.backlinks, links.backlinks || [], "Нет обратных ссылок");
  } catch (error) {
    renderLinkList(els.outgoingLinks, [], error.message);
    renderLinkList(els.backlinks, [], error.message);
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[\[([^\]]+)\]\]/g, (_, target) => {
      const label = target.includes("|") ? target.split("|")[1] : target;
      return `<span class="wikilink" data-target="${escapeHtml(target)}">${escapeHtml(label)}</span>`;
    });
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cell = "";
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      cell += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      cell += char;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return (
    cells.length > 1 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))
  );
}

function tableAlignments(separator) {
  return splitTableRow(separator).map((cell) => {
    const compact = cell.replace(/\s+/g, "");
    if (compact.startsWith(":") && compact.endsWith(":")) return "center";
    if (compact.endsWith(":")) return "right";
    return "left";
  });
}

function renderTableRow(cells, tag, alignments) {
  const rendered = cells.map((cell, index) => {
    const align = alignments[index] || "left";
    return `<${tag} style="text-align:${align}">${inlineMarkdown(cell)}</${tag}>`;
  });
  return `<tr>${rendered.join("")}</tr>`;
}

function renderTable(lines, startIndex) {
  const header = splitTableRow(lines[startIndex]);
  const alignments = tableAlignments(lines[startIndex + 1]);
  const body = [];
  let index = startIndex + 2;
  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    body.push(splitTableRow(lines[index]));
    index += 1;
  }

  const thead = renderTableRow(header, "th", alignments);
  const tbody = body.map((row) => renderTableRow(row, "td", alignments)).join("");
  return {
    html: `<div class="table-wrap"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`,
    nextIndex: index,
  };
}

function renderMermaid(code) {
  const encoded = encodeURIComponent(code);
  return `<div class="mermaid-wrap"><pre class="mermaid" data-source="${encoded}">${escapeHtml(code)}</pre></div>`;
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (inCode) {
        if (codeLang === "mermaid") {
          html.push(renderMermaid(codeLines.join("\n")));
        } else {
          html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        }
        inCode = false;
        codeLang = "";
        codeLines = [];
      } else {
        inCode = true;
        codeLang = line.slice(3).trim().toLowerCase();
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (i + 1 < lines.length && line.includes("|") && isTableSeparator(lines[i + 1])) {
      const table = renderTable(lines, i);
      html.push(table.html);
      i = table.nextIndex - 1;
      continue;
    }
    if (/^###\s+/.test(line)) html.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
    else if (/^##\s+/.test(line)) html.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
    else if (/^#\s+/.test(line)) html.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
    else if (/^>\s?/.test(line)) html.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, ""))}</blockquote>`);
    else if (/^\s*[-*]\s+/.test(line)) html.push(`<p>${inlineMarkdown(line)}</p>`);
    else if (!line.trim()) html.push("");
    else html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  return html.join("\n");
}

async function renderMermaidBlocks() {
  const blocks = Array.from(els.preview.querySelectorAll(".mermaid"));
  if (!blocks.length) return;
  if (!window.mermaid) {
    for (const block of blocks) {
      block.insertAdjacentHTML("beforebegin", '<div class="mermaid-error">Mermaid не загрузился</div>');
    }
    return;
  }
  window.mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "strict",
  });
  for (const block of blocks) {
    try {
      const source = decodeURIComponent(block.dataset.source || "");
      const id = `mermaid-${Math.random().toString(36).slice(2)}`;
      const { svg } = await window.mermaid.render(id, source);
      block.parentElement.innerHTML = svg;
    } catch (error) {
      block.insertAdjacentHTML(
        "beforebegin",
        `<div class="mermaid-error">Mermaid error: ${escapeHtml(error.message)}</div>`,
      );
    }
  }
}

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem("vault-web-mode", mode);
  const preview = mode === "preview";
  els.editor.classList.toggle("hidden", preview);
  els.preview.classList.toggle("hidden", !preview);
  els.modeToggle.textContent = preview ? "🕮" : "✎";
  els.modeToggle.title = preview ? "Переключиться в Edit" : "Переключиться в Preview";
  els.modeToggle.setAttribute("aria-label", els.modeToggle.title);
  els.modeToggle.classList.toggle("active", preview);
  if (preview) {
    els.preview.innerHTML = renderMarkdown(els.editor.value);
    renderMermaidBlocks();
  } else {
    els.editor.focus();
  }
}

async function followWikiLink(target) {
  const clean = target.split("|")[0].split("#")[0].trim();
  const found = state.notes.find((note) => note.name.toLowerCase() === clean.toLowerCase());
  if (found) return openNote(found.path);
  const note = await request(`/api/resolve?title=${encodeURIComponent(clean)}`);
  await openNote(note.path);
}

function currentWikiRange() {
  const cursor = els.editor.selectionStart;
  const before = els.editor.value.slice(0, cursor);
  const start = before.lastIndexOf("[[");
  const close = before.lastIndexOf("]]");
  if (start < 0 || close > start) return null;
  const query = before.slice(start + 2);
  if (query.includes("\n") || query.includes("|") || query.includes("#")) return null;
  return { start, end: cursor, query };
}

function updateWikiSuggest() {
  const range = currentWikiRange();
  if (!range) return hideWikiSuggest();
  const q = range.query.toLowerCase();
  suggest.items = state.notes
    .filter((note) => note.name.toLowerCase().includes(q))
    .filter((note) => note.path !== state.currentPath)
    .slice(0, 8);
  suggest.active = 0;
  suggest.range = range;
  renderWikiSuggest();
}

function hideWikiSuggest() {
  suggest.items = [];
  suggest.range = null;
  els.wikiSuggest.classList.add("hidden");
}

function renderWikiSuggest() {
  if (!suggest.items.length) return hideWikiSuggest();
  els.wikiSuggest.innerHTML = "";
  for (const [index, note] of suggest.items.entries()) {
    const button = document.createElement("button");
    button.className = `suggest-item${index === suggest.active ? " active" : ""}`;
    button.innerHTML = `<div class="item-name"></div><div class="item-path"></div>`;
    button.querySelector(".item-name").textContent = note.name;
    button.querySelector(".item-path").textContent = note.path;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applyWikiSuggestion(index);
    });
    els.wikiSuggest.append(button);
  }
  els.wikiSuggest.classList.remove("hidden");
}

function applyWikiSuggestion(index = suggest.active) {
  if (!suggest.range || !suggest.items[index]) return;
  const note = suggest.items[index];
  const value = els.editor.value;
  const replacement = `[[${note.name}]]`;
  els.editor.value = `${value.slice(0, suggest.range.start)}${replacement}${value.slice(suggest.range.end)}`;
  const cursor = suggest.range.start + replacement.length;
  els.editor.setSelectionRange(cursor, cursor);
  hideWikiSuggest();
  scheduleSave();
  els.editor.focus();
}

async function openCurrentInObsidian() {
  if (!state.currentPath) return;
  const result = await request(`/api/obsidian-url?path=${encodeURIComponent(state.currentPath)}`);
  window.location.href = result.url;
}

els.search.addEventListener("input", () => {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(loadNotes, 150);
});
els.editor.addEventListener("input", scheduleSave);
els.editor.addEventListener("click", updateWikiSuggest);
els.editor.addEventListener("keyup", updateWikiSuggest);
els.editor.addEventListener("keydown", (event) => {
  if (els.wikiSuggest.classList.contains("hidden")) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    suggest.active = (suggest.active + 1) % suggest.items.length;
    renderWikiSuggest();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    suggest.active = (suggest.active - 1 + suggest.items.length) % suggest.items.length;
    renderWikiSuggest();
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    applyWikiSuggestion();
  } else if (event.key === "Escape") {
    hideWikiSuggest();
  }
});
els.modeToggle.addEventListener("click", () => {
  setMode(state.mode === "preview" ? "edit" : "preview");
});
els.themeToggle.addEventListener("click", () => {
  setTheme(state.theme === "light" ? "dark" : "light");
});
els.openObsidian.addEventListener("click", () => openCurrentInObsidian().catch(alert));
els.toggleSidebar.addEventListener("click", () => {
  setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
});
els.toggleLinks.addEventListener("click", () => {
  setLinksCollapsed(!document.body.classList.contains("links-collapsed"));
});
els.preview.addEventListener("click", (event) => {
  const link = event.target.closest(".wikilink");
  if (link) followWikiLink(link.dataset.target).catch(alert);
});
els.newNoteButton.addEventListener("click", () => {
  els.newNoteTitle.value = "";
  els.dialog.showModal();
});
els.newNoteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const created = await request("/api/note", {
    method: "POST",
    body: JSON.stringify({
      title: els.newNoteTitle.value,
      folder: els.newNoteFolder.value,
    }),
  });
  els.dialog.close();
  await loadNotes();
  await openNote(created.path);
});

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveNote();
  }
});

window.addEventListener("resize", () => {
  const sidebarWidth = Number(localStorage.getItem("vault-web-sidebar-width"));
  const linksHeight = Number(localStorage.getItem("vault-web-links-height"));
  if (Number.isFinite(sidebarWidth) && sidebarWidth > 0) setSidebarWidth(sidebarWidth);
  if (Number.isFinite(linksHeight) && linksHeight > 0) setLinksHeight(linksHeight);
});

loadNotes().catch((error) => {
  els.list.textContent = error.message;
  setSaveStatus(error.message, "error");
});

restorePanelSizes();
bindResizeHandles();
setTheme(state.theme);
setSidebarCollapsed(localStorage.getItem("vault-web-sidebar-collapsed") === "1");
setLinksCollapsed(localStorage.getItem("vault-web-links-collapsed") === "1");
setSaveStatus("Idle");
loadLinks();
