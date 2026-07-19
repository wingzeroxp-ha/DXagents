const http = require("http");
const fs = require("fs");
const path = require("path");
const net = require("net");
const os = require("os");
const { spawn, execFile } = require("child_process");

const { HOST, AGENT_IDS, ROOT, CONFIG_DIR, PUBLIC_DIR, PID_DIR, LAUNCHER_LOG_DIR, PACKAGE_ROOT, activeChildren, START_SCRIPT_NAMES, argValue, addAgentId, removeAgentId } = require("./lib/env");
const { ensureDir, readJson, writeJson, fileExists, safeJoin, log, send, readBody, tailFile, findFreePort } = require("./lib/utils");
const { getConfigs, getModelConfigForAgent, getModelMode, setModelMode, readModelConfigForScope, writeModelConfigForScope, normalizeModelConfig, maskModelConfig, getAgent, readChannels, writeChannels, setChannelForAgent, createChannel, updateChannel, deleteChannel, migrateChannels, getProviderModels, findProviderByModelId, readCustomPresets, createCustomPreset, updateCustomPreset, deleteCustomPreset } = require("./lib/config");
const { agentStatus, startAgent, stopAgent } = require("./lib/agents");
const { sseHandler } = require("./lib/sse");
const { backupHandler, restoreHandler, cleanCacheHandler, latestBackupPath, restoreUserDataFromBackup } = require("./lib/backup");
const { diagnostics } = require("./lib/diagnostics");
const { checkUpdate } = require("./lib/update");

const targetAgent = argValue("--agent", process.env.AGENT_TARGET || "openclaw");
const shouldOpen = process.argv.includes("--open");
let PORT = parseInt(argValue("--port", "0"), 10);

function yamlQuote(value) {
  return JSON.stringify(String(value || ""));
}



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

function simpleChatFile(agentId) {
  const agent = getAgent(agentId);
  const dir = path.join(safeJoin(agent.homeDir), "simple-chat");
  ensureDir(dir);
  return path.join(dir, "history.json");
}

function readSimpleChat(agentId) {
  const history = readJson(simpleChatFile(agentId), { messages: [] });
  return Array.isArray(history.messages) ? history.messages : [];
}

function writeSimpleChat(agentId, messages) {
  writeJson(simpleChatFile(agentId), { messages, updatedAt: new Date().toISOString() });
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

function openBrowser(url) {
  const platform = process.platform;
  let command, cmdArgs;
  if (platform === "win32") { command = "cmd.exe"; cmdArgs = ["/c", "start", "", url]; }
  else if (platform === "darwin") { command = "open"; cmdArgs = [url]; }
  else { command = "xdg-open"; cmdArgs = [url]; }
  const child = spawn(command, cmdArgs, { detached: true, stdio: "ignore" });
  child.unref();
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

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function lookupProvider(providerId) {
  const providers = readJson(path.join(CONFIG_DIR, "providers.json"), { providers: [] }).providers || [];
  return providers.find((p) => p.id === providerId) || null;
}

function modelModePath() {
  return path.join(CONFIG_DIR, "model-mode.json");
}

function modelFile(scope) {
  if (scope === "openclaw" || scope === "hermes") return path.join(CONFIG_DIR, `model.${scope}.json`);
  return path.join(CONFIG_DIR, "model.json");
}

// ── Simple Chat helpers ──────────────────────────────────────────────────

function simpleChatSystemPrompt(agentId) {
  const name = agentId === "hermes" ? "Hermes" : "OpenClaw";
  return [
    `你是 ${name} 的便携版简易对话模式。`,
    "优先使用中文回答，除非用户明确要求其它语言。",
    "回答要直接、清楚、可执行。",
    "当前模式不直接执行本机命令；如果用户需要控制电脑，提醒需要进入正式 Agent 控制台或开启相应权限。",
  ].join("\n");
}

function normalizeSimpleChatAttachments(input) {
  const items = Array.isArray(input) ? input.slice(0, 4) : [];
  return items.map((item) => {
    const name = String(item.name || "未命名附件").slice(0, 120);
    const kind = item.kind === "image" ? "image" : item.kind === "text" ? "text" : "";
    if (kind === "text") return { kind, name, text: String(item.text || "").slice(0, 120000) };
    if (kind === "image") {
      const dataUrl = String(item.dataUrl || "");
      if (!/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(dataUrl)) return null;
      return { kind, name, dataUrl };
    }
    return null;
  }).filter(Boolean);
}

function buildSimpleChatUserContent(text, attachments) {
  const textParts = [text || "请分析附件。"];
  for (const item of attachments) {
    if (item.kind === "text") textParts.push(`\n\n[文件：${item.name}]\n${item.text || "(空文件)"}`);
    if (item.kind === "image") textParts.push(`\n\n[图片：${item.name}]`);
  }
  const combinedText = textParts.join("");
  const images = attachments.filter((item) => item.kind === "image");
  if (!images.length) return combinedText;
  return [{ type: "text", text: combinedText }, ...images.map((item) => ({ type: "image_url", image_url: { url: item.dataUrl } }))];
}

function anthropicMessagesUrl(baseUrl) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
}

function dataUrlToAnthropicImage(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;
  return { type: "image", source: { type: "base64", media_type: match[1].toLowerCase().replace("image/jpg", "image/jpeg"), data: match[2] } };
}

function buildAnthropicUserContent(text, attachments) {
  const textParts = [text || "请分析附件。"];
  for (const item of attachments) {
    if (item.kind === "text") textParts.push(`\n\n[文件：${item.name}]\n${item.text || "(空文件)"}`);
  }
  const content = [{ type: "text", text: textParts.join("") }];
  for (const item of attachments) {
    if (item.kind === "image") {
      const block = dataUrlToAnthropicImage(item.dataUrl);
      if (block) content.push(block);
    }
  }
  return content;
}

function historyTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && part.type === "text") return part.text || "";
      if (part && part.type === "image_url") return "[图片]";
      return "";
    }).filter(Boolean).join("\n");
  }
  return String(content || "");
}

function extractAnthropicText(data) {
  if (!data || !Array.isArray(data.content)) return "";
  return data.content.map((item) => {
    if (typeof item === "string") return item;
    return item && item.type === "text" ? item.text || "" : "";
  }).filter(Boolean).join("\n").trim();
}

// ── Simple Chat ──────────────────────────────────────────────────────────

async function runSimpleChat(agentId, userMessage, inputAttachments = [], systemOverride = null, specificModel) {
  const text = String(userMessage || "").trim();
  const attachments = normalizeSimpleChatAttachments(inputAttachments);
  if (!text && !attachments.length) throw new Error("消息不能为空。");
  const model = normalizeModelConfig(getModelConfigForAgent(agentId, specificModel) || {}, {});
  if (!model.baseUrl || !model.apiKey || !model.model) {
    throw new Error("请先在启动器里配置模型 API。");
  }
  const current = readSimpleChat(agentId).slice(-30);
  const isAnthropic = model.protocol === "anthropic" || model.providerId === "anthropic";
  const useSystem = systemOverride || simpleChatSystemPrompt(agentId);
  const requestMessages = isAnthropic
    ? [...current.filter((item) => item.role === "user" || item.role === "assistant").map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: historyTextContent(item.content) })), { role: "user", content: buildAnthropicUserContent(text, attachments) }]
    : [{ role: "system", content: useSystem }, ...current.map((item) => ({ role: item.role, content: item.content })), { role: "user", content: buildSimpleChatUserContent(text, attachments) }];
  const response = await fetch(isAnthropic ? anthropicMessagesUrl(model.baseUrl) : `${model.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: isAnthropic ? { "Content-Type": "application/json", "x-api-key": model.apiKey, "anthropic-version": "2023-06-01" } : { "Content-Type": "application/json", Authorization: `Bearer ${model.apiKey}` },
    body: JSON.stringify(isAnthropic ? { model: model.model, system: useSystem, messages: requestMessages, temperature: 0.2, max_tokens: 1024 } : { model: model.model, messages: requestMessages, temperature: 0.2, max_tokens: 1024 }),
  });
  const bodyText = await response.text();
  let data = null;
  try { data = bodyText ? JSON.parse(bodyText) : null; } catch {}
  if (!response.ok) {
    const message = data && data.error && data.error.message ? data.error.message : bodyText || `模型接口返回 ${response.status}`;
    throw new Error(message);
  }
  const choice = data && data.choices && data.choices[0];
  const content = isAnthropic ? extractAnthropicText(data) : extractContent(choice);
  if (!content) throw new Error("模型返回内容为空。");
  writeSimpleChat(agentId, [...current, { role: "user", content: [{ type: "text", text }] }, { role: "assistant", content }]);
  return { content, model: model.model };
}

function extractContent(choice) {
  if (!choice || !choice.message) return "";
  var c = choice.message.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) return c.map(function (part) { return part.text || ""; }).join("").trim();
  return "";
}

// ── Streaming Chat (SSE) ──────────────────────────────────────────────────

async function runSimpleChatStream(res, agentId, userMessage, inputAttachments = [], systemOverride = null, specificModel) {
  const text = String(userMessage || "").trim();
  const attachments = normalizeSimpleChatAttachments(inputAttachments);
  if (!text && !attachments.length) { res.write(`data: ${JSON.stringify({ error: "消息不能为空。" })}\n\n`); res.end(); return; }
  const model = normalizeModelConfig(getModelConfigForAgent(agentId, specificModel) || {}, {});
  if (!model.baseUrl || !model.apiKey || !model.model) {
    res.write(`data: ${JSON.stringify({ error: "请先在启动器里配置模型 API。" })}\n\n`); res.end(); return;
  }
  const current = readSimpleChat(agentId).slice(-30);
  const isAnthropic = model.protocol === "anthropic" || model.providerId === "anthropic";
  const useSystem = systemOverride || simpleChatSystemPrompt(agentId);
  const requestMessages = isAnthropic
    ? [...current.filter((item) => item.role === "user" || item.role === "assistant").map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: historyTextContent(item.content) })), { role: "user", content: buildAnthropicUserContent(text, attachments) }]
    : [{ role: "system", content: useSystem }, ...current.map((item) => ({ role: item.role, content: item.content })), { role: "user", content: buildSimpleChatUserContent(text, attachments) }];
  const url = isAnthropic ? anthropicMessagesUrl(model.baseUrl) : `${model.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers = isAnthropic ? { "Content-Type": "application/json", "x-api-key": model.apiKey, "anthropic-version": "2023-06-01" } : { "Content-Type": "application/json", Authorization: `Bearer ${model.apiKey}` };
  const payload = isAnthropic
    ? { model: model.model, system: useSystem, messages: requestMessages, temperature: 0.2, max_tokens: 1024, stream: true }
    : { model: model.model, messages: requestMessages, temperature: 0.2, max_tokens: 1024, stream: true };

  let response;
  try {
    response = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: `网络请求失败: ${e.message}` })}\n\n`); res.end(); return;
  }
  if (!response.ok) {
    const bodyText = await response.text();
    res.write(`data: ${JSON.stringify({ error: bodyText || `模型接口返回 ${response.status}` })}\n\n`); res.end(); return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          let delta = "";
          if (isAnthropic) {
            if (parsed.type === "content_block_delta" && parsed.delta && parsed.delta.text) delta = parsed.delta.text;
          } else {
            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) delta = parsed.choices[0].delta.content;
          }
          if (delta) {
            fullContent += delta;
            res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
          }
        } catch {}
      }
    }
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: `流读取中断: ${e.message}` })}\n\n`);
    res.end(); return;
  }

  writeSimpleChat(agentId, [...current, { role: "user", content: [{ type: "text", text }] }, { role: "assistant", content: fullContent }]);
  res.write("data: [DONE]\n\n");
  res.end();
}

// ── Chat History (sessions) ───────────────────────────────────────────────

function listChatSessions(agentId) {
  const dir = path.join(ROOT, "data", agentId);
  const sessions = [];
  try {
    if (!fs.existsSync(dir)) return sessions;
    const files = fs.readdirSync(dir).filter(f => f.startsWith("simple-chat-archive-") && f.endsWith(".json")).sort().reverse();
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const messages = Array.isArray(content) ? content : (content.messages || []);
        const firstMsg = messages.find(m => m.role === "user");
        sessions.push({
          id: file.replace(/^simple-chat-archive-/, "").replace(/\.json$/, ""),
          timestamp: file.replace(/^simple-chat-archive-/, "").replace(/\.json$/, ""),
          preview: firstMsg && (typeof firstMsg.content === "string" ? firstMsg.content.slice(0, 80) : (Array.isArray(firstMsg.content) ? "[附件]" : "")),
          count: messages.filter(m => m.role === "user" || m.role === "assistant").length,
        });
      } catch {}
    }
  } catch {}
  return sessions;
}

function readChatSession(agentId, sessionId) {
  const filePath = path.join(ROOT, "data", agentId, `simple-chat-archive-${sessionId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(content) ? content : (content.messages || []);
  } catch { return null; }
}

function deleteChatSession(agentId, sessionId) {
  const filePath = path.join(ROOT, "data", agentId, `simple-chat-archive-${sessionId}.json`);
  if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return true; }
  return false;
}

async function testProvider(body) {
  const scope = body.scope === "openclaw" || body.scope === "hermes" ? body.scope : "shared";
  const existing = readModelConfigForScope(scope) || (scope === "shared" ? null : readModelConfigForScope("shared")) || {};
  const config = normalizeModelConfig(body, existing);
  if (!config.baseUrl || !config.apiKey || !config.model) {
    return { ok: false, message: "请填写 Base URL、API Key 和模型名。" };
  }
  const protocol = config.protocol || "openai-compatible";
  const url = protocol === "anthropic" ? anthropicMessagesUrl(config.baseUrl) : `${String(config.baseUrl).replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = protocol === "anthropic" ? { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" } : { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` };
    const payload = { model: config.model, messages: [{ role: "user", content: "ping" }], max_tokens: 8 };
    const response = await fetch(url, { method: "POST", signal: controller.signal, headers, body: JSON.stringify(payload) });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, message: text.slice(0, 500) || `接口返回 ${response.status}` };
    return { ok: true, message: "连接成功。" };
  } catch (error) {
    return { ok: false, message: error.name === "AbortError" ? "连接超时。" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

// ── HTTP Server ──────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const method = req.method;
  const pathname = url.pathname;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  try {
    // ── Agent Config (must be before /api/agent/:id/:action to avoid conflict) ─
    const agentConfigMatch = pathname.match(/^\/api\/agent\/(openclaw|hermes)\/config$/);
    if (agentConfigMatch && method === "GET") {
      const agentId = agentConfigMatch[1];
      send(res, 200, { model: maskModelConfig(getModelConfigForAgent(agentId)), mode: getModelMode(), agent: getAgent(agentId) });
      return;
    }
    if (agentConfigMatch && method === "POST") {
      const agentId = agentConfigMatch[1];
      const body = await readBody(req);
      const existing = getModelConfigForAgent(agentId);
      const merged = normalizeModelConfig(body, existing || {});
      writeModelConfigForScope(getModelMode() === "separate" ? agentId : "shared", merged);
      log(`${agentId} 配置已保存`);
      send(res, 200, { ok: true, model: maskModelConfig(merged), agentId });
      return;
    }

    // ── Agent Actions ────────────────────────────────────────────────────
    const agentActionMatch = pathname.match(/^\/api\/agent\/(openclaw|hermes)\/(start|stop|restart)$/);
    if (agentActionMatch) {
      const [_, agentId, action] = agentActionMatch;
      if (action === "stop") {
        const result = await stopAgent(agentId);
        send(res, 200, result);
      } else if (action === "start") {
        const result = await startAgent(agentId);
        send(res, 200, result);
      } else if (action === "restart") {
        await stopAgent(agentId);
        await new Promise((r) => setTimeout(r, 1000));
        const result = await startAgent(agentId);
        send(res, 200, result);
      }
      return;
    }

    // ── Agent Logs ──────────────────────────────────────────────────────
    const agentLogMatch = pathname.match(/^\/api\/agent\/(openclaw|hermes)\/logs$/);
    if (agentLogMatch) {
      const agentId = agentLogMatch[1];
      const agent = getAgent(agentId);
      const logPath = path.join(safeJoin(agent.logDir), `${agent.id}.log`);
      send(res, 200, { id: agentId, log: tailFile(logPath) });
      return;
    }

    // ── Agent Logs SSE Stream ──────────────────────────────────────────
    const agentLogStreamMatch = pathname.match(/^\/api\/agent\/(openclaw|hermes)\/logs\/stream$/);
    if (agentLogStreamMatch) {
      const agentId = agentLogStreamMatch[1];
      const agent = getAgent(agentId);
      const logPath = path.join(safeJoin(agent.logDir), `${agent.id}.log`);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      // Send initial content using SSE data format
      const initial = tailFile(logPath);
      if (initial) {
        const initLines = initial.split("\n");
        for (const l of initLines) res.write(`data: ${l}\n`);
        res.write("\n");
      }
      // Watch for changes with polling
      let watchTimer = null;
      let lastSize = 0;
      try { lastSize = fs.statSync(logPath).size; } catch {}
      const check = () => {
        try {
          const stats = fs.statSync(logPath);
          if (stats.size > lastSize) {
            const fd = fs.openSync(logPath, "r");
            const buf = Buffer.alloc(stats.size - lastSize);
            fs.readSync(fd, buf, 0, buf.length, lastSize);
            fs.closeSync(fd);
            const chunk = buf.toString("utf8");
            if (chunk) {
              const lines = chunk.split("\n");
              for (const l of lines) res.write(`data: ${l}\n`);
              res.write("\n");
            }
            lastSize = stats.size;
          }
        } catch {}
      };
      watchTimer = setInterval(check, 1000);
      req.on("close", () => { clearInterval(watchTimer); });
      return;
    }

    // ── Agent Files ──────────────────────────────────────────────────────
    const agentFileListMatch = pathname.match(/^\/api\/agent\/(openclaw|hermes)\/files$/);
    if (agentFileListMatch && method === "GET") {
      const agentId = agentFileListMatch[1];
      const agent = getAgent(agentId);
      const rootDir = safeJoin(agent.workspaceDir);
      const reqPath = String(url.searchParams.get("path") || "").replace(/^[/\\]+/, "");
      const targetDir = path.resolve(path.join(rootDir, reqPath));
      if (!targetDir.startsWith(rootDir)) { send(res, 403, { error: "路径越界" }); return; }
      try {
        const items = fs.readdirSync(targetDir, { withFileTypes: true });
        const entries = items.map((item) => {
          const full = path.join(targetDir, item.name);
          const rel = path.relative(rootDir, full).replace(/\\/g, "/");
          let stat;
          try { stat = fs.statSync(full); } catch { stat = null; }
          return {
            name: item.name,
            path: rel,
            type: item.isDirectory() ? "dir" : "file",
            size: stat ? stat.size : 0,
            mtime: stat ? stat.mtime.toISOString() : null,
          };
        }).sort((a, b) => {
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        send(res, 200, { path: reqPath || "/", entries });
      } catch (e) { send(res, 500, { error: `读取目录失败: ${e.message}` }); }
      return;
    }

    const agentFileReadMatch = pathname.match(/^\/api\/agent\/(openclaw|hermes)\/files\/read$/);
    if (agentFileReadMatch && method === "GET") {
      const agentId = agentFileReadMatch[1];
      const agent = getAgent(agentId);
      const rootDir = safeJoin(agent.workspaceDir);
      const reqPath = String(url.searchParams.get("path") || "").replace(/^[/\\]+/, "");
      const targetFile = path.resolve(path.join(rootDir, reqPath));
      if (!targetFile.startsWith(rootDir)) { send(res, 403, { error: "路径越界" }); return; }
      try {
        const stat = fs.statSync(targetFile);
        if (stat.size > 1048576) { send(res, 200, { content: "[文件超过 1MB，无法预览]", text: false }); return; }
        const isText = /\.(txt|md|json|csv|log|xml|html?|js|ts|py|java|go|rs|c|cpp|h|css|yaml|yml|toml|ini|cfg|env|sh|cmd|bat|ps1|sql|r|rb|php)$/i.test(path.extname(targetFile));
        if (!isText) { send(res, 200, { content: null, text: false, size: stat.size }); return; }
        const content = fs.readFileSync(targetFile, "utf8");
        send(res, 200, { content, text: true, size: stat.size });
      } catch (e) { send(res, 500, { error: `读取文件失败: ${e.message}` }); }
      return;
    }

    // ── Agent Check ─────────────────────────────────────────────────────
    const agentCheckMatch = pathname.match(/^\/api\/agent\/(openclaw|hermes)\/check$/);
    if (agentCheckMatch) {
      send(res, 200, await agentStatus(agentCheckMatch[1]));
      return;
    }

    // ── Status ───────────────────────────────────────────────────────────
    if (pathname === "/api/status") {
      const statuses = {};
      for (const id of AGENT_IDS) {
        try { statuses[id] = await agentStatus(id); } catch { statuses[id] = { id, installed: false, running: false }; }
      }
      send(res, 200, statuses);
      return;
    }

    // ── Providers (with models) ────────────────────────────────────────────
    if (pathname === "/api/providers" && method === "GET") {
      const providers = readJson(path.join(CONFIG_DIR, "providers.json"), { providers: [] }).providers || [];
      const safe = providers.map(function (p) { return { id: p.id, name: p.name, baseUrl: p.baseUrl, protocol: p.protocol, keyLabel: p.keyLabel, model: p.model, models: p.models || [] }; });
      send(res, 200, { providers: safe });
      return;
    }

    // ── Config ───────────────────────────────────────────────────────────
    if (pathname === "/api/config" && method === "GET") {
      const configs = getConfigs();
      const channels = readChannels();
      const statuses = {};
      for (const id of AGENT_IDS) {
        try { statuses[id] = await agentStatus(id); } catch { statuses[id] = { id, installed: false, running: false }; }
      }
      const masked = { ...configs, agentModels: { openclaw: maskModelConfig(configs.agentModels.openclaw), hermes: maskModelConfig(configs.agentModels.hermes) }, channels: channels.channels, agentChannels: channels.agentChannels, status: statuses };
      send(res, 200, masked);
      return;
    }
    if (pathname === "/api/config" && method === "POST") {
      const body = await readBody(req);
      try {
        const agentsCfg = readJson(path.join(CONFIG_DIR, "agents.json"), { agents: {} });
        if (body.providers) writeJson(path.join(CONFIG_DIR, "providers.json"), { providers: body.providers });
        if (body.permissions) writeJson(path.join(CONFIG_DIR, "permissions.json"), body.permissions);
        if (body.agents) writeJson(path.join(CONFIG_DIR, "agents.json"), { agents: body.agents });
        if (body.portable) writeJson(path.join(CONFIG_DIR, "portable.json"), body.portable);
        if (body.model) writeModelConfigForScope("shared", body.model);
        if (body.modelMode) setModelMode(body.modelMode);
        if (body.agentModels) {
          for (const [agentId, model] of Object.entries(body.agentModels)) {
            if (AGENT_IDS.includes(agentId)) {
              const scope = body.modelMode === "separate" ? agentId : "shared";
              if (model) writeModelConfigForScope(scope, model);
            }
          }
        }
        if (body.language) writeJson(path.join(CONFIG_DIR, "language.json"), body.language);
        // Direct model save (from frontend form)
        if (body.scope) {
          if (body.scope === "openclaw" || body.scope === "hermes") {
            // Set agent channel
            if (body.channelId !== undefined) {
              setChannelForAgent(body.scope, body.channelId);
            } else {
              const scope = body.scope;
              const existing = readModelConfigForScope(scope) || (scope === "shared" ? null : readModelConfigForScope("shared")) || {};
              const merged = normalizeModelConfig(body, existing);
              writeModelConfigForScope(scope, merged);
            }
          } else {
            const scope = "shared";
            const existing = readModelConfigForScope(scope) || {};
            const merged = normalizeModelConfig(body, existing);
            writeModelConfigForScope(scope, merged);
          }
        }
        log("配置已保存");
        send(res, 200, { ok: true });
      } catch (e) {
        send(res, 500, { error: `保存配置失败: ${e.message}` });
      }
      return;
    }

    // ── Simple Chat ──────────────────────────────────────────────────────
    if (pathname === "/api/simple-chat" && method === "POST") {
      const body = await readBody(req);
      const agentId = body.agentId || targetAgent;
      if (!AGENT_IDS.includes(agentId)) { send(res, 400, { error: `无效的 agentId: ${agentId}` }); return; }
      try {
        if (body.list) { send(res, 200, { messages: readSimpleChat(agentId) }); return; }
        if (body.clear) { writeSimpleChat(agentId, []); send(res, 200, { ok: true, message: "历史已清除" }); return; }
        const result = await runSimpleChat(agentId, body.message, body.attachments);
        send(res, 200, result);
      } catch (e) { send(res, 400, { error: e.message }); }
      return;
    }

    // ── Test Provider ────────────────────────────────────────────────────
    if (pathname === "/api/test-provider" && method === "POST") {
      const body = await readBody(req);
      send(res, 200, await testProvider(body));
      return;
    }

    // ── Edit Language Config ─────────────────────────────────────────────
    if (pathname === "/api/config/language" && method === "GET") {
      send(res, 200, readJson(path.join(CONFIG_DIR, "language.json"), {}));
      return;
    }
    if (pathname === "/api/config/language" && method === "POST") {
      const body = await readBody(req);
      writeJson(path.join(CONFIG_DIR, "language.json"), body);
      send(res, 200, { ok: true });
      return;
    }

    // ── SSE ──────────────────────────────────────────────────────────────
    if (pathname === "/sse") {
      sseHandler(req, res);
      return;
    }

    // ── Backup / Restore ────────────────────────────────────────────────
    if (pathname === "/api/backup" && method === "POST") {
      send(res, 200, backupHandler());
      return;
    }
    if (pathname === "/api/restore" && method === "POST") {
      send(res, 200, await restoreHandler());
      return;
    }
    if (pathname === "/api/clean-cache" && method === "POST") {
      send(res, 200, cleanCacheHandler());
      return;
    }
    if (pathname === "/api/diagnostics" && method === "GET") {
      send(res, 200, diagnostics());
      return;
    }
    if (pathname === "/api/update" && method === "GET") {
      const includeChecksums = url.searchParams.has("checksums");
      send(res, 200, checkUpdate(includeChecksums));
      return;
    }

    // ── Presets ─────────────────────────────────────────────────────────
    if (pathname === "/api/presets" && method === "GET") {
      const presets = readJson(path.join(CONFIG_DIR, "presets.json"), { presets: [] });
      send(res, 200, presets);
      return;
    }

    // ── Model Marketplace ──────────────────────────────────────────────
    if (pathname === "/api/models/marketplace" && method === "GET") {
      const marketplace = readJson(path.join(CONFIG_DIR, "models.json"), { categories: [] });
      send(res, 200, marketplace);
      return;
    }

    // ── Channels API ──────────────────────────────────────────────────
    if (pathname === "/api/channels" && method === "GET") {
      const channels = readChannels();
      send(res, 200, channels);
      return;
    }
    if (pathname === "/api/channels" && method === "POST") {
      const body = await readBody(req);
      try {
        if (!body.name) { send(res, 400, { error: "通道名称不能为空" }); return; }
        if (body.delete) {
          deleteChannel(body.delete);
          send(res, 200, { ok: true, message: "通道已删除" });
        } else {
          var id = createChannel(body.name, {
            providerId: body.providerId || "",
            providerName: body.providerName || "",
            apiKey: body.apiKey || "",
            baseUrl: body.baseUrl || "",
            model: body.model || "",
            models: body.models || [],
            protocol: body.protocol || "openai-compatible",
          });
          send(res, 200, { ok: true, id: id, message: "通道已创建" });
        }
      } catch (e) {
        send(res, 500, { error: "通道操作失败: " + e.message });
      }
      return;
    }
    const channelDeleteMatch = pathname.match(/^\/api\/channels\/([^/]+)$/);
    if (channelDeleteMatch && method === "DELETE") {
      deleteChannel(channelDeleteMatch[1]);
      send(res, 200, { ok: true, message: "通道已删除" });
      return;
    }
    if (channelDeleteMatch && method === "PUT") {
      const body = await readBody(req);
      try {
        updateChannel(channelDeleteMatch[1], {
          name: body.name || "",
          providerId: body.providerId || "",
          providerName: body.providerName || "",
          apiKey: body.apiKey || "",
          baseUrl: body.baseUrl || "",
          model: body.model || "",
          models: body.models || [],
          protocol: body.protocol || "openai-compatible",
        });
        send(res, 200, { ok: true, id: channelDeleteMatch[1], message: "通道已更新" });
      } catch (e) {
        send(res, 500, { error: "通道更新失败: " + e.message });
      }
      return;
    }

    // ── Provider Models ─────────────────────────────────────────────────
    const providerModelsMatch = pathname.match(/^\/api\/channels\/([^/]+)\/provider-models$/);
    if (providerModelsMatch && method === "GET") {
      const channelId = providerModelsMatch[1];
      const channels = readChannels();
      const ch = channels.channels.find((c) => c.id === channelId);
      if (!ch) { send(res, 404, { error: "通道不存在" }); return; }
      const models = getProviderModels(ch.providerId);
      send(res, 200, { providerId: ch.providerId, models });
      return;
    }

    // ── Custom Presets ──────────────────────────────────────────────────
    if (pathname === "/api/custom-presets" && method === "GET") {
      send(res, 200, readCustomPresets());
      return;
    }
    if (pathname === "/api/custom-presets" && method === "POST") {
      const body = await readBody(req);
      try {
        if (!body.name || !body.systemPrompt) { send(res, 400, { error: "名称和系统提示词不能为空" }); return; }
        let result;
        if (body.id) {
          result = updateCustomPreset(body.id, body);
          if (!result) {
            // ID provided but not found → create with this ID
            result = createCustomPreset({ ...body, forceId: body.id });
          }
        } else {
          result = createCustomPreset(body);
        }
        send(res, 200, { ok: true, preset: result });
      } catch (e) { send(res, 500, { error: "操作失败: " + e.message }); }
      return;
    }
    const customPresetDeleteMatch = pathname.match(/^\/api\/custom-presets\/([^/]+)$/);
    if (customPresetDeleteMatch && method === "DELETE") {
      const ok = deleteCustomPreset(customPresetDeleteMatch[1]);
      send(res, ok ? 200 : 404, ok ? { ok: true } : { error: "智能体不存在" });
      return;
    }

    // ── Clear Model Key ─────────────────────────────────────────────────
    if (pathname === "/api/config/clear-key" && method === "POST") {
      const body = await readBody(req);
      const scope = body.scope || "shared";
      if (scope === "openclaw" || scope === "hermes" || scope === "shared") {
        writeModelConfigForScope(scope, {});
        log(`已清除 ${scope} 的模型配置`);
        send(res, 200, { ok: true, message: "Key 已清除。" });
      } else {
        send(res, 400, { error: "无效的 scope" });
      }
      return;
    }

    // ── Agent Chat (work mode: agent-backed or simple-chat fallback) ────
    // ── Agent Chat SSE Stream ──────────────────────────────────────────
    if (pathname === "/api/agent-chat/stream" && method === "POST") {
      const body = await readBody(req);
      const agentId = body.agentId || targetAgent;
      if (!AGENT_IDS.includes(agentId)) { send(res, 400, { error: `无效的 agentId: ${agentId}` }); return; }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      try {
        const status = await agentStatus(agentId);
        const systemPrompt = String(body.systemPrompt || "").trim();
        const selectedModel = String(body.model || "").trim() || null;
        if (status.running && status.ports && status.ports.port) {
          const agentApiUrl = `http://127.0.0.1:${status.ports.port}/api/chat`;
          const payload = { messages: [{ role: "user", content: String(body.message || "").trim() }] };
          if (systemPrompt) payload.system = systemPrompt;
          if (body.attachments && body.attachments.length) payload.attachments = body.attachments;
          if (selectedModel) payload.model = selectedModel;
          try {
            const agentRes = await fetch(agentApiUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            if (agentRes.ok) {
              const agentData = await agentRes.json();
              const content = agentData.content || agentData.message || agentData.response || JSON.stringify(agentData);
              const current = readSimpleChat(agentId);
              writeSimpleChat(agentId, [...current, { role: "user", content: body.message || "" }, { role: "assistant", content }]);
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
              res.write("data: [DONE]\n\n");
              res.end(); return;
            }
          } catch (e) { log(`${agentId} agent API 调用失败，回退到 simple-chat: ${e.message}`); }
        }
        await runSimpleChatStream(res, agentId, body.message, body.attachments, systemPrompt || null, selectedModel);
      } catch (e) { try { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.end(); } catch {} }
      return;
    }

    // ── Agent Chat (simple) ─────────────────────────────────────────────
    function archiveCurrentChat(agentId) {
      const current = readSimpleChat(agentId);
      if (Array.isArray(current) && current.length > 0) {
        const archivePath = path.join(ROOT, "data", agentId, `simple-chat-archive-${Date.now()}.json`);
        fs.writeFileSync(archivePath, JSON.stringify(current, null, 2));
      }
    }

    if (pathname === "/api/agent-chat" && method === "POST") {
      const body = await readBody(req);
      const agentId = body.agentId || targetAgent;
      if (!AGENT_IDS.includes(agentId)) { send(res, 400, { error: `无效的 agentId: ${agentId}` }); return; }
      try {
        if (body.reset) { archiveCurrentChat(agentId); writeSimpleChat(agentId, []); send(res, 200, { ok: true, message: "历史已重置" }); return; }
        const status = await agentStatus(agentId);
        const systemPrompt = String(body.systemPrompt || "").trim();
        const selectedModel = String(body.model || "").trim() || null;
        if (status.running && status.ports && status.ports.port) {
          const agentApiUrl = `http://127.0.0.1:${status.ports.port}/api/chat`;
          const payload = { messages: [{ role: "user", content: String(body.message || "").trim() }] };
          if (systemPrompt) payload.system = systemPrompt;
          if (body.attachments && body.attachments.length) payload.attachments = body.attachments;
          if (selectedModel) payload.model = selectedModel;
          try {
            const agentRes = await fetch(agentApiUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const agentData = await agentRes.json();
            if (agentRes.ok) {
              const content = agentData.content || agentData.message || agentData.response || JSON.stringify(agentData);
              const current = readSimpleChat(agentId);
              writeSimpleChat(agentId, [...current, { role: "user", content: body.message || "" }, { role: "assistant", content }]);
              send(res, 200, { content, model: "agent" });
              return;
            }
          } catch (e) { log(`${agentId} agent API 调用失败，回退到 simple-chat: ${e.message}`); }
        }
        const result = await runSimpleChat(agentId, body.message, body.attachments, systemPrompt || null, selectedModel);
        send(res, 200, result);
      } catch (e) { send(res, 400, { error: e.message }); }
      return;
    }

    // ── Chat History Sessions ──────────────────────────────────────────
    if (pathname === "/api/chat-sessions" && method === "GET") {
      const agentId = url.searchParams.get("agent") || targetAgent;
      const sessions = listChatSessions(agentId);
      send(res, 200, { sessions });
      return;
    }
    const sessionMatch = pathname.match(/^\/api\/chat-sessions\/([^/]+)$/);
    if (sessionMatch && method === "GET") {
      const agentId = url.searchParams.get("agent") || targetAgent;
      const sessionId = sessionMatch[1];
      const messages = readChatSession(agentId, sessionId);
      if (!messages) { send(res, 404, { error: "会话不存在" }); return; }
      send(res, 200, { messages });
      return;
    }
    if (sessionMatch && method === "DELETE") {
      const agentId = url.searchParams.get("agent") || targetAgent;
      const sessionId = sessionMatch[1];
      const ok = deleteChatSession(agentId, sessionId);
      send(res, ok ? 200 : 404, ok ? { ok: true } : { error: "会话不存在" });
      return;
    }

    // ── Simple Chat History (legacy) ────────────────────────────────────
    if (pathname.startsWith("/simple-chat")) {
      const agentId = url.searchParams.get("agent") || targetAgent;
      if (method === "GET") {
        send(res, 200, { messages: readSimpleChat(agentId) });
      } else if (method === "POST") {
        const body = await readBody(req);
        if (!AGENT_IDS.includes(agentId)) { send(res, 400, { error: `无效的 agentId: ${agentId}` }); return; }
        try {
          if (body.reset) { archiveCurrentChat(agentId); writeSimpleChat(agentId, []); send(res, 200, { ok: true, message: "历史已重置" }); return; }
          const result = await runSimpleChat(agentId, body.message, body.attachments);
          send(res, 200, result);
        } catch (e) { send(res, 400, { error: e.message }); }
      } else {
        send(res, 405, { error: "Method Not Allowed" });
      }
      return;
    }

    // ── Agent API Relays ────────────────────────────────────────────────
    if (pathname.startsWith("/openclaw/api/") || pathname.startsWith("/hermes/api/")) {
      const agentId = pathname.startsWith("/openclaw") ? "openclaw" : "hermes";
      const status = await agentStatus(agentId);
      if (!status.running || !status.ports || !status.ports.port) {
        send(res, 503, { error: `${agentId} 未运行`, status });
        return;
      }
      const apiPath = pathname.replace(`/${agentId}/api`, "/api");
      const targetUrl = `http://127.0.0.1:${status.ports.port}${apiPath}${url.search}`;
      try {
        const proxyRes = await fetch(targetUrl, { method, headers: { "Content-Type": req.headers["content-type"] || "application/json" }, body: method !== "GET" && method !== "HEAD" ? await new Promise((r) => { let d = ""; req.on("data", (c) => d += c); req.on("end", () => r(d || undefined)); }) : undefined });
        const bodyText = await proxyRes.text();
        res.writeHead(proxyRes.status, Object.fromEntries(proxyRes.headers));
        res.end(bodyText);
      } catch (e) {
        send(res, 502, { error: `转发请求失败: ${e.message}` });
      }
      return;
    }

    // ── Agent Dashboard / Root Redirect ─────────────────────────────────
    if (pathname === "/openclaw" || pathname === "/openclaw/") {
      const status = await agentStatus("openclaw");
      if (status.dashboardUrl) { res.writeHead(302, { Location: status.dashboardUrl }); res.end(); return; }
      if (status.url) { res.writeHead(302, { Location: status.url }); res.end(); return; }
      send(res, 200, { status, message: "OpenClaw 未运行或未配置面板。请先启动 OpenClaw。" });
      return;
    }
    if (pathname === "/hermes" || pathname === "/hermes/") {
      const status = await agentStatus("hermes");
      if (status.dashboardUrl) { res.writeHead(302, { Location: status.dashboardUrl }); res.end(); return; }
      if (status.url) { res.writeHead(302, { Location: status.url }); res.end(); return; }
      send(res, 200, { status, message: "Hermes 未运行或未配置面板。请先启动 Hermes。" });
      return;
    }

    // ── Skill Market ────────────────────────────────────────────────────
    if (pathname === "/api/skills/market" && method === "GET") {
      const skillsConfig = readJson(path.join(CONFIG_DIR, "skills-market.json"), { marketUrl: "https://raw.githubusercontent.com/Equality-Machine/skills-market/main/registry/skills.json" });
      const cachePath = path.join(ROOT, "data", "skills", "market-cache.json");
      try {
        const response = await fetch(skillsConfig.marketUrl);
        if (!response.ok) { throw new Error(`远程返回 ${response.status}`); }
        const data = await response.json();
        if (data.skills) {
          for (let i = 0; i < data.skills.length; i += 5) {
            const batch = data.skills.slice(i, i + 5);
            await Promise.all(batch.map(async (skill) => {
              if (!skill.installUrl && skill.source && skill.source.repo && skill.source.path) {
                const repo = skill.source.repo.replace(/\.git$/, "").replace("github.com:", "github.com/");
                const ref = skill.source.ref || "main";
                skill.installUrl = `https://raw.githubusercontent.com/${repo.replace("https://github.com/", "")}/${ref}/${skill.source.path}/SKILL.md`;
              }
            }));
          }
        }
        // Cache locally for offline fallback
        ensureDir(path.dirname(cachePath));
        fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf8");
        send(res, 200, data);
      } catch (e) {
        // Try serving from cache
        const cached = readJson(cachePath, null);
        if (cached) { send(res, 200, cached); return; }
        send(res, 502, { error: `获取远程市场失败: ${e.message}` });
      }
      return;
    }

    if (pathname === "/api/skills/local" && method === "GET") {
      const skillsDir = path.join(ROOT, "data", "skills");
      const installed = readJson(path.join(ROOT, "data", "skills", "installed.json"), { skills: [] });
      // Also include built-in agents from agents.json
      const { agents } = getConfigs();
      const builtIn = Object.entries(agents.agents || {}).map(function(a) {
        return { id: a[0], name: a[1].name, description: "内置 Agent", version: "1.0.0", builtIn: true, disabled: !!a[1].disabled, author: "系统" };
      });
      send(res, 200, { skills: builtIn.concat(installed.skills) });
      return;
    }

    if (pathname === "/api/skills/install" && method === "POST") {
      const body = await readBody(req);
      if (!body || !body.skillId || !body.installUrl) { send(res, 400, { error: "缺少 skillId 或 installUrl" }); return; }
      const skillsDir = path.join(ROOT, "data", "skills");
      ensureDir(skillsDir);
      try {
        // Download the skill content
        const response = await fetch(body.installUrl);
        if (!response.ok) { send(res, 502, { error: `下载技能失败: ${response.status}` }); return; }
        const content = await response.text();
        // Save SKILL.md
        const skillDir = path.join(skillsDir, body.skillId);
        ensureDir(skillDir);
        fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf8");
        // Record in installed.json
        const installed = readJson(path.join(skillsDir, "installed.json"), { skills: [] });
        if (!installed.skills.find(function(s) { return s.id === body.skillId; })) {
          installed.skills.push({ id: body.skillId, name: body.displayName || body.skillId, description: body.description || "", version: body.version || "1.0.0", author: body.author || "未知", installedAt: new Date().toISOString(), disabled: false });
        }
        writeJson(path.join(skillsDir, "installed.json"), installed);
        send(res, 200, { ok: true, message: "技能已安装" });
      } catch (e) { send(res, 500, { error: `安装失败: ${e.message}` }); }
      return;
    }

    if (pathname.startsWith("/api/skills/") && method === "POST") {
      const skillId = pathname.split("/")[4];
      if (!skillId) { send(res, 400, { error: "缺少 skillId" }); return; }
      const action = pathname.split("/")[5];
      if (action === "toggle") {
        const skillsDir = path.join(ROOT, "data", "skills");
        const installed = readJson(path.join(skillsDir, "installed.json"), { skills: [] });
        const skill = installed.skills.find(function(s) { return s.id === skillId; });
        if (!skill) { send(res, 404, { error: "技能未安装" }); return; }
        skill.disabled = !skill.disabled;
        writeJson(path.join(skillsDir, "installed.json"), installed);
        send(res, 200, { ok: true, disabled: skill.disabled });
      } else if (action === "delete") {
        const skillsDir = path.join(ROOT, "data", "skills");
        const installed = readJson(path.join(skillsDir, "installed.json"), { skills: [] });
        const idx = installed.skills.findIndex(function(s) { return s.id === skillId; });
        if (idx >= 0) installed.skills.splice(idx, 1);
        writeJson(path.join(skillsDir, "installed.json"), installed);
        // Remove files
        const skillDir = path.join(skillsDir, skillId);
        try {
          if (fs.existsSync(skillDir)) {
            fs.rmSync(skillDir, { recursive: true, force: true });
          }
        } catch {}
        send(res, 200, { ok: true, message: "技能已删除" });
      } else {
        send(res, 400, { error: "未知操作" });
      }
      return;
    }

    // ── Static Files ────────────────────────────────────────────────────
    let filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
    filePath = path.resolve(filePath);
    if (!filePath.startsWith(PUBLIC_DIR)) { send(res, 403, "禁止访问"); return; }

    if (fileExists(filePath)) {
      const ext = path.extname(filePath);
      if (ext === ".html" || ext === ".js" || ext === ".css" || ext === ".json" || ext === ".svg") {
        let content = fs.readFileSync(filePath, "utf8");
        if (ext === ".html") {
          content = content.replace(/__PORT__/g, String(PORT)).replace(/__AGENT__/g, targetAgent);
        }
        res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-cache" });
        res.end(content);
      } else {
        res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-cache" });
        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }

    // ── Fallback to index.html (SPA) ───────────────────────────────────
    const indexPath = path.join(PUBLIC_DIR, "index.html");
    if (fileExists(indexPath)) {
      const content = fs.readFileSync(indexPath, "utf8").replace(/__PORT__/g, String(PORT)).replace(/__AGENT__/g, targetAgent);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(content);
    } else {
      send(res, 404, { error: "未找到" });
    }
  } catch (e) {
    log(`请求错误: ${e.message}`);
    if (!res.headersSent) send(res, 500, { error: `服务器错误: ${e.message}` });
  }
}

// ── Startup ──────────────────────────────────────────────────────────────

async function start() {
  ensureDir(path.join(ROOT, "config"));
  ensureDir(LAUNCHER_LOG_DIR);

  log("有极智能 Agent 启动器 v2.0");
  log(`根目录: ${ROOT}`);
  log(`平台: ${process.platform} ${process.arch} Node ${process.version}`);

  // Migrate legacy config to channels
  migrateChannels();

  // Keep existing runtime-ports.json for port health check on restart
  // Ports are cleaned only by stopAgent()

  if (PORT === 0) {
    PORT = await findFreePort(3800, 3900);
  }
  log(`HTTP 端口: ${PORT}`);

  // Auto-start target agent (only if model is configured)
  const modelConfig = getModelConfigForAgent(targetAgent);
  if (modelConfig && modelConfig.baseUrl && modelConfig.model) {
    log(`自动启动目标 Agent: ${targetAgent}`);
    const result = await startAgent(targetAgent);
    if (result.ok) {
      log(`${targetAgent} 启动成功`);
    } else {
      log(`${targetAgent} 启动失败: ${result.message}`);
    }
  } else {
    log(`跳过自动启动 ${targetAgent}：未配置模型 API`);
    log('请先在配置页面填写 API Key 和模型名，然后手动启动 Agent。');
  }

  const server = http.createServer(handleRequest);

  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    log(`启动器已就绪: ${url}`);
    if (shouldOpen) openBrowser(url);
  });
}

start().catch((e) => {
  console.error("启动失败:", e);
  process.exit(1);
});
