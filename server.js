// server.js (CommonJS)
const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;                  // auth for Apps Script → Railway
const LETTA_BASE_URL = process.env.LETTA_BASE_URL;    // e.g., https://letta…/api
const LETTA_TOKEN = process.env.LETTA_TOKEN;          // Bearer token for Letta
const DEFAULT_AGENT = process.env.SLEEP_AGENT_ID;     // optional fallback

function ok(res, json) { res.status(200).json(json); }
function bad(res, code, msg) { res.status(code).json({ error: msg }); }

// Health
app.get("/health", (req, res) => {
  ok(res, {
    ok: true,
    ts: new Date().toISOString(),
    hasToken: !!LETTA_TOKEN,
    hasBaseUrl: !!LETTA_BASE_URL
  });
});

// Maintenance → forward to Letta
app.post("/maintenance", async (req, res) => {
  // Validate caller (Apps Script)
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${API_KEY}`) return bad(res, 403, "Unauthorized");

  const agentId = req.body.agent_id || DEFAULT_AGENT;
  const instruction = req.body.instruction || "Nightly rethink & cleanup";
  if (!agentId) return bad(res, 400, "Missing agent_id and no DEFAULT_AGENT");

  // Build Letta request
  const url = `${LETTA_BASE_URL}/agents/${encodeURIComponent(agentId)}/maintenance`;
  const body = {
    instruction,             // free text for your Sleep agent (optional)
    mode: "rethink",         // hint to run memory_rethink
    scope: "archival/*"      // hint: restrict to archival labels
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LETTA_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const text = await r.text();
    const result = tryJson(text);

    if (!r.ok) {
      return res.status(r.status).json({ error: "Upstream failed", status: r.status, details: result || text });
    }
    ok(res, { ok: true, forwarded: { agent_id: agentId, instruction }, upstream: result });
  } catch (e) {
    bad(res, 502, `Forward error: ${String(e)}`);
  }
});

function tryJson(s){ try { return JSON.parse(s) } catch { return null } }

app.listen(PORT, () => console.log(`Sleep maintenance server on :${PORT}`));
