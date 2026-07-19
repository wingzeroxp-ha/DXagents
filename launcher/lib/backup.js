const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { ROOT, BACKUP_DIR, CONFIG_DIR, AGENT_IDS, START_SCRIPT_NAMES, PACKAGE_ROOT, activeChildren } = require("./env");
const { ensureDir, readJson, writeJson, fileExists, safeJoin, readBody, send } = require("./utils");
const { stopAgent, startAgent } = require("./agents");

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const EXCLUDE_DIRS = new Set(["node_modules", "hermes-agent", "python-mac-arm64", "python-win-x64"]);

function copyIfExists(source, destination) {
  if (!fileExists(source)) return;
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function copyDirSkipLarge(src, dest) {
  if (!fileExists(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      copyDirSkipLarge(s, d);
    } else {
      ensureDir(path.dirname(d));
      fs.copyFileSync(s, d);
    }
  }
}

function pruneBackups(keepPath) {
  ensureDir(BACKUP_DIR);
  const resolvedKeep = path.resolve(keepPath);
  for (const entry of fs.readdirSync(BACKUP_DIR)) {
    const target = path.join(BACKUP_DIR, entry);
    try {
      if (path.resolve(target) !== resolvedKeep && fs.statSync(target).isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    } catch {}
  }
}

function latestBackupPath() {
  if (!fileExists(BACKUP_DIR)) return null;
  const entries = fs.readdirSync(BACKUP_DIR)
    .map((entry) => path.join(BACKUP_DIR, entry))
    .filter((entry) => { try { return fs.statSync(entry).isDirectory(); } catch { return false; } })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return entries[0] || null;
}

function backupData(reason = "manual") {
  const backupRoot = path.join(BACKUP_DIR, `backup-${timestampName()}`);
  ensureDir(backupRoot);
  copyIfExists(path.join(ROOT, "config"), path.join(backupRoot, "config"));
  copyIfExists(path.join(ROOT, "data", "openclaw"), path.join(backupRoot, "data", "openclaw"));
  copyIfExists(path.join(ROOT, "data", "hermes"), path.join(backupRoot, "data", "hermes"));
  copyDirSkipLarge(path.join(ROOT, "agents"), path.join(backupRoot, "agents"));
  copyIfExists(path.join(ROOT, "launcher"), path.join(backupRoot, "launcher"));
  for (const scriptName of START_SCRIPT_NAMES) {
    copyIfExists(path.join(PACKAGE_ROOT, scriptName), path.join(backupRoot, "start-scripts", scriptName));
  }
  writeJson(path.join(backupRoot, "backup-info.json"), { createdAt: new Date().toISOString(), reason, root: ROOT, includes: ["config", "data/openclaw", "data/hermes", "agents", "launcher", "start-scripts"] });
  pruneBackups(backupRoot);
  return backupRoot;
}

function restoreLatestBackup() {
  const backupRoot = latestBackupPath();
  if (!backupRoot) throw new Error("没有可还原的备份。");
  copyIfExists(path.join(backupRoot, "config"), path.join(ROOT, "config"));
  copyIfExists(path.join(backupRoot, "data", "openclaw"), path.join(ROOT, "data", "openclaw"));
  copyIfExists(path.join(backupRoot, "data", "hermes"), path.join(ROOT, "data", "hermes"));
  copyDirSkipLarge(path.join(backupRoot, "agents"), path.join(ROOT, "agents"));
  copyIfExists(path.join(backupRoot, "launcher"), path.join(ROOT, "launcher"));
  for (const scriptName of START_SCRIPT_NAMES) {
    copyIfExists(path.join(backupRoot, "start-scripts", scriptName), path.join(PACKAGE_ROOT, scriptName));
  }
  return backupRoot;
}

function restoreUserDataFromBackup(backupRoot) {
  copyIfExists(path.join(backupRoot, "config"), path.join(ROOT, "config"));
  copyIfExists(path.join(backupRoot, "data", "openclaw"), path.join(ROOT, "data", "openclaw"));
  copyIfExists(path.join(backupRoot, "data", "hermes"), path.join(ROOT, "data", "hermes"));
}

function emptyDir(dir) {
  ensureDir(dir);
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function cleanCaches() {
  const targets = [path.join(ROOT, "data", "openclaw", "npm-cache"), path.join(ROOT, "data", "hermes", "npm-cache")];
  for (const target of targets) emptyDir(target);
  return targets;
}

async function restoreHandler() {
  await Promise.all(AGENT_IDS.map((id) => stopAgent(id)));
  const restoredFrom = restoreLatestBackup();
  return { ok: true, restoredFrom, message: "还原完成。请关闭并重新打开启动器，让还原后的程序生效。" };
}

function backupHandler() {
  return { ok: true, backupPath: backupData() };
}

function cleanCacheHandler() {
  return { ok: true, cleaned: cleanCaches() };
}

module.exports = { backupData, backupHandler, restoreHandler, cleanCacheHandler, latestBackupPath, restoreUserDataFromBackup };
