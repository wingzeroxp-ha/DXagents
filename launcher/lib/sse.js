const AGENT_IDS = require("./env").AGENT_IDS;
const agentStatus = require("./agents").agentStatus;

const clients = new Set();

function sseHandler(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  function sendEvent(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const interval = setInterval(() => {
    const statuses = {};
    for (const id of AGENT_IDS) {
      try { statuses[id] = agentStatus(id); } catch { statuses[id] = { id, installed: false, running: false }; }
    }
    sendEvent("status", statuses);
  }, 2000);

  req.on("close", () => {
    clearInterval(interval);
    clients.delete(req);
  });

  clients.add(req);
}

module.exports = { sseHandler, clients };
