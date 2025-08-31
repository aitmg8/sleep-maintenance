// server.js  — ESM (because package.json uses "type": "module")
import express from "express";
import axios from "axios";

// ---------- Config ----------
const PORT            = process.env.PORT || 3000;
const API_KEY         = process.env.API_KEY || ""; // protects /maintenance
const SLEEP_AGENT_ID  = process.env.SLEEP_AGENT_ID || "agent-2bbec9ee-ea96-4278-9cd0-08cc586ad5d8";

const LETTA_MODE      = (process.env.LETTA_MODE || "call").toLowerCase(); // "maintenance" | "call"
const LETTA_BASE_URL  = (process.env.LETTA_BASE_URL || "").replace(/\/+$/,""); // strip trailing slashes
const LETTA_TOKEN     = process.env.LETTA_TOKEN || "";

const LETTA_MAINT_PATH = process.env.LETTA_MAINT_PATH || "/agents/:id/maintenance";
const LETTA_CALL_PATH  = process.env.LETTA_CALL_PATH  || "/agents/call"; // or "/agents/:id/call" or "/agent/call"

const AXIOS_TIMEOUT_MS = +(process.env.AXIOS_TIMEOUT_MS || 15000); // 15s
const DRY_RUN = (process.env.DRY_RUN || "false").toLowerCase() === "true";
const CALL_BODY_STYLE = +(process.env.CALL_BODY_STYLE || 1); // 1 or 2

// ---------- App ----------
const app = express();
app.use(express.json());

function okAuth(req, res) {
  if (!API_KEY) return true; // no auth if not set
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

// A) Direct maintenance endpoint
async function callLettaMaintenance(agentId) {
  if (!LETTA_BASE_URL) throw new Error("LETTA_BASE_URL not set");
  const path = LETTA_MAINT_PATH.includes(":id")
    ? LETTA_MAINT_PATH.replace(":id", agentId)
    : LETTA_MAINT_PATH;
  const url  = `${LETTA_BASE_URL}${path}`;
  const body = {
    operation: "rethink_all",
    reason: "scheduled-maintenance",
    timestamp: new Date().toISOString()
  };
  console.log("[upstream] POST", url);
  return axios.post(url, body, {
    headers: lettaHeaders(),
    timeout: AXIOS_TIMEOUT_MS
  });
}

// B) Generic call endpoint (two body styles)
async function callLettaGeneric(agentId) {
  if (!LETTA_BASE_URL) throw new Error("LETTA_BASE_URL not set");
  const path = LETTA_CALL_PATH.includes(":id")
    ? LETTA_CALL_PATH.replace(":id", agentId)
    : LETTA_CALL_PATH;
  const url  = `${LETTA_BASE_URL}${path}`;

  let body;
  if (CALL_BODY_STYLE === 2) {
    // Style 2: { text, agent_id }
    body = {
      text: "maintenance: rethink_all (scheduled)",
      agent_id: agentId
    };
  } else {
    // Style 1 (default): { message{...}, other_agent_id, request_heartbeat }
    body = {
      message: {
        text: "maintenance: rethink_all (scheduled)",
        source: "maintenance",
        priority: "normal",
        request_heartbeat: true
      },
      other_agent_id: agentId,
      request_heartbeat: true
    };
  }

  console.log("[upstream] POST", url, "(style", CALL_BODY_STYLE, ")");
  return axios.post(url, body, {
    headers: lettaHeaders(),
    timeout: AXIOS_TIMEOUT_MS
  });
}

// ---------- Routes ----------
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    mode: LETTA_MODE,
    hasBaseUrl: Boolean(LETTA_BASE_URL),
    hasToken: Boolean(LETTA_TOKEN),
    agent: SLEEP_AGENT_ID,
    maintPath: LETTA_MAINT_PATH,
    callPath: LETTA_CALL_PATH,
    bodyStyle: CALL_BODY_STYLE,
    dryRun: DRY_RUN
  });
});

// Connectivity probe to your Letta host root
app.get("/ping-upstream", async (_req, res) => {
  try {
    const url = `${LETTA_BASE_URL}/`;
    const r = await axios.get(url, { timeout: AXIOS_TIMEOUT_MS });
    res.json({ ok: true, url, status: r.status });
  } catch (e) {
    res.status(500).json({
      ok: false,
      url: `${LETTA_BASE_URL}/`,
      error: e.code || e.message,
      details: e.response?.data
    });
  }
});

app.post("/maintenance", async (req, res) => {
  if (!okAuth(req, res)) return;

  const { instruction, agent_id } = req.body || {};
  if (instruction && !/rethink|cleanup/i.test(instruction)) {
    return res.status(400).json({ error: "Unknown instruction" });
  }
  if (agent_id && agent_id !== SLEEP_AGENT_ID) {
    return res.status(400).json({ error: "Wrong agent_id" });
  }

  if (DRY_RUN) {
    return res.json({
      ok: true,
      dryRun: true,
      received: { instruction, agent_id: agent_id || SLEEP_AGENT_ID }
    });
  }

  try {
    const resp = (LETTA_MODE === "maintenance")
      ? await callLettaMaintenance(SLEEP_AGENT_ID)
      : await callLettaGeneric(SLEEP_AGENT_ID);

    res.json({
      ok: true,
      upstream_status: resp.status,
      upstream: resp.data
    });
  } catch (e) {
    const status  = e.response?.status || 500;
    const details = e.response?.data || e.message;
    console.error("[/maintenance] upstream error:", status, details);
    res.status(500).json({ error: "Upstream failed", status, details });
  }
});

app.listen(PORT, () => {
  console.log(`Sleep maintenance server on :${PORT}`);
});
