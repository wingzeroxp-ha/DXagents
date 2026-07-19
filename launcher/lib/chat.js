const path = require("path");
const { spawn, execFile } = require("child_process");
const { ROOT, AGENT_IDS, activeChildren } = require("./env");
const { readJson, writeJson, fileExists, safeJoin, readBody, send } = require("./utils");

const chatHistories = {};

const SYSTEM_PROMPTS = {
  openclaw: "你是小石智能助手OpenClaw。你是一个全能AI助手，使用OpenClaw框架运行。请用中文回答，保持专业而友好的语气。",
  hermes: "你是小石智能助手Hermes-Agent。你是一个任务规划与执行AI，负责将复杂任务分解为可执行的步骤。请用中文回答。",
};


function routeChatRequest(chatConfig) {
  const { providerId, apiKey, model, baseUrl = "https://api.openai.com/v1" } = chatConfig;
  if (providerId === "openai") {
    return { baseUrl: baseUrl || "https://api.openai.com/v1", apiKey, model: model || "gpt-4o" };
  }
  if (baseUrl !== "https://api.openai.com/v1") {
    return { baseUrl, apiKey, model };
  }
  return { baseUrl: "https://api.openai.com/v1", apiKey, model: model || "gpt-4o" };
}

async function chatCompletion(agentId, configs, body, res) {
  const modelConfig = configs.agentModels[agentId];
  if (!modelConfig || !modelConfig.apiKey) {
    send(res, 400, { error: `Agent ${agentId} 未配置 API Key。请在设置页面配置后再使用。` });
    return;
  }

  const cacheDir = safeJoin(`data/${agentId}/workspace`);
  let modelName = modelConfig.model || "gpt-4o";

  const openClawConfigPath = path.join(ROOT, "data", agentId, "home", ".openclaw", "config.json");
  if (fileExists(openClawConfigPath)) {
    const ocConfig = readJson(openClawConfigPath, {});
    if (ocConfig.model) modelName = ocConfig.model;
  }

  const langConfigPath = path.join(ROOT, "config", "language.json");
  const langConfig = readJson(langConfigPath, {});
  const lang = langConfig[agentId] || "auto";

  const { baseUrl, apiKey } = routeChatRequest(modelConfig);

  const messages = body.messages || [];
  const stream = body.stream !== false;

  const historyKey = `${agentId}`;
  if (!chatHistories[historyKey]) chatHistories[historyKey] = [];
  if (body.reset) { chatHistories[historyKey] = []; }

  const systemPrompt = SYSTEM_PROMPTS[agentId] || SYSTEM_PROMPTS.openclaw;
  const langPrompt = lang === "en" ? "\nPlease respond in English." : lang === "zh" ? "\n请用中文回答。" : "";

  const apiMessages = [
    { role: "system", content: systemPrompt + langPrompt + `\n当前使用模型: ${modelName}\n当前时间: ${new Date().toLocaleString("zh-CN")}` },
    ...chatHistories[historyKey].slice(-50),
    ...messages,
  ];

  const requestBody = {
    model: modelName,
    messages: apiMessages,
    temperature: body.temperature ?? 0.7,
    max_tokens: body.max_tokens ?? 4096,
    stream,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    if (stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      const fetchResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!fetchResponse.ok) {
        const errText = await fetchResponse.text();
        res.write(`data: ${JSON.stringify({ error: `API 错误 ${fetchResponse.status}: ${errText}` })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
        return;
      }

      const reader = fetchResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try { JSON.parse(data); } catch { continue; }
            res.write(`${line}\n\n`);
          }
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();

      chatHistories[historyKey].push(...messages);
    } else {
      const fetchResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(Object.assign({}, requestBody, { stream: false })),
        signal: controller.signal,
      });

      if (!fetchResponse.ok) {
        const errText = await fetchResponse.text();
        send(res, fetchResponse.status, { error: `API 错误 ${fetchResponse.status}: ${errText}` });
        return;
      }

      const data = await fetchResponse.json();
      send(res, 200, data);
      chatHistories[historyKey].push(...messages);
    }
  } catch (e) {
    if (e.name === "AbortError") {
      send(res, 504, { error: "请求超时 (300s)" });
    } else {
      send(res, 500, { error: `请求失败: ${e.message}` });
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function chatRelay(configs, req, res) {
  const body = await readBody(req);
  const targetAgent = body.agentId || AGENT_IDS[0];
  if (!AGENT_IDS.includes(targetAgent)) {
    send(res, 400, { error: `无效的 agentId: ${targetAgent}` });
    return;
  }
  await chatCompletion(targetAgent, configs, body, res);
}

module.exports = { chatCompletion, chatRelay };
