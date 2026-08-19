# Obsidian Vault Web

Local browser editor for an Obsidian vault.

Vault Web is an Obsidian desktop plugin that starts a local server on `127.0.0.1` and opens a browser-based Markdown editor for the current vault.

## Features

- Browse and search Markdown notes in the vault.
- Edit notes in the browser with autosave.
- Switch between Edit and Preview.
- Render Markdown tables and Mermaid diagrams.
- Follow wiki links and inspect outgoing links/backlinks.
- Open the current note in Obsidian.
- Collapse and resize the notes sidebar and links panel.
- Switch between dark and light themes.
- Configure port, Node.js path, and startup behavior from Obsidian settings.

## Install Locally

1. Clone or download this repository.
2. Run:

```powershell
npm install
npm run build
```

3. Copy the repository folder into your vault:

```text
<vault>/.obsidian/plugins/vault-web-launcher
```

4. Enable `Vault Web` in Obsidian community plugins.
5. Run the `Open Vault Web` command or click the ribbon icon.

## Security Model

Vault Web is local-only:

- the server binds to `127.0.0.1`;
- API requests require a per-plugin token;
- requests with a foreign `Origin` header are rejected;
- the token is stored in Obsidian plugin data and must not be committed.

This plugin can read and write Markdown files in the opened vault. Review the code before installing it in a sensitive vault.

## Development

```powershell
npm install
npm run build
```

`main.ts` is the Obsidian plugin source. `main.js` is the bundled Obsidian entry point. The browser app and local server live in `vault-web/`.

## Release Payload

Files listed in `release-files.txt` are the minimal install payload. Do not ship `node_modules`, `data.json`, or `vault-web/launcher.log`.
