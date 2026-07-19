const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { ROOT, HOST, LAUNCHER_LOG_DIR } = require("./env");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  var tmp = file + ".tmp." + process.pid;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function fileExists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function safeJoin(relativePath) {
  const resolved = path.resolve(ROOT, relativePath);
  if (!resolved.startsWith(ROOT)) {
    throw new Error(`路径越界：${relativePath}`);
  }
  return resolved;
}

function relPath(...parts) {
  return path.join(ROOT, ...parts);
}

function yamlQuote(value) {
  return JSON.stringify(String(value || ""));
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function send(res, statusCode, body, type = "application/json; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  if (type.startsWith("application/json")) {
    res.end(JSON.stringify(body, null, 2));
  } else {
    res.end(body);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function isPortFree(port, host = HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findFreePort(start, end, host = HOST) {
  for (let port = start; port <= end; port += 1) {
    if (await isPortFree(port, host)) return port;
  }
  throw new Error(`没有可用端口：${start}-${end}`);
}

function openBrowser(url) {
  const platform = process.platform;
  let command, cmdArgs;
  if (platform === "win32") {
    command = "cmd.exe";
    cmdArgs = ["/c", "start", "", url];
  } else if (platform === "darwin") {
    command = "open";
    cmdArgs = [url];
  } else {
    command = "xdg-open";
    cmdArgs = [url];
  }
  const child = spawn(command, cmdArgs, { detached: true, stdio: "ignore" });
  child.unref();
}

function log(message) {
  try { fs.mkdirSync(LAUNCHER_LOG_DIR, { recursive: true }); } catch {}
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { fs.appendFileSync(path.join(LAUNCHER_LOG_DIR, "launcher.log"), line, "utf8"); } catch {}
  console.log(message);
}

function tailFile(file, maxBytes = 64000) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

module.exports = {
  ensureDir, readJson, writeJson, fileExists, safeJoin, relPath,
  yamlQuote, contentType, send, readBody, isPortFree, findFreePort,
  openBrowser, tailFile, log,
};
