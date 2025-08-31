// server.js
const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "1234"; // make sure you set this in Railway
const SLEEP_AGENT_ID = process.env.SLEEP_AGENT_ID || "default-agent";

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    mode: "maintenance",
    hasBaseUrl: true,
    hasToken: !!API_KEY,
    agent: SLEEP_AGENT_ID
  });
});

// Maintenance endpoint
app.post("/maintenance", (req, res) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  console.log("Maintenance instruction received:", req.body);

  // Example: respond with confirmation
  res.json({
    ok: true,
    status: "instruction received",
    body: req.body,
    agent: SLEEP_AGENT_ID,
    ts: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Sleep agent maintenance server running on port ${PORT}`);
});
