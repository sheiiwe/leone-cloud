import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const plain = (message: string, status: number) => new Response(message, {
  status,
  headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
});

const getSecretKey = () => {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const keys = JSON.parse(modern);
      if (keys?.default) return String(keys.default);
    } catch { /* usa il fallback legacy */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "HEAD") return plain("Metodo non supportato", 405);

  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    return plain("Pass non disponibile", 404);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getSecretKey();
  if (!supabaseUrl || !secretKey) return plain("Servizio temporaneamente non disponibile", 503);

  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });
  const { data: badge, error } = await admin.from("tessere")
    .select("codice,attiva,scade_il,wallet_enabled,apple_wallet_status,apple_storage_path")
    .eq("wallet_download_token", token)
    .maybeSingle();

  const expired = badge?.scade_il && new Date(`${badge.scade_il}T23:59:59Z`).getTime() < Date.now();
  if (error || !badge || !badge.attiva || expired || !badge.wallet_enabled ||
      badge.apple_wallet_status !== "emesso" || !badge.apple_storage_path) {
    return plain("Pass non disponibile", 404);
  }

  const { data: pass, error: storageError } = await admin.storage
    .from("wallet-passes")
    .download(badge.apple_storage_path);
  if (storageError || !pass) return plain("Pass non disponibile", 404);

  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", "application/vnd.apple.pkpass");
  headers.set("Content-Disposition", `attachment; filename="Leone-${badge.codice}.pkpass"`);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(req.method === "HEAD" ? null : await pass.arrayBuffer(), { status: 200, headers });
});
