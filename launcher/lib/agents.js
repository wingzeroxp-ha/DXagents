const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn, execFile } = require("child_process");
const { ROOT, CONFIG_DIR, PID_DIR, HOST, activeChildren, PACKAGE_ROOT, START_SCRIPT_NAMES } = require("./env");
const { ensureDir, readJson, writeJson, fileExists, safeJoin, findFreePort, openBrowser, tailFile } = require("./utils");
const { getConfigs, getAgent, getModelConfigForAgent, normalizeModelConfig } = require("./config");

function pidFile(agentId) {
  return path.join(PID_DIR, `${agentId}.json`);
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function loadPid(agentId) {
  return readJson(pidFile(agentId), null);
}

function savePid(agentId, meta) {
  ensureDir(PID_DIR);
  writeJson(pidFile(agentId), meta);
}

function clearPid(agentId) {
  try { fs.unlinkSync(pidFile(agentId)); } catch {}
}

function getAdapter(agent) {
  const platform = process.platform;
  const adapter = agent.adapters && agent.adapters[platform];
  if (!adapter) return null;
  return { ...adapter, startScriptAbs: safeJoin(adapter.startScript) };
}

function urlFromTemplate(template, ports) {
  return template.replace("{port}", String(ports.port || "")).replace("{dashboardPort}", String(ports.dashboardPort || ""));
}

function openClawProviderMeta(model) {
  const isXiaomi = model.providerId === "xiaomi-mimo" || model.providerId === "xiaomi-mimo-api";
  const isAnthropic = model.protocol === "anthropic" || model.providerId === "anthropic";
  const providerId = isXiaomi ? "xiaomi" : isAnthropic ? "anthropic" : "portable";
  const envKey = isXiaomi ? "XIAOMI_API_KEY" : isAnthropic ? "ANTHROPIC_API_KEY" : "PORTABLE_MODEL_API_KEY";
  const modelRef = `${providerId}/${model.model}`;
  const api = isAnthropic ? "anthropic-messages" : "openai-completions";
  return { providerId, envKey, modelRef, api };
}

function buildAgentEnv(agent, ports) {
  const homeDir = safeJoin(agent.homeDir);
  const workspaceDir = safeJoin(agent.workspaceDir);
  const memoryDir = safeJoin(agent.memoryDir);
  const logDir = safeJoin(agent.logDir);
  const npmCacheDir = safeJoin(agent.npmCacheDir);
  [homeDir, workspaceDir, memoryDir, logDir, npmCacheDir].forEach(ensureDir);

  const env = {
    ...process.env,
    PORTABLE_ROOT: ROOT,
    AGENT_ID: agent.id,
    AGENT_NAME: agent.name,
    AGENT_PORT: String(ports.port),
    AGENT_DASHBOARD_PORT: ports.dashboardPort ? String(ports.dashboardPort) : "",
    AGENT_HOME: homeDir,
    AGENT_WORKSPACE: workspaceDir,
    AGENT_MEMORY: memoryDir,
    AGENT_LOG_DIR: logDir,
    NPM_CONFIG_CACHE: npmCacheDir,
    npm_config_cache: npmCacheDir,
  };

  if (agent.id === "openclaw") {
    env.OPENCLAW_HOME = homeDir;
    env.OPENCLAW_STATE_DIR = homeDir;
    env.OPENCLAW_CONFIG_PATH = path.join(homeDir, "openclaw.json");
    env.OPENCLAW_MEMORY_PATH = memoryDir;
    env.OPENCLAW_WORKSPACE = workspaceDir;
  }
  if (agent.id === "hermes") env.HERMES_HOME = homeDir;
  if (process.platform === "win32") {
    env.USERPROFILE = homeDir;
    env.TEMP = path.join(homeDir, "tmp");
    env.TMP = path.join(homeDir, "tmp");
  } else {
    env.HOME = homeDir;
    env.TMPDIR = path.join(homeDir, "tmp");
  }

  const model = getModelConfigForAgent(agent.id);
  if (model) {
    const isAnthropic = model.protocol === "anthropic" || model.providerId === "anthropic";
    env.PORTABLE_MODEL_PROVIDER = model.providerId || "";
    env.PORTABLE_MODEL_PROTOCOL = model.protocol || "openai-compatible";
    env.PORTABLE_MODEL_BASE_URL = model.baseUrl || "";
    env.PORTABLE_MODEL_NAME = model.model || "";
    env.PORTABLE_MODEL_API_KEY = model.apiKey || "";
    if (model.providerId === "xiaomi-mimo" || model.providerId === "xiaomi-mimo-api") {
      env.XIAOMI_API_KEY = model.apiKey || "";
      env.XIAOMI_BASE_URL = model.baseUrl || "";
    }
    if (isAnthropic) {
      env.ANTHROPIC_API_KEY = model.apiKey || "";
      env.ANTHROPIC_BASE_URL = model.baseUrl || "";
    }
    if (agent.id === "hermes" && (model.providerId === "xiaomi-mimo" || model.providerId === "xiaomi-mimo-api")) {
      env.HERMES_INFERENCE_PROVIDER = "xiaomi";
      env.HERMES_INFERENCE_MODEL = model.model || "";
    } else if (agent.id === "hermes" && isAnthropic) {
      env.HERMES_INFERENCE_PROVIDER = "anthropic";
      env.HERMES_INFERENCE_MODEL = model.model || "";
    } else {
      env.OPENAI_API_KEY = model.apiKey || "";
      env.OPENAI_BASE_URL = model.baseUrl || "";
      env.HERMES_INFERENCE_PROVIDER = "custom";
      env.HERMES_INFERENCE_MODEL = model.model || "";
    }
  }
  return env;
}

function prepareAgentConfig(agent, ports) {
  const homeDir = safeJoin(agent.homeDir);
  const workspaceDir = safeJoin(agent.workspaceDir);
  const logDir = safeJoin(agent.logDir);
  ensureDir(homeDir);
  ensureDir(workspaceDir);
  ensureDir(logDir);
  ensureDir(path.join(homeDir, "tmp"));

  if (agent.id === "openclaw") {
    const configPath = path.join(homeDir, "openclaw.json");
    const existing = readJson(configPath, {});
    const existingGateway = { ...(existing.gateway || {}) };
    delete existingGateway.auth;
    const model = getModelConfigForAgent(agent.id);
    const openClawProvider = model && model.model ? openClawProviderMeta(model) : null;
    const providerModelId = openClawProvider ? openClawProvider.modelRef : null;
    const providerId = openClawProvider ? openClawProvider.providerId : null;
    const providerEnvKey = openClawProvider ? openClawProvider.envKey : "PORTABLE_MODEL_API_KEY";
    const existingModels = (existing && existing.models) || {};
    const existingProviders = { ...((existingModels && existingModels.providers) || {}) };
    delete existingProviders.portable;
    if (providerId === "xiaomi") delete existingProviders.xiaomi;
    if (providerId === "anthropic") delete existingProviders.anthropic;
    const next = {
      ...existing,
      gateway: { ...existingGateway, port: ports.port, bind: "loopback" },
      logging: { ...(existing.logging || {}), file: path.join(logDir, "openclaw-jsonl.log") },
      agents: {
        ...(existing.agents || {}),
        defaults: {
          ...((existing.agents && existing.agents.defaults) || {}),
          workspace: workspaceDir,
          ...(providerModelId ? { model: { primary: providerModelId }, models: { [providerModelId]: {} } } : {}),
        },
      },
      ...(model && model.baseUrl && model.model ? {
        env: { ...(existing.env || {}), [providerEnvKey]: model.apiKey || "" },
        models: {
          ...existingModels, mode: "merge",
          providers: {
            ...existingProviders,
            [providerId]: {
              baseUrl: model.baseUrl, api: openClawProvider.api, apiKey: providerEnvKey,
              models: [{ id: model.model, name: model.model, reasoning: /(?:pro|omni|reason)/i.test(model.model), input: /omni/i.test(model.model) ? ["text", "image"] : ["text"], contextWindow: 131072, maxTokens: 8192 }],
            },
          },
        },
      } : {}),
    };
    writeJson(configPath, next);
  }

  if (agent.id === "hermes") {
    const model = getModelConfigForAgent(agent.id);
    const isAnthropic = model && (model.protocol === "anthropic" || model.providerId === "anthropic");
    const envLines = ["# Hermes portable environment"];
    const xiaomi = model && (model.providerId === "xiaomi-mimo" || model.providerId === "xiaomi-mimo-api");
    if (xiaomi) {
      if (model.apiKey) envLines.push(`XIAOMI_API_KEY=${model.apiKey}`);
      if (model.baseUrl) envLines.push(`XIAOMI_BASE_URL=${model.baseUrl}`);
    } else if (isAnthropic) {
      if (model.apiKey) envLines.push(`ANTHROPIC_API_KEY=${model.apiKey}`);
      if (model.baseUrl) envLines.push(`ANTHROPIC_BASE_URL=${model.baseUrl}`);
    } else {
      if (model && model.apiKey) envLines.push(`OPENAI_API_KEY=${model.apiKey}`);
      if (model && model.baseUrl) envLines.push(`OPENAI_BASE_URL=${model.baseUrl}`);
    }
    if (model && model.model) {
      envLines.push(`HERMES_INFERENCE_PROVIDER=${xiaomi ? "xiaomi" : isAnthropic ? "anthropic" : "custom"}`);
      envLines.push(`HERMES_INFERENCE_MODEL=${model.model}`);
    }
    fs.writeFileSync(path.join(homeDir, ".env"), `${envLines.join("\n")}\n`, "utf8");
    const configLines = ["# Hermes portable config", `workspace: ${JSON.stringify(workspaceDir.replace(/\\/g, "/"))}`];
    if (model && model.model) {
      configLines.push("model:");
      configLines.push(`  provider: ${xiaomi ? "xiaomi" : isAnthropic ? "anthropic" : "custom"}`);
      configLines.push(`  default: ${JSON.stringify(model.model)}`);
      if (model.baseUrl) configLines.push(`  base_url: ${JSON.stringify(model.baseUrl)}`);
      configLines.push(`  api_mode: ${isAnthropic ? "anthropic_messages" : "chat_completions"}`);
    }
    fs.writeFileSync(path.join(homeDir, "config.yaml"), `${configLines.join("\n")}\n`, "utf8");
  }
}

async function allocateAgentPorts(agent) {
  const [start, end] = agent.portRange || [agent.preferredPort, agent.preferredPort + 20];
  const port = await findFreePort(start, end);
  const ports = { port };
  if (agent.dashboardPreferredPort) {
    const [dashStart, dashEnd] = agent.dashboardPortRange || [agent.dashboardPreferredPort, agent.dashboardPreferredPort + 20];
    ports.dashboardPort = await findFreePort(dashStart, dashEnd);
  }
  return ports;
}

async function portAlive(port, host) {
  host = host || "127.0.0.1";
  return new Promise(function (resolve) {
    var sock = net.createConnection(port, host);
    sock.setTimeout(2000);
    sock.on("connect", function () { sock.destroy(); resolve(true); });
    sock.on("timeout", function () { sock.destroy(); resolve(false); });
    sock.on("error", function () { resolve(false); });
  });
}

async function agentStatus(agentId) {
  const agent = getAgent(agentId);
  const adapter = getAdapter(agent);
  const pidMeta = loadPid(agentId);
  const child = activeChildren.get(agentId);
  var running = Boolean(child && !child.killed) || Boolean(pidMeta && pidAlive(pidMeta.pid));
  const installed = Boolean(adapter && fileExists(adapter.startScriptAbs));
  const runtimePorts = readJson(path.join(CONFIG_DIR, "runtime-ports.json"), {});
  const ports = runtimePorts[agentId] || (pidMeta && pidMeta.ports) || {};
  // Fallback: port health check for orphaned processes (Windows shell spawn)
  if (!running && ports) {
    var portOk = ports.port ? await portAlive(ports.port) : false;
    if (!portOk && ports.dashboardPort) portOk = await portAlive(ports.dashboardPort);
    running = portOk;
  }
  // Dashboard port fallback: if dashboardPort not alive but main port is, use main port
  var dashPort = ports.dashboardPort || ports.port;
  if (dashPort && dashPort !== ports.port) {
    var dashOk = await portAlive(dashPort);
    if (!dashOk && ports.port) { dashPort = ports.port; }
  }
  var dashPorts = { ...ports, dashboardPort: dashPort };
  return {
    id: agent.id, name: agent.name, installed, running,
    pid: running ? (child ? child.pid : pidMeta ? pidMeta.pid : null) : null,
    startScript: adapter ? path.relative(ROOT, adapter.startScriptAbs) : null,
    ports,
    url: ports.port ? urlFromTemplate(agent.urlTemplate, ports) : null,
    dashboardUrl: agent.dashboardUrlTemplate && dashPort ? urlFromTemplate(agent.dashboardUrlTemplate, dashPorts) : null,
    message: installed ? (running ? "运行中" : "已安装，未运行") : "未安装到便携包",
  };
}

async function startAgent(agentId) {
  const current = await agentStatus(agentId);
  if (current.running) return { ok: true, status: current, reused: true };

  const agent = getAgent(agentId);
  const adapter = getAdapter(agent);
  if (!adapter || !fileExists(adapter.startScriptAbs)) {
    return { ok: false, code: "AGENT_NOT_INSTALLED", message: `${agent.name} 尚未安装到便携包。请把启动脚本放到 ${adapter ? adapter.startScript : "对应 agents 目录"}。`, status: agentStatus(agentId) };
  }

  const ports = await allocateAgentPorts(agent);
  const runtimePorts = readJson(path.join(CONFIG_DIR, "runtime-ports.json"), {});
  runtimePorts[agentId] = ports;
  writeJson(path.join(CONFIG_DIR, "runtime-ports.json"), runtimePorts);

  const logDir = safeJoin(agent.logDir);
  ensureDir(logDir);
  const logPath = path.join(logDir, `${agent.id}.log`);
  const out = fs.openSync(logPath, "a");
  const err = fs.openSync(logPath, "a");
  const env = buildAgentEnv(agent, ports);
  prepareAgentConfig(agent, ports);

  const child = process.platform === "win32"
    ? spawn(adapter.startScriptAbs, [], { cwd: ROOT, env, stdio: ["ignore", out, err], shell: true, windowsHide: false })
    : spawn("/bin/bash", [adapter.startScriptAbs], { cwd: ROOT, env, stdio: ["ignore", out, err] });

  activeChildren.set(agentId, child);
  savePid(agentId, { pid: child.pid, agentId, root: ROOT, startScript: adapter.startScript, ports, startedAt: new Date().toISOString(), startedBy: "AI-Agent-Portable" });

  child.on("exit", (code, signal) => {
    console.log(`${agent.name} exited. code=${code} signal=${signal || ""}`);
    activeChildren.delete(agentId);
    // Do NOT clearPid here — keep port info for portAlive health check
    // clearPid(agentId); — only clears on explicit stopAgent()
  });

  console.log(`${agent.name} started pid=${child.pid} port=${ports.port}`);
  return { ok: true, status: await agentStatus(agentId) };
}

async function stopAgent(agentId) {
  const status = await agentStatus(agentId);
  if (!status.running) { clearPid(agentId); return { ok: true, status: await agentStatus(agentId), message: "未运行" }; }

  const child = activeChildren.get(agentId);
  const pidMeta = loadPid(agentId);
  const pid = child ? child.pid : pidMeta && pidMeta.pid;
  if (!pid) return { ok: false, message: "没有可停止的 PID" };

  await new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], () => resolve());
    } else {
      try { process.kill(pid, "SIGTERM"); } catch {}
      setTimeout(resolve, 500);
    }
  });

  activeChildren.delete(agentId);
  clearPid(agentId);
  return { ok: true, status: await agentStatus(agentId) };
}

module.exports = {
  agentStatus, startAgent, stopAgent, getAdapter, buildAgentEnv,
  allocateAgentPorts, prepareAgentConfig, openClawProviderMeta,
  loadPid, savePid, clearPid,
};
