const fetch = require("node-fetch");

async function tryPostPaths(baseUrl, token, agentId, payload, paths) {
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const errors = [];
  for (const raw of paths) {
    const path = raw.replace(":id", encodeURIComponent(agentId));
    const url = `${baseUrl.replace(/\/+$/,"")}${path}`;
    console.log("[upstream] POST", url);
    try {
      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }

      if (r.ok) return { ok: true, url, status: r.status, data };
      errors.push({ url, status: r.status, data });
      // if 404, continue to next path; if 401/403, break early
      if (r.status === 401 || r.status === 403) break;
    } catch (e) {
      errors.push({ url, error: String(e) });
    }
  }
  return { ok: false, errors };
}

app.post("/maintenance", async (req, res) => {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${API_KEY}`) return res.status(403).json({ error: "Unauthorized" });

  const agentId = req.body.agent_id || DEFAULT_AGENT;
  const instruction = req.body.instruction || "Nightly rethink & cleanup";
  if (!agentId) return res.status(400).json({ error: "Missing agent_id and no DEFAULT_AGENT" });

  // Two possible payload shapes (switch via env if you want)
  const style = (process.env.CALL_BODY_STYLE || "1").trim();
  const payload = style === "2"
    ? { text: instruction, agent_id: agentId } // Body style 2
    : {                                        // Body style 1
        message: {
          text: instruction,
          source: "maintenance",
          priority: "normal",
          request_heartbeat: true
        },
        other_agent_id: agentId,
        request_heartbeat: true
      };

  // Try likely endpoints in order (override with env LETTA_PATHS if you want)
  const defaultPaths = [
    "/agents/:id/maintenance",
    "/agents/:id/call",
    "/agents/call",
    "/agent/call"
  ];
  const paths = (process.env.LETTA_PATHS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const tryPathsList = paths.length ? paths : defaultPaths;

  const result = await tryPostPaths(LETTA_BASE_URL, LETTA_TOKEN, agentId, payload, tryPathsList);

  if (result.ok) return res.json({ ok: true, forwarded: { agent_id: agentId, instruction }, upstream: result });
  return res.status(502).json({ error: "Upstream not found or failed", attempts: result.errors });
});
