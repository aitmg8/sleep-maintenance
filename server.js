// server.js  (CommonJS)
const express = require("express");
const axios = require("axios");

// ---------- config ----------
const PORT           = process.env.PORT || 3000;
const API_KEY        = process.env.API_KEY || ""; // protects /maintenance
const SLEEP_AGENT_ID = process.env.SLEEP_AGENT_ID || "agent-2bbec9ee-ea96-4278-9cd0-08cc586ad5d8";

// Which way to call Letta: "maintenance" (direct endpoint) or "call" (generic send-message)
const LETTA_MODE     = (process.env.LETTA_MODE || "maintenance").toLowerCase();

// Base URL and token for your Letta runtime
const LETTA_BASE_URL = (process.env.LETTA_BASE_URL || "").replace(/\/+$/,""); // strip trailing slashes
const LETTA_TOKEN    = process.env.LETTA_TOKEN || "";

// Overrideable paths (so you don’t have to edit code if your runtime uses different routes)
const LETTA_MAINT_PATH = process.env.LETTA_MAINT_PATH || "/agents/:id/maintenance"; // :id will be replaced
const LETTA_CALL_PATH  = process.env.LETTA_CALL_PATH  || "/agent/call";             // adjust if needed

// ---------- app ----------
const app = express();
app.use(express.json());

// auth gate for /maintenance
function okAuth(req, res) {
  if (!API_KEY) return true;
  const a = req.headers.authorization || "";
  if (a !== `Bearer ${API_KEY}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function lettaHeaders() {
  const h = { "Content-Type": "application/json" };
  if (LETTA_TOKEN) h.Authorization = `Bearer ${LETTA_TOKEN}`;
  return h;
}

// A) direct maintenance endpoint: POST {BASE}/agents/:id/maintenance
async function callLettaMaintenance(agentId) {
  if (!LETTA_BASE_URL) throw new Error("LETTA_BASE_URL not set");
  const path = LETTA_MAINT_PATH.replace(":id", agentId);
  const url  = `${LETTA_BASE_URL}${path}`;
  const body = {
    operation: "rethink_all",
    reason: "scheduled-maintenance",
    timestamp: new Date().toISOString()
  };
  console.log("[upstream] POST", url);
  return axios.post(url, body, { headers: lettaHeaders() });
}

// B) generic call endpoint: POST {BASE}/agent/call  (or whatever you override)
async function callLettaGeneric(agentId) {
  if (!LETTA_BASE_URL) throw new Error("LETTA_BASE_URL not set");
  const url  = `${LETTA_BASE_URL}${LETTA_CALL_PATH}`;
  const body = {
    message: {
      text: "maintenance: rethink_all (scheduled)",
      source: "maintenance",
      priority: "normal",
      request_heartbeat: true
    },
    other_agent_id: agentId,
    request_heartbeat: true
  };
  console.log("[upstream] POST", url);
  return axios.post(url, body, { headers: lettaHeaders() });
}

// -------- routes --------
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    mode: LETTA_MODE,
    hasBaseUrl: Boolean(LETTA_BASE_URL),
    hasToken: Boolean(LETTA_TOKEN),
    agent: SLEEP_AGENT_ID,
    maintPath: LETTA_MAINT_PATH,
    callPath: LETTA_CALL_PATH
  });
});

app.post("/maintenance", async (req, res) => {
  if (!okAuth(req, res)) return;

  // accept either payload with/without agent_id; be lenient on instruction text
  const { instruction, agent_id } = req.body || {};
  if (instruction && !/rethink|cleanup/i.test(instruction)) {
    return res.status(400).json({ error: "Unknown instruction" });
  }
  if (agent_id && agent_id !== SLEEP_AGENT_ID) {
    return res.status(400).json({ error: "Wrong agent_id" });
  }

  try {
    const resp = (LETTA_MODE === "call")
      ? await callLettaGeneric(SLEEP_AGENT_ID)
      : await callLettaMaintenance(SLEEP_AGENT_ID);

    return res.json({
      ok: true,
      upstream_status: resp.status,
      upstream: resp.data
    });
  } catch (e) {
    const status  = e.response?.status || 500;
    const details = e.response?.data || e.message;
    console.error("[/maintenance] upstream error:", status, details);
    return res.status(500).json({ error: "Upstream failed", status, details });
  }
});

app.listen(PORT, () => {
  console.log(`Sleep maintenance server on :${PORT}`);
});
