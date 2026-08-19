import { Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { spawn } from "child_process";
import * as crypto from "crypto";
import { shell } from "electron";
import * as fs from "fs";
import * as path from "path";
import { BUNDLED_WEB_APP_FILES } from "./generated-assets";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4177;
const NODE_CANDIDATES = [
  "node",
  "C:\\Program Files\\nodejs\\node.exe",
  "C:\\Program Files (x86)\\nodejs\\node.exe",
];
const PLUGIN_DIR = path.join(".obsidian", "plugins", "vault-web-launcher");

interface VaultWebSettings {
  autoStart: boolean;
  nodePath: string;
  openOnAutoStart: boolean;
  port: number;
  token: string;
}

const DEFAULT_SETTINGS: VaultWebSettings = {
  autoStart: false,
  nodePath: "",
  openOnAutoStart: false,
  port: DEFAULT_PORT,
  token: "",
};

export default class VaultWebLauncherPlugin extends Plugin {
  settings: VaultWebSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("globe", "Open Vault Web", () => {
      this.startVaultWeb(true);
    });

    this.addCommand({
      id: "start-vault-web",
      name: "Open Vault Web",
      callback: () => this.startVaultWeb(true),
    });

    this.addCommand({
      id: "show-vault-web-status",
      name: "Show Vault Web status",
      callback: () => this.showStatus(),
    });

    this.addSettingTab(new VaultWebSettingTab(this.app, this));

    if (this.settings.autoStart) {
      this.app.workspace.onLayoutReady(() => {
        this.startVaultWeb(this.settings.openOnAutoStart);
      });
    }
  }

  async startVaultWeb(openBrowser: boolean) {
    const vaultRoot = getVaultRoot(this.app.vault.adapter);
    const pluginDir = path.join(vaultRoot, PLUGIN_DIR);
    const appDir = path.join(pluginDir, "vault-web");
    await this.ensureBundledWebApp(appDir);
    const serverPath = path.join(appDir, "server.js");
    const logPath = path.join(appDir, "launcher.log");
    const url = this.urlWithToken();

    if (await this.isVaultWebRunning()) {
      if (openBrowser) await shell.openExternal(url);
      new Notice("Vault Web is already running");
      return;
    }

    const out = fs.openSync(logPath, "a");
    fs.writeSync(out, `\n[${new Date().toISOString()}] Starting Vault Web\n`);

    let started = false;
    for (const nodePath of this.nodeCandidates()) {
      try {
        const child = spawn(nodePath, [serverPath], {
          cwd: appDir,
          detached: true,
          env: {
            ...process.env,
            VAULT_ROOT: vaultRoot,
            PORT: String(this.settings.port),
            VAULT_WEB_TOKEN: this.settings.token,
          },
          stdio: ["ignore", out, out],
          windowsHide: true,
        });
        child.unref();
        child.on("error", (error) => {
          fs.writeFileSync(logPath, `Spawn error for ${nodePath}: ${error.message}\n`, {
            flag: "a",
          });
        });
        fs.writeSync(out, `Spawned with ${nodePath}\n`);
        started = true;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fs.writeSync(out, `Failed with ${nodePath}: ${message}\n`);
      }
    }

    fs.closeSync(out);

    if (!started) {
      new Notice("Vault Web could not find node.exe");
      return;
    }

    if (openBrowser) window.setTimeout(() => shell.openExternal(url), 900);
    new Notice(`Vault Web is starting on port ${this.settings.port}`);
  }

  async showStatus() {
    const running = await this.isVaultWebRunning();
    new Notice(running ? `Vault Web is running: ${this.baseUrl()}` : "Vault Web is not responding");
  }

  async isVaultWebRunning() {
    try {
      const response = await fetch(`${this.baseUrl()}/api/status`, {
        cache: "no-store",
        headers: {
          "X-Vault-Web-Token": this.settings.token,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...data,
      port: normalizePort(data?.port),
      token: typeof data?.token === "string" && data.token ? data.token : crypto.randomBytes(32).toString("hex"),
    };
    await this.saveData(this.settings);
  }

  async saveSettings() {
    this.settings.port = normalizePort(this.settings.port);
    await this.saveData(this.settings);
  }

  baseUrl() {
    return `http://${HOST}:${this.settings.port}`;
  }

  urlWithToken() {
    return `${this.baseUrl()}/?token=${encodeURIComponent(this.settings.token)}`;
  }

  nodeCandidates() {
    const custom = this.settings.nodePath.trim();
    return custom ? [custom, ...NODE_CANDIDATES] : NODE_CANDIDATES;
  }

  async ensureBundledWebApp(appDir: string) {
    for (const file of BUNDLED_WEB_APP_FILES) {
      const relativePath = file.path.replace(/^vault-web\//, "");
      const target = path.join(appDir, relativePath);
      const data = Buffer.from(file.base64, "base64");
      await fs.promises.mkdir(path.dirname(target), { recursive: true });

      try {
        const current = await fs.promises.readFile(target);
        if (current.equals(data)) continue;
      } catch {
        // Missing files are restored from the bundled plugin assets.
      }

      await fs.promises.writeFile(target, data);
    }
  }
}

function normalizePort(value: unknown) {
  const port = Number(value || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return DEFAULT_PORT;
  return port;
}

function getVaultRoot(adapter: unknown) {
  const basePath = (adapter as { basePath?: unknown }).basePath;
  if (typeof basePath !== "string" || !basePath) {
    throw new Error("Vault Web requires a desktop file-system vault");
  }
  return basePath;
}

class VaultWebSettingTab extends PluginSettingTab {
  plugin: VaultWebLauncherPlugin;

  constructor(app: VaultWebLauncherPlugin["app"], plugin: VaultWebLauncherPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Port")
      .setDesc("Local port for Vault Web.")
      .addText((text) => {
        text
          .setPlaceholder(String(DEFAULT_PORT))
          .setValue(String(this.plugin.settings.port))
          .onChange(async (value) => {
            this.plugin.settings.port = normalizePort(value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Node path")
      .setDesc("Optional full path to node.exe. Leave empty to auto-detect.")
      .addText((text) => {
        text
          .setPlaceholder("C:\\Program Files\\nodejs\\node.exe")
          .setValue(this.plugin.settings.nodePath)
          .onChange(async (value) => {
            this.plugin.settings.nodePath = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Start server when Obsidian opens")
      .setDesc("Starts the local server automatically. Restart Obsidian after changing this.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.autoStart).onChange(async (value) => {
          this.plugin.settings.autoStart = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Open browser after auto-start")
      .setDesc("If enabled, auto-start also opens Vault Web in the browser.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.openOnAutoStart).onChange(async (value) => {
          this.plugin.settings.openOnAutoStart = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Open Vault Web")
      .setDesc(this.plugin.baseUrl())
      .addButton((button) => {
        button.setButtonText("Open").setCta().onClick(() => {
          this.plugin.startVaultWeb(true);
        });
      });
  }
}
