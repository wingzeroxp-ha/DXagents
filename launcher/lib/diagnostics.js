const fs = require("fs");
const os = require("os");
const path = require("path");
const { ROOT, LAUNCHER_LOG_DIR, AGENT_IDS } = require("./env");
const { fileExists, ensureDir, safeJoin, tailFile } = require("./utils");
const { getConfigs } = require("./config");
const { agentStatus } = require("./agents");

function diagnostics() {
  const configs = getConfigs();
  const nodeWin = fileExists(path.join(ROOT, "runtime", "node-win-x64", "node.exe"));
  const nodeMac = fileExists(path.join(ROOT, "runtime", "node-mac-arm64", "bin", "node")) || fileExists(path.join(ROOT, "runtime", "node-v24.15.0-darwin-arm64.tar.gz"));
  const statuses = Object.keys(configs.agents.agents || {}).map(agentStatus);
  const dirs = ["data/openclaw/home", "data/openclaw/workspace", "data/hermes/home", "data/hermes/workspace", "data/launcher/logs", "config"].map((dir) => {
    const abs = safeJoin(dir);
    let writable = false;
    try {
      ensureDir(abs);
      const test = path.join(abs, ".write-test");
      fs.writeFileSync(test, "ok");
      fs.unlinkSync(test);
      writable = true;
    } catch {}
    return { path: dir, writable };
  });

  return {
    root: ROOT,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    hostname: os.hostname(),
    runtime: { nodeWin, nodeMac },
    agents: statuses,
    dirs,
    configComplete: AGENT_IDS.every((id) => { const model = configs.agentModels[id]; return Boolean(model && model.providerId && model.apiKey); }),
    permissions: configs.permissions,
    latestLauncherLog: tailFile(path.join(LAUNCHER_LOG_DIR, "launcher.log"), 12000),
  };
}

module.exports = { diagnostics };
