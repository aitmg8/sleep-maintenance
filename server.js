const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const SLEEP_AGENT_ID = process.env.SLEEP_AGENT_ID;
const LETTA_BACKEND = process.env.LETTA_BACKEND || "api";
const LETTA_BASE_URL = process.env.LETTA_BASE_URL || "https://your-letta-runtime-host";
const LETTA_TOKEN = process.env.LETTA_TOKEN;

// Health endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Maintenance trigger
app.post("/maintenance", async (req, res) => {
  if (req.headers.authorization !== `Bearer ${API_KEY}`) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    if (LETTA_BACKEND === "api") {
      const response = await axios.post(
        `${LETTA_BASE_URL}/agents/${SLEEP_AGENT_ID}/maintenance`,
        { instruction: req.body.instruction || "Run rethink_all" },
        { headers: { Authorization: `Bearer ${LETTA_TOKEN}` } }
      );
      return res.json({ success: true, data: response.data });
    } else {
      return res.json({ success: true, note: "SDK mode not yet implemented" });
    }
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Maintenance call failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Sleep agent maintenance server running on port ${PORT}`);
});
