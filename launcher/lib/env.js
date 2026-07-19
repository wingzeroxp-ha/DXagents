const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_DIR = path.join(ROOT, "config");
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
const PID_DIR = path.join(ROOT, "data", "launcher", "pids");
const LAUNCHER_LOG_DIR = path.join(ROOT, "data", "launcher", "logs");
const HOST = "127.0.0.1";
const AGENT_IDS = ["openclaw", "hermes"];
const BACKUP_DIR = path.join(ROOT, "data", "launcher", "backups");
const MODULES_DIR = path.join(__dirname, "..", "public", "modules");

const args = new Set(process.argv.slice(2));
const argValue = (name, fallback) => {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
};

const targetAgent = argValue("--agent", process.env.AGENT_TARGET || "openclaw");
const shouldOpen = args.has("--open");
const activeChildren = new Map();

// Dynamic agent ID management (for skill market install/uninstall)
function addAgentId(id) {
  if (!AGENT_IDS.includes(id)) AGENT_IDS.push(id);
}
function removeAgentId(id) {
  const idx = AGENT_IDS.indexOf(id);
  if (idx >= 0) AGENT_IDS.splice(idx, 1);
}
const START_SCRIPT_NAMES = ["Windows-启动.bat", "Mac-启动.command"];
const PACKAGE_ROOT =
  [path.resolve(ROOT, ".."), path.resolve(ROOT, "..", "..")].find((dir) =>
    START_SCRIPT_NAMES.some((name) => fs.existsSync(path.join(dir, name))),
  ) || path.resolve(ROOT, "..");

module.exports = {
  ROOT, CONFIG_DIR, PUBLIC_DIR, PID_DIR, LAUNCHER_LOG_DIR,
  HOST, AGENT_IDS, BACKUP_DIR, MODULES_DIR,
  targetAgent, shouldOpen, activeChildren, START_SCRIPT_NAMES, PACKAGE_ROOT,
  argValue, addAgentId, removeAgentId,
};
