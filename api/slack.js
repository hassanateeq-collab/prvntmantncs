export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const slackWebhookUrl = process.env.VITE_SLACK_WEBHOOK_URL;
  if (!slackWebhookUrl) {
    return res.status(500).json({ error: "Slack webhook not configured" });
  }

  try {
    const response = await fetch(slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "Slack webhook failed" });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Slack proxy error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
