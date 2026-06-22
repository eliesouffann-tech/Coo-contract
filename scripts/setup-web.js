#!/usr/bin/env node
import "dotenv/config";
import express from "express";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { exec } from "child_process";
import axios from "axios";
import ngrok from "@ngrok/ngrok";
import os from "os";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const ENV_FILE = join(ROOT, ".env");

const app = express();
app.use(express.json());
app.use(express.static(join(ROOT, "public")));

const PORT = 3000;
let _verifyToken = "";
let _ngrokListener = null;

// ─── Meta webhook verification during setup ───────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === _verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── Check if already configured ─────────────────────────────────────────────
app.get("/api/status", (_req, res) => {
  const configured = existsSync(ENV_FILE);
  res.json({ configured });
});

// ─── Test Anthropic key ───────────────────────────────────────────────────────
app.post("/api/test/anthropic", async (req, res) => {
  try {
    await axios.get("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": req.body.key, "anthropic-version": "2023-06-01" },
    });
    res.json({ ok: true });
  } catch {
    res.json({ ok: false, error: "מפתח לא תקין" });
  }
});

// ─── Test WhatsApp token ──────────────────────────────────────────────────────
app.post("/api/test/whatsapp", async (req, res) => {
  try {
    await axios.get(
      `https://graph.facebook.com/v19.0/${req.body.phoneNumberId}`,
      { headers: { Authorization: `Bearer ${req.body.token}` } }
    );
    res.json({ ok: true });
  } catch {
    res.json({ ok: false, error: "טוקן או Phone Number ID לא תקינים" });
  }
});

// ─── Main configure endpoint ──────────────────────────────────────────────────
app.post("/api/configure", async (req, res) => {
  const { anthropicKey, waToken, waPhoneId, ngrokToken, openaiKey, metaAppId, metaAppSecret } = req.body;

  _verifyToken = randomBytes(16).toString("hex");

  // 1. Write .env immediately
  writeEnv({ anthropicKey, waToken, waPhoneId, ngrokToken, openaiKey, verifyToken: _verifyToken });

  res.json({ ok: true, step: "env_saved" });
});

// ─── Start ngrok and register Meta webhook ────────────────────────────────────
app.post("/api/connect", async (req, res) => {
  const { ngrokToken, metaAppId, metaAppSecret } = req.body;

  try {
    // Start ngrok
    if (_ngrokListener) await _ngrokListener.close().catch(() => {});
    _ngrokListener = await ngrok.forward({ addr: PORT, authtoken: ngrokToken });
    const publicUrl = _ngrokListener.url();
    const webhookUrl = `${publicUrl}/webhook`;

    // Try auto-register with Meta
    let metaRegistered = false;
    if (metaAppId && metaAppSecret) {
      try {
        await axios.post(`https://graph.facebook.com/v19.0/${metaAppId}/subscriptions`, {
          object: "whatsapp_business_account",
          callback_url: webhookUrl,
          verify_token: _verifyToken,
          fields: ["messages"],
          access_token: `${metaAppId}|${metaAppSecret}`,
        });
        metaRegistered = true;
      } catch (e) {
        // Auto-registration failed — user needs to do it manually
      }
    }

    // Update .env with Meta credentials if provided
    if (metaAppId && metaAppSecret) {
      const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
      writeFileSync(ENV_FILE,
        current +
        `\nMETA_APP_ID=${metaAppId}\nMETA_APP_SECRET=${metaAppSecret}\n`
      );
    }

    res.json({
      ok: true,
      publicUrl,
      webhookUrl,
      verifyToken: _verifyToken,
      metaRegistered,
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─── Start the agent ──────────────────────────────────────────────────────────
app.post("/api/start-agent", (_req, res) => {
  res.json({ ok: true });
  setTimeout(async () => {
    if (_ngrokListener) await _ngrokListener.close().catch(() => {});
    const child = exec("node src/index.js", { cwd: ROOT });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    server.close();
  }, 500);
});

// ─── Serve setup page ─────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.sendFile(join(ROOT, "public", "setup.html"));
});

function writeEnv({ anthropicKey, waToken, waPhoneId, ngrokToken, openaiKey, verifyToken }) {
  const openaiLine = openaiKey
    ? `\n# OpenAI Whisper (הודעות קוליות)\nOPENAI_API_KEY=${openaiKey}`
    : "";
  writeFileSync(
    ENV_FILE,
    `# Anthropic\nANTHROPIC_API_KEY=${anthropicKey}\n\n` +
    `# WhatsApp Cloud API\nWHATSAPP_TOKEN=${waToken}\nWHATSAPP_PHONE_NUMBER_ID=${waPhoneId}\n\n` +
    `# Webhook\nVERIFY_TOKEN=${verifyToken}\n\n` +
    `# ngrok\nNGROK_AUTHTOKEN=${ngrokToken}` +
    openaiLine + `\n\n# Server\nPORT=3000\n`
  );
}

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n🌐 אשף ההגדרה פעיל: \x1b[36m${url}\x1b[0m`);
  console.log("   פתח את הקישור בדפדפן\n");
  openBrowser(url);
});

function openBrowser(url) {
  const platform = os.platform();
  const cmd = platform === "win32" ? `start ${url}`
    : platform === "darwin" ? `open ${url}`
    : `xdg-open ${url} 2>/dev/null || true`;
  exec(cmd);
}
