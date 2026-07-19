window.state = {
  config: null,
  selectedAgent: new URLSearchParams(location.search).get("agent") || "openclaw",
  modelScope: "shared",
  simpleChat: { openclaw: [], hermes: [] },
  simpleChatAttachments: { openclaw: [], hermes: [] },
};

var state = window.state;
var $ = function (id) { return document.getElementById(id); };

async function api(path, options) {
  options = options || {};
  var headers = { "Content-Type": "application/json" };
  var fetchOptions = { headers: headers, ...options };
  if (!fetchOptions.method) fetchOptions.method = "POST";
  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    fetchOptions.body = JSON.stringify(options.body);
  }
  var response = await fetch(path, fetchOptions);
  var data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || "请求失败");
  return data;
}

function badgeClass(agent) {
  if (!agent.installed) return "bad";
  if (agent.running) return "good";
  return "warn";
}

function renderAgents() {
  var cards = $("agentCards");
  cards.innerHTML = "";
  for (var i = 0; i < state.config.agents.length; i++) {
    var agent = state.config.agents[i];
    var isCurrent = agent.id === state.selectedAgent;
    cards.innerHTML +=
      '<article class="agent-card fade-in">' +
      '<div class="agent-top">' +
      '<div><div class="agent-name">' + escapeHtml(agent.name) + (isCurrent ? "，当前" : "") + '</div>' +
      '<div class="agent-message">' + escapeHtml(agent.message) + '</div></div>' +
      '<span class="badge ' + badgeClass(agent) + '">' + (agent.running ? "运行中" : agent.installed ? "未运行" : "未安装") + '</span>' +
      "</div>" +
      '<div class="button-row">' +
      '<button data-action="start" data-agent="' + agent.id + '"' + (agent.running ? " disabled" : "") + '>启动 ' + escapeHtml(agent.name) + '</button>' +
      '<button data-action="simple-chat" data-agent="' + agent.id + '">简易对话</button>' +
      '<button data-action="stop" data-agent="' + agent.id + '"' + (agent.running ? "" : " disabled") + '>停止</button>' +
      '<button data-action="open" data-agent="' + agent.id + '"' + (agent.running && agent.url ? "" : " disabled") + '>打开</button>' +
      '<button data-action="dashboard" data-agent="' + agent.id + '"' + (agent.running && agent.dashboardUrl ? "" : " disabled") + '>管理页</button>' +
      '<button data-action="log" data-agent="' + agent.id + '">日志</button>' +
      "</div>" +
      '<p class="agent-message">' + (agent.startScript ? "便携脚本：" + escapeHtml(agent.startScript) : "当前系统没有适配脚本") + "</p>" +
      "</article>";
  }
}

function renderProviderOptions() {
  var select = $("providerSelect");
  var currentValue = select.value;
  select.innerHTML = "";
  for (var i = 0; i < state.config.providers.length; i++) {
    var provider = state.config.providers[i];
    var option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.name;
    option.dataset.baseUrl = provider.baseUrl || "";
    option.dataset.model = provider.model || "";
    option.dataset.protocol = provider.protocol || "openai-compatible";
    option.dataset.keyLabel = provider.keyLabel || "API Key / Token";
    select.appendChild(option);
  }
  if (currentValue) select.value = currentValue;
}

function fillProvider(providerId) {
  var provider = null;
  for (var i = 0; i < state.config.providers.length; i++) {
    if (state.config.providers[i].id === providerId) { provider = state.config.providers[i]; break; }
  }
  if (!provider) provider = state.config.providers[0];
  if (!provider) return;
  $("providerSelect").value = provider.id;
  $("baseUrl").value = provider.baseUrl || "";
  $("modelName").value = provider.model || "";
  $("apiKey").placeholder = provider.keyLabel || "API Key / Token";
}

function modelForScope(scope) {
  if (scope === "openclaw" || scope === "hermes") return state.config.agentModels && state.config.agentModels[scope];
  return state.config.model;
}

function fillModelForm(scope) {
  state.modelScope = scope;
  $("modelScope").value = scope;
  var model = modelForScope(scope);
  if (model) {
    fillProvider(model.providerId);
    $("baseUrl").value = model.baseUrl || "";
    $("modelName").value = model.model || "";
  } else {
    fillProvider($("providerSelect").value);
  }
  $("apiKey").value = "";
}

function renderModelSummary() {
  var mode = state.config.modelMode === "separate" ? "分开配置" : "共用配置";
  var openclaw = state.config.agentModels && state.config.agentModels.openclaw;
  var hermes = state.config.agentModels && state.config.agentModels.hermes;
  function label(m) {
    return m ? (m.providerName || m.providerId) + " / " + (m.model || "未填写") + " / " + (m.protocol === "anthropic" ? "Anthropic 标准" : "OpenAI 兼容") : "未配置";
  }
  $("modelSummary").textContent = "当前模式：" + mode + "\nOpenClaw：" + label(openclaw) + "\nHermes：" + label(hermes);
}

function renderConfig() {
  $("rootPath").textContent = state.config.root || state.config.portable && state.config.portable.root || "";
  $("agentSelect").value = state.selectedAgent;
  var current = null;
  for (var i = 0; i < state.config.agents.length; i++) {
    if (state.config.agents[i].id === state.selectedAgent) { current = state.config.agents[i]; break; }
  }
  $("currentTitle").textContent = current ? current.name + " 控制台" : "有极智能Agent";
  $("currentSub").textContent = current ? current.message : "当前选择的 Agent";
  $("configState").textContent = state.config.model ? "已配置模型" : "未配置模型";
  $("configState").className = "status-pill " + (state.config.model ? "ready" : "pending");

  var editingModelForm = $("modelForm").contains(document.activeElement);
  if (!editingModelForm) {
    renderProviderOptions();
    fillModelForm(state.modelScope);
  }
  renderModelSummary();

  var mode = state.config.permissions && state.config.permissions.mode ? state.config.permissions.mode : "safe";
  var radio = document.querySelector('input[name="permissionMode"][value="' + mode + '"]');
  if (radio) radio.checked = true;

  renderAgents();
  renderSimpleChats();
  renderChatControls();
}

function renderChatControls() {
  var buttons = document.querySelectorAll("[data-chat-action]");
  for (var i = 0; i < buttons.length; i++) {
    var button = buttons[i];
    var agent = null;
    for (var j = 0; j < state.config.agents.length; j++) {
      if (state.config.agents[j].id === button.dataset.agent) { agent = state.config.agents[j]; break; }
    }
    if (!agent) { button.disabled = true; continue; }
    var action = button.dataset.chatAction;
    if (action === "start") button.disabled = agent.running || !agent.installed;
    if (action === "stop") button.disabled = !agent.running;
    if (action === "open") button.disabled = !agent.running || !agent.url;
    if (action === "dashboard") button.disabled = !agent.running || !agent.dashboardUrl;
  }
}

async function refresh() {
  try {
    state.config = await api("/api/config", { method: "GET" });
    if (state.config.agents && !Array.isArray(state.config.agents)) {
      var arr = [];
      for (var key in state.config.agents.agents) {
        if (state.config.agents.agents.hasOwnProperty(key)) {
          var a = state.config.agents.agents[key];
          var s = state.config.status && state.config.status[key];
          arr.push(s || { id: key, name: a.name || key, installed: true, running: false, startScript: null, url: null, dashboardUrl: null, message: "" });
        }
      }
      state.config.agents = arr;
    }
    // Merge status info into agents
    if (state.config.status) {
      for (var i = 0; i < state.config.agents.length; i++) {
        var sid = state.config.agents[i].id;
        if (state.config.status[sid]) {
          for (var k in state.config.status[sid]) {
            if (state.config.status[sid].hasOwnProperty(k)) {
              state.config.agents[i][k] = state.config.status[sid][k];
            }
          }
        }
      }
    }
    if (!state.selectedAgent || !["openclaw", "hermes"].includes(state.selectedAgent)) {
      state.selectedAgent = "openclaw";
    }
    renderConfig();
    await loadSimpleChats();
  } catch (e) {
    console.error("refresh error:", e);
  }
}

function agentDisplayName(agentId) {
  return agentId === "hermes" ? "Hermes" : "OpenClaw";
}

function suffix(agentId) {
  return agentId === "hermes" ? "Hermes" : "Openclaw";
}

function inputId(agentId) { return "simpleChatInput" + suffix(agentId); }
function resultId(agentId) { return "simpleChatResult" + suffix(agentId); }
function messagesId(agentId) { return "simpleChatMessages" + suffix(agentId); }
function filesId(agentId) { return "simpleChatFiles" + suffix(agentId); }
function attachmentsId(agentId) { return "simpleChatAttachments" + suffix(agentId); }

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderSimpleChat(agentId) {
  var messages = state.simpleChat[agentId] || [];
  var box = $(messagesId(agentId));
  if (!messages.length) {
    box.innerHTML = '<div class="chat-empty">还没有消息。</div>';
    return;
  }
  var html = "";
  for (var i = 0; i < messages.length; i++) {
    var message = messages[i];
    var role = message.role === "user" ? "user" : "assistant";
    var label = role === "user" ? "你" : agentDisplayName(agentId);
    var content = typeof message.content === "string" ? message.content : (message.content && Array.isArray(message.content) ? message.content.map(function (p) { return typeof p === "string" ? p : p.text || ""; }).join(" ") : "");
    var renderedContent = window.renderContent ? window.renderContent(content) : escapeHtml(content);
    var attHtml = "";
    if (message.attachments && message.attachments.length) {
      var names = [];
      for (var j = 0; j < message.attachments.length; j++) names.push(message.attachments[j].name);
      attHtml = '<div class="chat-attachments">附件：' + escapeHtml(names.join("、")) + "</div>";
    }
    html +=
      '<div class="chat-message ' + role + ' fade-in">' +
      '<div class="chat-role">' + label + '</div>' +
      '<div class="chat-bubble">' + renderedContent + attHtml + '</div>' +
      "</div>";
  }
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}

function renderSimpleChats() {
  renderSimpleChat("openclaw");
  renderSimpleChat("hermes");
  renderAttachmentList("openclaw");
  renderAttachmentList("hermes");
}

function renderAttachmentList(agentId) {
  var box = $(attachmentsId(agentId));
  var attachments = state.simpleChatAttachments[agentId] || [];
  html = "";
  for (var i = 0; i < attachments.length; i++) {
    var item = attachments[i];
    html +=
      '<span class="attachment-chip">' +
      escapeHtml(item.kind === "image" ? "图片" : "文件") + "：" + escapeHtml(item.name) +
      '<button type="button" data-remove-attachment="' + agentId + '" data-attachment-index="' + i + '">×</button>' +
      "</span>";
  }
  box.innerHTML = html;
}

function isTextFile(file) {
  var name = file.name.toLowerCase();
  var textExts = [".txt", ".md", ".json", ".csv", ".log", ".xml", ".html", ".js", ".ts", ".py", ".java", ".go", ".rs", ".c", ".cpp", ".h", ".css"];
  if (file.type.startsWith("text/")) return true;
  for (var i = 0; i < textExts.length; i++) { if (name.endsWith(textExts[i])) return true; }
  return false;
}

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || "")); };
    reader.onerror = function () { reject(reader.error || new Error("读取文件失败")); };
    reader.readAsDataURL(file);
  });
}

async function fileToAttachment(file) {
  if (file.size > 2_000_000) throw new Error(file.name + " 超过 2MB，请换小一点的文件。");
  if (file.type.startsWith("image/")) {
    return { kind: "image", name: file.name, type: file.type, size: file.size, dataUrl: await readFileAsDataUrl(file) };
  }
  if (isTextFile(file)) {
    return { kind: "text", name: file.name, type: file.type || "text/plain", size: file.size, text: (await file.text()).slice(0, 120000) };
  }
  throw new Error(file.name + " 暂不支持，请使用图片或文本类文件。");
}

async function addChatFiles(agentId, files) {
  var current = state.simpleChatAttachments[agentId] || [];
  var incoming = Array.from(files || []);
  if (current.length + incoming.length > 4) throw new Error("一次最多添加 4 个附件。");
  var next = current.slice();
  for (var i = 0; i < incoming.length; i++) {
    next.push(await fileToAttachment(incoming[i]));
  }
  state.simpleChatAttachments[agentId] = next;
  renderAttachmentList(agentId);
}

async function sendSimpleChat(agentId) {
  var input = $(inputId(agentId));
  var message = input.value.trim();
  var attachments = state.simpleChatAttachments[agentId] || [];
  if (!message && !attachments.length) return;
  input.value = "";
  state.simpleChatAttachments[agentId] = [];
  $(filesId(agentId)).value = "";
  renderAttachmentList(agentId);
  $(resultId(agentId)).textContent = "正在回复...";
  state.simpleChat[agentId] = (state.simpleChat[agentId] || []).concat([
    { role: "user", content: message || "请分析附件。", attachments: attachments.map(function (item) { return { name: item.name, kind: item.kind }; }) }
  ]);
  renderSimpleChat(agentId);
  try {
    var result = await api("/simple-chat?agent=" + agentId, { body: { message: message, attachments: attachments } });
    state.simpleChat[agentId] = (state.simpleChat[agentId] || []).concat([
      { role: "assistant", content: result.content }
    ]);
    $(resultId(agentId)).textContent = "";
    if (window.showToast) showToast("回复完成", "success", 2000);
  } catch (error) {
    state.simpleChatAttachments[agentId] = attachments;
    renderAttachmentList(agentId);
    $(resultId(agentId)).textContent = "发送失败：" + error.message;
    if (window.showToast) showToast("发送失败：" + error.message, "error");
  }
  renderSimpleChat(agentId);
}

async function loadSimpleChat(agentId) {
  try {
    var result = await api("/simple-chat?agent=" + agentId, { method: "GET" });
    state.simpleChat[agentId] = result.messages || [];
    renderSimpleChat(agentId);
  } catch (e) { /* silent */ }
}

async function loadSimpleChats() {
  await loadSimpleChat("openclaw");
  await loadSimpleChat("hermes");
}

async function clearSimpleChat(agentId) {
  if (!confirm("确认清空 " + agentDisplayName(agentId) + " 的简易对话记录？")) return;
  await api("/simple-chat?agent=" + agentId, { body: { reset: true } });
  state.simpleChat[agentId] = [];
  $(resultId(agentId)).textContent = "记录已清空。";
  renderSimpleChat(agentId);
}

function selectedProvider() {
  var select = $("providerSelect");
  for (var i = 0; i < state.config.providers.length; i++) {
    if (state.config.providers[i].id === select.value) return state.config.providers[i];
  }
  return null;
}

async function saveModelConfig(testOnly) {
  var provider = selectedProvider();
  var payload = {
    scope: state.modelScope,
    providerId: provider ? provider.id : "",
    providerName: provider ? provider.name : "",
    protocol: provider ? provider.protocol || "openai-compatible" : "openai-compatible",
    baseUrl: $("baseUrl").value.trim(),
    model: $("modelName").value.trim(),
    apiKey: $("apiKey").value.trim(),
    lastAgent: state.selectedAgent,
  };

  if (testOnly) {
    $("modelResult").textContent = "正在测试连接...";
    try {
      var result = await api("/api/test-provider", { body: payload });
      $("modelResult").textContent = result.ok ? "连接成功。" : "连接失败：" + result.message;
      if (result.ok && window.showToast) showToast("连接成功", "success");
    } catch (e) {
      $("modelResult").textContent = "测试失败：" + e.message;
    }
    return;
  }

  try {
    await api("/api/config", { body: payload });
  } catch (e) {
    // Also accept model-specific save via agent config endpoint
    if (payload.scope === "openclaw" || payload.scope === "hermes") {
      await api("/api/agent/" + payload.scope + "/config", { body: payload });
    } else {
      throw e;
    }
  }
  $("apiKey").value = "";
  $("modelResult").textContent = "配置已保存。";
  if (window.showToast) showToast("配置已保存", "success");
  await refresh();
}

async function savePermissions() {
  var mode = document.querySelector('input[name="permissionMode"]:checked').value;
  await api("/api/config", { body: { permissions: { mode: mode } } });
  $("permissionResult").textContent = "权限设置已保存。";
  if (window.showToast) showToast("权限已保存", "success");
  await refresh();
}

async function runDiagnostics() {
  $("diagnostics").textContent = "正在检测...";
  var result = await api("/api/diagnostics", { method: "GET" });
  $("diagnostics").textContent = JSON.stringify(result, null, 2);
}

async function backupData() {
  $("maintenanceResult").textContent = "正在备份...";
  try {
    var result = await api("/api/backup", { method: "POST" });
    $("maintenanceResult").textContent = "备份完成：" + result.backupPath;
    if (window.showToast) showToast("备份完成", "success");
  } catch (e) {
    $("maintenanceResult").textContent = "备份失败：" + e.message;
    if (window.showToast) showToast("备份失败：" + e.message, "error");
  }
}

async function cleanCache() {
  if (!confirm("确认清理 OpenClaw 和 Hermes 的 npm 缓存？用户配置、记忆和 workspace 不会删除。")) return;
  $("maintenanceResult").textContent = "正在清理缓存...";
  await api("/api/clean-cache", { method: "POST" });
  $("maintenanceResult").textContent = "缓存已清理。";
  if (window.showToast) showToast("缓存已清理", "success");
}

async function refreshUpdateStatus() {
  try {
    var status = await api("/api/update", { method: "GET" });
    $("updateStatus").textContent =
      "网络：官方更新需要网络支持\n" +
      "平台：" + (status.platform || "未知") + "\n" +
      "当前版本：" + (status.currentVersion || "1.0.0");
  } catch (e) {
    $("updateStatus").textContent = "更新状态读取失败：" + e.message;
  }
}

async function restoreBackup() {
  if (!confirm("确认使用最新备份还原？还原会先停止两个 Agent，并恢复配置、数据、Agent 和启动器。")) return;
  $("maintenanceResult").textContent = "正在还原最新备份，请不要拔出 U 盘...";
  try {
    var result = await api("/api/restore", { method: "POST" });
    $("maintenanceResult").textContent = result.message + "\n还原来源：" + result.restoredFrom;
    if (window.showToast) showToast("还原完成", "success");
  } catch (e) {
    $("maintenanceResult").textContent = "还原失败：" + e.message;
    if (window.showToast) showToast("还原失败：" + e.message, "error");
  }
}

// ── Agent Actions ────────────────────────────────────────────────────────

async function agentAction(action, agentId) {
  if (action === "start") {
    $("maintenanceResult").textContent = "";
    var result = await api("/api/agent/" + agentId + "/start", { method: "POST" });
    if (!result.ok) { if (window.showToast) showToast(result.message || "启动失败", "error"); throw new Error(result.message); }
    if (window.showToast) showToast(agentDisplayName(agentId) + " 已启动", "success");
  }
  if (action === "stop") {
    await api("/api/agent/" + agentId + "/stop", { method: "POST" });
    if (window.showToast) showToast(agentDisplayName(agentId) + " 已停止", "info");
  }
  if (action === "open" || action === "dashboard") {
    var agent = null;
    for (var i = 0; i < state.config.agents.length; i++) {
      if (state.config.agents[i].id === agentId) { agent = state.config.agents[i]; break; }
    }
    if (!agent) return;
    var url = action === "dashboard" ? (agent.dashboardUrl || agent.url) : (agent.url || agent.dashboardUrl);
    if (url) window.open(url, "_blank");
  }
  if (action === "simple-chat") {
    state.selectedAgent = agentId;
    $("agentSelect").value = agentId;
    history.replaceState(null, "", "?agent=" + state.selectedAgent);
    renderConfig();
    await loadSimpleChats();
    $("simpleChat").scrollIntoView({ behavior: "smooth", block: "start" });
    $(inputId(agentId)).focus();
  }
  if (action === "log") {
    var result = await api("/api/agent/" + agentId + "/logs", { method: "GET" });
    $("logTitle").textContent = agentDisplayName(agentId) + " 日志";
    $("logBody").textContent = result.log || "暂时没有日志。";
    $("logDialog").showModal();
  }
  await refresh();
}

// ── Event Listeners ────────────────────────────────────────

document.addEventListener("click", async function (event) {
  var button = event.target.closest("button[data-action]");
  if (!button) return;
  button.disabled = true;
  try {
    await agentAction(button.dataset.action, button.dataset.agent);
  } catch (error) {
    if (window.showToast) showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("agentSelect").addEventListener("change", async function (event) {
  state.selectedAgent = event.target.value;
  history.replaceState(null, "", "?agent=" + state.selectedAgent);
  renderConfig();
  await loadSimpleChats();
});

$("modelScope").addEventListener("change", function (event) {
  fillModelForm(event.target.value);
  renderModelSummary();
});

$("providerSelect").addEventListener("change", function (event) { fillProvider(event.target.value); });

$("modelForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  try { await saveModelConfig(false); } catch (error) { $("modelResult").textContent = "保存失败：" + error.message; }
});

$("testProvider").addEventListener("click", async function () {
  try { await saveModelConfig(true); } catch (error) { $("modelResult").textContent = "测试失败：" + error.message; }
});

$("savePermissions").addEventListener("click", async function () {
  try { await savePermissions(); } catch (error) { $("permissionResult").textContent = "保存失败：" + error.message; }
});

$("runDiagnostics").addEventListener("click", runDiagnostics);

$("backupData").addEventListener("click", function () { backupData().catch(function (e) { $("maintenanceResult").textContent = e.message; }); });
$("restoreBackup").addEventListener("click", function () { restoreBackup().catch(function (e) { $("maintenanceResult").textContent = e.message; }); });
$("cleanCache").addEventListener("click", function () { cleanCache().catch(function (e) { $("maintenanceResult").textContent = e.message; }); });
$("closeLog").addEventListener("click", function () { $("logDialog").close(); });

var chatForms = document.querySelectorAll("[data-chat-form]");
for (var i = 0; i < chatForms.length; i++) {
  (function (form) {
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      await sendSimpleChat(form.dataset.chatForm);
    });
  })(chatForms[i]);
}

var chatInputs = document.querySelectorAll("[data-chat-input]");
for (var i = 0; i < chatInputs.length; i++) {
  (function (input) {
    input.addEventListener("keydown", async function (event) {
      if (event.key === "Enter" && event.ctrlKey) {
        event.preventDefault();
        await sendSimpleChat(input.dataset.chatInput);
      }
    });
  })(chatInputs[i]);
}

var fileInputs = document.querySelectorAll("[data-chat-files]");
for (var i = 0; i < fileInputs.length; i++) {
  (function (input) {
    input.addEventListener("change", async function () {
      var agentId = input.dataset.chatFiles;
      try {
        await addChatFiles(agentId, input.files);
        input.value = "";
        $(resultId(agentId)).textContent = "";
      } catch (error) {
        input.value = "";
        $(resultId(agentId)).textContent = "附件添加失败：" + error.message;
      }
    });
  })(fileInputs[i]);
}

var clearButtons = document.querySelectorAll("[data-clear-chat]");
for (var i = 0; i < clearButtons.length; i++) {
  (function (button) {
    button.addEventListener("click", function () {
      clearSimpleChat(button.dataset.clearChat).catch(function (error) { $(resultId(button.dataset.clearChat)).textContent = error.message; });
    });
  })(clearButtons[i]);
}

document.addEventListener("click", function (event) {
  var button = event.target.closest("button[data-remove-attachment]");
  if (!button) return;
  var agentId = button.dataset.removeAttachment;
  var index = Number(button.dataset.attachmentIndex);
  state.simpleChatAttachments[agentId] = (state.simpleChatAttachments[agentId] || []).filter(function (_, i) { return i !== index; });
  renderAttachmentList(agentId);
});

window.refreshAll = refresh;

// ── Init ──────────────────────────────────────────────────────────────────

refresh().catch(function (error) {
  document.body.innerHTML = '<main class="layout"><section class="panel"><h1>启动器加载失败</h1><p>' + escapeHtml(error.message) + '</p></section></main>';
});

refreshUpdateStatus().catch(function (error) {
  $("updateStatus").textContent = "更新状态读取失败：" + error.message;
});

setInterval(refresh, 5000);
