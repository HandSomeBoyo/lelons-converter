// VaultHub's "push" Edge Function: sends phone notifications for new messages and calls.
// The database pokes it (see lelons_push_job in sfx/setup.sql) with {kind, ref} and the secret;
// it asks the database who to tell, and sends each one a web push.
// Set up once in Supabase: Edge Functions > Deploy a new function > Via Editor, name it "push",
// paste this file, and turn OFF "Enforce JWT verification" (the secret checks the caller instead).
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://hjuoeiouotgaapuevflp.supabase.co";
const KEY = "sb_publishable_4cNy4W_7OjXUjGaoxXKneg_-YcdccQ2"; // the public key, same as the apps

async function rpc(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return res.ok ? await res.json() : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("VaultHub push", { status: 200 });
  const secret = req.headers.get("x-push-secret") ?? "";
  let kind = "", ref = "";
  try {
    const body = await req.json();
    kind = String(body.kind ?? "");
    ref = String(body.ref ?? "");
  } catch {
    return new Response("bad", { status: 400 });
  }
  const job = await rpc("lelons_push_job", { secret, kind, ref });
  if (!job || !Array.isArray(job.sends)) return new Response("no", { status: 403 });
  if (!job.sends.length) return new Response("nobody");
  webpush.setVapidDetails(job.subject, job.vapid_public, job.vapid_private);
  let sent = 0;
  await Promise.all(job.sends.map(async (s: { endpoint: string; p256dh: string; auth: string; payload: unknown }) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(s.payload), { TTL: 3600, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await rpc("lelons_push_job", { secret, kind: "gone", ref: s.endpoint });
      else console.log("push failed", code, String(e));
    }
  }));
  return new Response(`sent ${sent}`);
});
