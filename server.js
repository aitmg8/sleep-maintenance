// server.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(bodyParser.json());

// ---- Config ----
const PORT            = process.env.PORT || 3000;
const API_KEY         = process.env.API_KEY || "";
const SLEEP_AGENT_ID  = process.env.SLEEP_AGENT_ID || "agent-2bbec9ee-ea96-4278-9cd0-08cc586ad5d8";
const LETTA_BASE_URL  = (process.env.LETTA_BASE_URL || "").replace(/\/+$/,"");
const LETTA_TOKEN     = process.env.LETTA_TOKEN || "";
// Choose which upstream you actually have: "maintenance" or "call"
const LETTA_MODE      = (process.env.LETTA_MODE || "maintenance").toLowerCase(); 

function okAuth(req, res) {
  if (!API_KEY) return true;
  if ((req.headers.authorization || "") !== `Bearer ${API_KEY}`) {
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

// A) If your Letta runtime exposes a maintenance endpoint
async function callLettaMaintenance(agentId) {
  if (!LETTA_BASE_URL) throw new Error("LETTA_BASE_URL not set");
  const url = `${LETTA_BASE_URL}/agents/${agentId}/maintenance`;
  const body = { operation: "rethink_all", reason: "scheduled-maintenance", timestamp: new Date().toISOString() };
  return axios.post(url, body, { headers: lettaHeaders() });
}

// B) If maintenance is done by sending a normal message to an agent “call” endpoint
async function callLettaGeneric(agentId) {
  if (!LETTA_BASE_URL) throw new Error("LETTA_BASE_URL not set");
  const url = `${LETTA_BASE_URL}/agent/call`; // adjust if your runtime uses a different path
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
  return axios.post(url, body, { headers: lettaHeaders() });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    mode: LETTA_MODE,
    hasBaseUrl: Boolean(LETTA_BASE_URL),
    hasToken: Boolean(LETTA_TOKEN),
    agent: SLEEP_AGENT_ID
  });
});

app.post("/maintenance", async (req, res) => {
  if (!okAuth(req, res)) return;

  // Accept both payloads (with or without agent_id)
  const { instruction, agent_id } = req.body || {};
  if (instruction && instruction.indexOf("rethink") === -1 && instruction.indexOf("cleanup") === -1) {
    return res.status(400).json({ error: "Unknown instruction" });
  }
  if (agent_id && agent_id !== SLEEP_AGENT_ID) {
    return res.status(400).json({ error: "Wrong agent_id" });
  }

  try {
    const resp = (LETTA_MODE === "call")
      ? await callLettaGeneric(SLEEP_AGENT_ID)
      : await callLettaMaintenance(SLEEP_AGENT_ID);

    return res.json({ ok: true, upstream_status: resp.status, upstream: resp.data });
  } catch (e) {
    const status = e.response?.status || 500;
    const data   = e.response?.data || e.message;
    console.error("[/maintenance] upstream error:", status, data);
    // Bubble up exact upstream error so we can see what's wrong
    return res.status(500).json({ error: "Upstream failed", status, details: data });
  }
});

app.listen(PORT, () => console.log(`Sleep maintenance server on :${PORT}`));
