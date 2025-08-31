// server.js (CommonJS)

const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");

// ---------- Env ----------
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;                 // Auth for Apps Script -> Railway
const LETTA_BASE_URL = process.env.LETTA_BASE_URL;   // e.g., https://<your-letta-host>/api
const LETTA_TOKEN = process.env.LETTA_TOKEN;         // Bearer token for Letta
const DEFAULT_AGENT = process.env.SLEEP_AGENT_ID;    // Optional fallback agent id
const CALL_BODY_STYLE = (process.env.CALL_BODY_STYLE || "1").trim();
// Optional: comma-separated list overrides default paths
// e.g. "/v1/agents/:id/call,/v1/agents/call"
const LETTA_PATHS = (process.env.LETTA_PATHS || "").trim();
const TIMEOUT_MS = +(process.env.UPSTREAM_TIMEOUT_MS || 8000);

// ---------- App ----------
const app = express();
app.use(bodyParser.json());

// ---------- Utils ----------
function tryJson(s) { try { return JSON.parse(s); } catch { return null; } }

// Try multiple upstream paths until one works or all fail
async function tryPostPaths(baseUrl, token, agentId, payload, paths) {
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  const attempts = [];

  for (const raw of paths) {
    const path = raw.replace(":id", encodeURIComponent(agentId));
    const url = `${baseUrl.replace(/\/+$/,"")}${path}`;
    console.log("[upstream] POST", url);

    try {
      const r = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        timeout: TIMEOUT_MS
      });
      const text = await r.text();
      const data = tryJson(text) ?? text;

      attempts.push({ url, status: r.status, data });
      if (r.ok) return { ok: true, url, status: r.status, data };

      // keep trying on 404; break early on auth errors
      if (r.status === 401 || r.status === 403) break;
    } catch (e) {
      attempts.push({ url, error: String(e) });
    }
  }
  return { ok: false, attempts };
}

// ---------- Routes ----------
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    hasApiKey: !!API_KEY,
    hasLettaToken: !!LETTA_TOKEN,
    hasLettaBase: !!LETTA_BASE_URL,
    timeoutMs: TIMEOUT_MS
  });
});

app.get("/ping-upstream", async (_req, res) => {
  if (!LETTA_BASE_URL) return res.status(500).json({ ok: false, error: "LETTA_BASE_URL not set" });
  try {
    const r = await fetch(`${LETTA_BASE_URL}/`, { timeout: TIMEOUT_MS });
    res.json({ ok: true, status: r.status });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e), base: LETTA_BASE_URL });
  }
});

// Main maintenance endpoint called by Apps Script
app.post("/maintenance", async (req, res) => {
  // 1) Caller auth (Apps Script -> Railway)
  const auth = req.headers.authorization || "";
  if (!API_KEY || auth !== `Bearer ${API_KEY}`) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  // 2) Agent + instruction
  const agentId = req.body.agent_id || DEFAULT_AGENT;
  const instruction = req.body.instruction || "Nightly rethink & cleanup";
  if (!agentId) return res.status(400).json({ error: "Missing agent_id and no DEFAULT_AGENT" });

  // 3) Build payload for Letta (choose style via env)
  const payload = (CALL_BODY_STYLE === "2")
    ? { text: instruction, agent_id: agentId } // some runtimes expect this
    : {                                        // “handoff envelope” style
        message: {
          text: instruction,
          source: "maintenance",
          priority: "normal",
          request_heartbeat: true
        },
        other_agent_id: agentId,
        request_heartbeat: true
      };

  // 4) Determine paths to try
  const defaultPaths = [
    "/agents/:id/maintenance",
    "/agents/:id/call",
    "/agents/call",
    "/agent/call"
  ];
  const paths = LETTA_PATHS
    ? LETTA_PATHS.split(",").map(s => s.trim()).filter(Boolean)
    : defaultPaths;

  if (!LETTA_BASE_URL || !LETTA_TOKEN) {
    return res.status(500).json({ error: "Upstream config missing", hasBase: !!LETTA_BASE_URL, hasToken: !!LETTA_TOKEN });
  }

  // 5) Forward to Letta (never hang)
  try {
    const result = await tryPostPaths(LETTA_BASE_URL, LETTA_TOKEN, agentId, payload, paths);
    if (result.ok) {
      return res.json({
        ok: true,
        forwarded: { agent_id: agentId, instruction, path: result.url },
        upstream: result.data
      });
    }
    return res.status(502).json({ error: "Upstream not found or timed out", attempts: result.attempts });
  } catch (e) {
    return res.status(500).json({ error: "Handler failure", details: String(e) });
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Sleep maintenance server listening on :${PORT}`);
});
