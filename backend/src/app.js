const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000" }));
app.use(express.json());
app.use(morgan("dev"));

// Liveness check — used to confirm the service is up before wiring anything else.
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "iqsms-backend" });
});

// ---------------------------------------------------------------------------
// Phase 2 route mounting goes here, e.g.:
//   app.use("/api/auth", require("./routes/auth.routes"));
//   app.use("/api/incidents", require("./routes/incident.routes"));
//   app.use("/api/audits", require("./routes/audit.routes"));
//   app.use("/api/corrective-actions", require("./routes/correctiveAction.routes"));
//
// Remember: the audit-log middleware must wrap every mutating route, not be
// called by hand inside individual controllers — one forgotten call is a gap
// in the ISO audit trail (proposal Section 9.4).
// ---------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

module.exports = app;
