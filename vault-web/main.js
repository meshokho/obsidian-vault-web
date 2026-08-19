const state = {
  notes: [],
  currentPath: "",
  dirty: false,
  mode: "edit",
  saveTimer: 0,
};

const els = {
  list: document.querySelector("#noteList"),
  search: document.querySelector("#searchInput"),
  editor: document.querySelector("#editor"),
  preview: document.querySelector("#preview"),
  title: document.querySelector("#noteTitle"),
  path: document.querySelector("#notePath"),
  save: document.querySelector("#saveButton"),
  edit: document.querySelector("#editButton"),
  previewButton: document.querySelector("#previewButton"),
  toggleSidebar: document.querySelector("#toggleSidebarButton"),
  newNoteButton: document.querySelector("#newNoteButton"),
  dialog: document.querySelector("#newNoteDialog"),
  newNoteForm: document.querySelector("#newNoteForm"),
  newNoteTitle: document.querySelector("#newNoteTitle"),
  newNoteFolder: document.querySelector("#newNoteFolder"),
};

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem("vault-web-sidebar-collapsed", collapsed ? "1" : "0");
  els.toggleSidebar.textContent = collapsed ? "Show Sidebar" : "Hide Sidebar";
}

async function request(url, options) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
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
  setMode("edit");
  renderList();
}

async function saveNote() {
  if (!state.currentPath) return;
  await request("/api/note", {
    method: "PUT",
    body: JSON.stringify({
      path: state.currentPath,
      content: els.editor.value,
    }),
  });
  state.dirty = false;
  els.path.textContent = `${state.currentPath} · сохранено`;
  window.clearTimeout(state.saveTimer);
}

function scheduleSave() {
  state.dirty = true;
  els.path.textContent = `${state.currentPath} · есть изменения`;
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(saveNote, 900);
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

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      html.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html.push(`${escapeHtml(line)}\n`);
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
  return html.join("\n");
}

function setMode(mode) {
  state.mode = mode;
  const preview = mode === "preview";
  els.editor.classList.toggle("hidden", preview);
  els.preview.classList.toggle("hidden", !preview);
  els.edit.classList.toggle("active", !preview);
  els.previewButton.classList.toggle("active", preview);
  if (preview) {
    els.preview.innerHTML = renderMarkdown(els.editor.value);
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

els.search.addEventListener("input", () => {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(loadNotes, 150);
});
els.editor.addEventListener("input", scheduleSave);
els.save.addEventListener("click", saveNote);
els.edit.addEventListener("click", () => setMode("edit"));
els.previewButton.addEventListener("click", () => setMode("preview"));
els.toggleSidebar.addEventListener("click", () => {
  setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
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

loadNotes().catch((error) => {
  els.list.textContent = error.message;
});

setSidebarCollapsed(localStorage.getItem("vault-web-sidebar-collapsed") === "1");
