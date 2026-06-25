import axios from "axios";

export function isN8nReady() {
  return !!process.env.N8N_WEBHOOK_URL;
}

export async function triggerN8nWorkflow(webhookPath, payload) {
  const base = process.env.N8N_WEBHOOK_URL;
  if (!base) return { error: "N8N_WEBHOOK_URL not configured" };

  const url = webhookPath.startsWith("http")
    ? webhookPath
    : `${base.replace(/\/$/, "")}/${webhookPath.replace(/^\//, "")}`;

  try {
    const { data } = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 15_000,
    });
    return { success: true, data };
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    return { error: msg };
  }
}
