const path = require("path");
const { CONFIG_DIR, AGENT_IDS } = require("./env");
const { readJson, writeJson, ensureDir, log } = require("./utils");

function modelModePath() {
  return path.join(CONFIG_DIR, "model-mode.json");
}

function modelFile(scope) {
  if (scope === "openclaw" || scope === "hermes") return path.join(CONFIG_DIR, `model.${scope}.json`);
  return path.join(CONFIG_DIR, "model.json");
}

function getModelMode() {
  const saved = readJson(modelModePath(), { mode: "shared" });
  return saved.mode === "separate" ? "separate" : "shared";
}

function setModelMode(mode) {
  writeJson(modelModePath(), { mode: mode === "separate" ? "separate" : "shared", updatedAt: new Date().toISOString() });
}

function getConfigs() {
  const portable = readJson(path.join(CONFIG_DIR, "portable.json"), {});
  const permissions = readJson(path.join(CONFIG_DIR, "permissions.json"), {});
  const providers = readJson(path.join(CONFIG_DIR, "providers.json"), { providers: [] });
  const agents = readJson(path.join(CONFIG_DIR, "agents.json"), { agents: {} });
  const modelMode = getModelMode();
  const model = readModelConfigForScope("shared");
  const agentModels = {
    openclaw: getModelConfigForAgent("openclaw"),
    hermes: getModelConfigForAgent("hermes"),
  };
  const runtimePorts = readJson(path.join(CONFIG_DIR, "runtime-ports.json"), {});
  return { portable, permissions, providers, agents, model, modelMode, agentModels, runtimePorts };
}

function getAgent(agentId) {
  const { agents } = getConfigs();
  const agent = agents.agents[agentId];
  if (!agent) throw new Error(`未知 Agent：${agentId}`);
  return agent;
}

function lookupProvider(providerId) {
  const providers = readJson(path.join(CONFIG_DIR, "providers.json"), { providers: [] }).providers || [];
  return providers.find((provider) => provider.id === providerId) || null;
}

function normalizeModelConfig(input = {}, existing = {}) {
  const providerId = String(input.providerId || existing.providerId || "").trim();
  const provider = lookupProvider(providerId);
  const hasBaseUrl = Object.prototype.hasOwnProperty.call(input, "baseUrl");
  const hasModel = Object.prototype.hasOwnProperty.call(input, "model");
  let baseUrl = String(hasBaseUrl ? input.baseUrl || "" : provider?.baseUrl || existing.baseUrl || "").trim();
  let model = String(hasModel ? input.model || "" : provider?.model || existing.model || "").trim();
  const protocol = String(input.protocol || provider?.protocol || existing.protocol || "openai-compatible").trim();
  const apiKey = String(input.apiKey || (providerId === existing.providerId ? existing.apiKey : "") || "").trim();

  if (providerId === "xiaomi-mimo" || providerId === "xiaomi-mimo-api") {
    if (providerId === "xiaomi-mimo") {
      baseUrl = baseUrl || "https://token-plan-cn.xiaomimimo.com/v1";
    }
    model = (model || "mimo-v2.5-pro").toLowerCase();
  }

  return {
    providerId,
    providerName: provider?.name || input.providerName || existing.providerName || "",
    protocol, baseUrl, model, apiKey,
    updatedAt: new Date().toISOString(),
  };
}

function readModelConfigForScope(scope = "shared") {
  return readJson(modelFile(scope), null);
}

function writeModelConfigForScope(scope, config) {
  writeJson(modelFile(scope), config);
}

function maskModelConfig(model) {
  return model ? { ...model, apiKey: model.apiKey ? "********" : "" } : null;
}

/* ── Channels (multi-API support) ────────────────────────── */

function channelsFile() {
  return path.join(CONFIG_DIR, "channels.json");
}

function readChannels() {
  return readJson(channelsFile(), { channels: [], agentChannels: {} });
}

function writeChannels(data) {
  writeJson(channelsFile(), data);
}

function getChannelForAgent(agentId) {
  const data = readChannels();
  const channelId = data.agentChannels[agentId];
  if (!channelId) return null;
  return data.channels.find(function (c) { return c.id === channelId; }) || null;
}

function setChannelForAgent(agentId, channelId) {
  const data = readChannels();
  data.agentChannels[agentId] = channelId || null;
  writeChannels(data);
}

function createChannel(name, config) {
  const data = readChannels();
  var id = "chan-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  data.channels.push({ id: id, name: String(name || "").trim(), ...config });
  writeChannels(data);
  return id;
}

function updateChannel(channelId, config) {
  const data = readChannels();
  const idx = data.channels.findIndex(function (c) { return c.id === channelId; });
  if (idx < 0) return false;
  data.channels[idx] = { ...data.channels[idx], ...config, id: channelId };
  writeChannels(data);
  return true;
}

function deleteChannel(channelId) {
  const data = readChannels();
  data.channels = data.channels.filter(function (c) { return c.id !== channelId; });
  for (const agent of Object.keys(data.agentChannels)) {
    if (data.agentChannels[agent] === channelId) {
      data.agentChannels[agent] = null;
    }
  }
  writeChannels(data);
}

function migrateChannels() {
  const data = readChannels();
  if (data.channels.length > 0) return; // already migrated
  const configs = getConfigs();
  var migrated = false;
  for (var i = 0; i < AGENT_IDS.length; i++) {
    var agentId = AGENT_IDS[i];
    var model = configs.agentModels[agentId];
    if (model && model.apiKey) {
      var id = createChannel(agentId === "openclaw" ? "OpenClaw" : "Hermes", model);
      setChannelForAgent(agentId, id);
      migrated = true;
    }
  }
  if (migrated) log("已迁移旧配置到通道系统");
}

function getProviderModels(providerId) {
  const provider = lookupProvider(providerId);
  return provider && Array.isArray(provider.models) ? provider.models : [];
}

function findProviderByModelId(modelId) {
  const providers = readJson(path.join(CONFIG_DIR, "providers.json"), { providers: [] }).providers || [];
  for (const p of providers) {
    if (p.models && p.models.some((m) => m.id === modelId)) return p;
  }
  return null;
}

/* ── Custom Presets ────────────────────────────────────────── */

function customPresetsFile() {
  return path.join(CONFIG_DIR, "custom-presets.json");
}

function readCustomPresets() {
  return readJson(customPresetsFile(), { presets: [] });
}

function writeCustomPresets(data) {
  writeJson(customPresetsFile(), data);
}

function createCustomPreset(data) {
  const all = readCustomPresets();
  const preset = {
    id: data.forceId || ("custom-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6)),
    name: String(data.name || "").trim(),
    description: String(data.description || "").trim(),
    icon: data.icon || "🤖",
    systemPrompt: String(data.systemPrompt || "").trim(),
    skills: Array.isArray(data.skills) ? data.skills : [],
    modelId: data.modelId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  all.presets.push(preset);
  writeCustomPresets(all);
  return preset;
}

function updateCustomPreset(id, data) {
  const all = readCustomPresets();
  const idx = all.presets.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const existing = all.presets[idx];
  all.presets[idx] = {
    ...existing,
    name: data.name !== undefined ? String(data.name).trim() : existing.name,
    description: data.description !== undefined ? String(data.description).trim() : existing.description,
    icon: data.icon !== undefined ? data.icon : existing.icon,
    systemPrompt: data.systemPrompt !== undefined ? String(data.systemPrompt).trim() : existing.systemPrompt,
    skills: data.skills !== undefined ? data.skills : existing.skills,
    modelId: data.modelId !== undefined ? data.modelId : existing.modelId,
    updatedAt: new Date().toISOString(),
  };
  writeCustomPresets(all);
  return all.presets[idx];
}

function deleteCustomPreset(id) {
  const all = readCustomPresets();
  const idx = all.presets.findIndex((p) => p.id === id);
  if (idx < 0) return false;
  all.presets.splice(idx, 1);
  writeCustomPresets(all);
  return true;
}

function getModelConfigForAgent(agentId, specificModel) {
  // Channel support: if agent has a channel assigned, use it
  var channel = getChannelForAgent(agentId);
  if (channel) {
    return {
      providerId: channel.providerId,
      providerName: channel.providerName,
      protocol: channel.protocol || "openai-compatible",
      baseUrl: channel.baseUrl,
      model: specificModel || channel.model || (channel.models && channel.models.length ? channel.models[0] : ""),
      apiKey: channel.apiKey,
    };
  }
  // Fallback to legacy file-based config
  if (getModelMode() === "separate") {
    return readModelConfigForScope(agentId) || readModelConfigForScope("shared");
  }
  return readModelConfigForScope("shared");
}

module.exports = {
  getConfigs, getAgent, lookupProvider, normalizeModelConfig,
  readModelConfigForScope, getModelConfigForAgent, writeModelConfigForScope,
  maskModelConfig, getModelMode, setModelMode, modelFile,
  readChannels, writeChannels, getChannelForAgent, setChannelForAgent,
  createChannel, updateChannel, deleteChannel, migrateChannels,
  getProviderModels, findProviderByModelId,
  readCustomPresets, writeCustomPresets, createCustomPreset, updateCustomPreset, deleteCustomPreset,
};
