const path = require("path");
const { ROOT, PACKAGE_ROOT, AGENT_IDS, activeChildren } = require("./env");
const { fileExists, ensureDir, readJson, writeJson, send, safeJoin } = require("./utils");

function checkUpdate(includeChecksums) {
  const updateInfoPath = path.join(ROOT, "config", "update-info.json");
  const info = readJson(updateInfoPath, {});
  const PACKAGE_VERSION = info.launcherVersion || "1.0.0";

  const agentVersions = {};
  for (const id of AGENT_IDS) {
    agentVersions[id] = info[`agentVersion_${id}`] || "1.0.0";
  }

  return {
    currentVersion: PACKAGE_VERSION,
    agentVersions,
    checksums: includeChecksums ? info.checksums || {} : undefined,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { checkUpdate };
