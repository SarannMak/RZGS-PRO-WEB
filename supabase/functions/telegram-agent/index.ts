// RZGS-PRO guard agent: a read-only Telegram bot that watches the website,
// the Supabase project and the GitHub repo. Runs as a Supabase Edge Function.
//
// Two entry points:
//   POST /            Telegram webhook (commands from the owner)
//   POST /?cron=1     Scheduled health sweep; messages the owner only when something is wrong
//
// Safety model: the agent never writes anything. Telegram requests must carry the webhook
// secret AND come from the owner's chat id. The cron call must carry CRON_SECRET.

const env = (k: string) => Deno.env.get(k) ?? "";
const BOT_TOKEN = env("TELEGRAM_BOT_TOKEN");
const WEBHOOK_SECRET = env("TELEGRAM_WEBHOOK_SECRET");
const OWNER_CHAT_ID = env("OWNER_CHAT_ID");
const CRON_SECRET = env("CRON_SECRET");
const SITE_URL = env("SITE_URL") || "https://rzgspro.com";
const GITHUB_REPO = env("GITHUB_REPO") || "sarannmak/rzgs-pro-web";
const GITHUB_TOKEN = env("GITHUB_TOKEN"); // read-only fine-grained token
const SB_PROJECT_REF = env("SB_PROJECT_REF") || "zaziizzsbytkdlatoutv";
const SB_ACCESS_TOKEN = env("SB_ACCESS_TOKEN"); // Management API token (read use only)

const EXPECTED_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
];
const SITE_PAGES = ["/", "/login.html", "/signup.html", "/privacy.html"];

// ---------- helpers ----------

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

async function timed(url: string, init: RequestInit = {}) {
  const t = Date.now();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  return { res, ms: Date.now() - t };
}

async function send(chatId: string | number, html: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: html.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

async function gh(path: string) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "rzgs-guard-agent",
      ...(GITHUB_TOKEN ? { authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok ? await res.json() : { error: res.status };
}

async function sb(path: string) {
  if (!SB_ACCESS_TOKEN) return { error: "SB_ACCESS_TOKEN not set" };
  const res = await fetch(`https://api.supabase.com/v1/projects/${SB_PROJECT_REF}${path}`, {
    headers: { authorization: `Bearer ${SB_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok ? await res.json() : { error: res.status };
}

// ---------- checks (each returns { lines, problems }) ----------

type Report = { lines: string[]; problems: number };

async function checkSite(): Promise<Report> {
  const r: Report = { lines: [], problems: 0 };
  for (const p of SITE_PAGES) {
    try {
      const { res, ms } = await timed(SITE_URL + p, { redirect: "manual" });
      const ok = res.status === 200;
      if (!ok || ms > 3000) r.problems++;
      r.lines.push(`${ok ? "✅" : "🔴"} ${p} → ${res.status} (${ms} ms)`);
      if (p === "/") {
        const missing = EXPECTED_HEADERS.filter((h) => !res.headers.has(h));
        if (missing.length) r.lines.push(`⚠️ missing headers: ${missing.join(", ")}`);
        if (res.headers.get("location")?.startsWith("http://")) {
          r.problems++;
          r.lines.push("🔴 redirects to plain http");
        }
      }
    } catch (e) {
      r.problems++;
      r.lines.push(`🔴 ${p} unreachable: ${esc(String(e))}`);
    }
  }
  // Plain-http must not serve content without redirecting.
  try {
    const { res } = await timed(SITE_URL.replace("https://", "http://"), { redirect: "manual" });
    const to = res.headers.get("location") ?? "";
    if (!(res.status >= 300 && res.status < 400 && to.startsWith("https://"))) {
      r.problems++;
      r.lines.push("🔴 http:// does not redirect to https");
    }
  } catch { /* port 80 closed is fine */ }
  return r;
}

async function checkSupabase(): Promise<Report> {
  const r: Report = { lines: [], problems: 0 };
  const health = await sb("/health?services=auth,db,rest,realtime,storage");
  if (Array.isArray(health)) {
    for (const s of health) {
      const bad = s.status !== "ACTIVE_HEALTHY";
      if (bad) r.problems++;
      r.lines.push(`${bad ? "🔴" : "✅"} ${s.name}: ${s.status}`);
    }
  } else r.lines.push(`⚠️ health unavailable (${esc(JSON.stringify(health))})`);

  for (const type of ["security", "performance"]) {
    const adv = await sb(`/advisors/${type}`);
    const lints = adv?.lints ?? [];
    const errors = lints.filter((l: { level: string }) => l.level === "ERROR");
    if (type === "security") r.problems += errors.length;
    r.lines.push(`${errors.length ? "🔴" : "✅"} ${type} advisors: ${lints.length} findings, ${errors.length} errors`);
    for (const l of errors.slice(0, 5)) r.lines.push(`   • ${esc(l.title)}: ${esc(l.detail ?? "")}`.slice(0, 300));
  }
  return r;
}

async function checkGithub(): Promise<Report> {
  const r: Report = { lines: [], problems: 0 };
  const issues = await gh("/issues?state=open&per_page=10");
  if (Array.isArray(issues)) {
    r.lines.push(`📋 open issues/PRs: ${issues.length}${issues.length === 10 ? "+" : ""}`);
    for (const i of issues.slice(0, 5)) r.lines.push(`   • #${i.number} ${esc(i.title)}`);
  }
  const alerts: [string, string][] = [
    ["dependabot/alerts", "Dependabot"],
    ["secret-scanning/alerts", "Secret scanning"],
    ["code-scanning/alerts", "Code scanning"],
  ];
  for (const [path, label] of alerts) {
    const a = await gh(`/${path}?state=open&per_page=30`);
    if (Array.isArray(a)) {
      if (a.length) r.problems++;
      r.lines.push(`${a.length ? "🔴" : "✅"} ${label}: ${a.length} open`);
    }
  }
  return r;
}

async function activity(): Promise<Report> {
  const r: Report = { lines: [], problems: 0 };
  const commits = await gh("/commits?per_page=5");
  if (Array.isArray(commits)) {
    r.lines.push("<b>Recent commits</b>");
    for (const c of commits) {
      r.lines.push(`• ${c.sha.slice(0, 7)} ${esc(c.commit.message.split("\n")[0])} — ${esc(c.commit.author?.name ?? "?")}`);
    }
  }
  // Auth-log signals: failed sign-ins in the last hour (Supabase analytics SQL).
  const since = new Date(Date.now() - 3600_000).toISOString();
  const sql = encodeURIComponent(
    "select count(*) as n from auth_logs cross join unnest(metadata) as m " +
      "where m.level = 'error' and m.msg like '%login%'",
  );
  const logs = await sb(`/analytics/endpoints/logs.all?sql=${sql}&iso_timestamp_start=${since}`);
  const n = logs?.result?.[0]?.n;
  if (n !== undefined) {
    if (n > 30) r.problems++;
    r.lines.push(`${n > 30 ? "🔴" : "✅"} failed logins, last hour: ${n}`);
  }
  return r;
}

const fmt = (title: string, r: Report) => `<b>${title}</b>\n${r.lines.join("\n")}`;

// ---------- commands ----------

async function handle(cmd: string): Promise<string> {
  switch (cmd) {
    case "/start":
    case "/help":
      return [
        "<b>RZGS guard agent</b> (read-only)",
        "/status – website + database health",
        "/security – headers, TLS redirect, Supabase + GitHub security alerts",
        "/issues – open issues and PRs",
        "/activity – recent commits, failed logins",
        "/all – everything above",
      ].join("\n");
    case "/status": {
      const [s, d] = await Promise.all([checkSite(), checkSupabase()]);
      return `${fmt("Website", s)}\n\n${fmt("Supabase", d)}`;
    }
    case "/security": {
      const [s, d, g] = await Promise.all([checkSite(), checkSupabase(), checkGithub()]);
      return `${fmt("Website", s)}\n\n${fmt("Supabase", d)}\n\n${fmt("GitHub", g)}`;
    }
    case "/issues":
      return fmt("GitHub", await checkGithub());
    case "/activity":
      return fmt("Activity", await activity());
    case "/all": {
      const [s, d, g, a] = await Promise.all([checkSite(), checkSupabase(), checkGithub(), activity()]);
      return [fmt("Website", s), fmt("Supabase", d), fmt("GitHub", g), fmt("Activity", a)].join("\n\n");
    }
    default:
      return "Unknown command. Try /help";
  }
}

// ---------- entry point ----------

// Constant-time-ish comparison so secrets are not leaked through timing.
function same(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const url = new URL(req.url);

  // Scheduled sweep: silent unless something is wrong.
  if (url.searchParams.has("cron")) {
    if (!same(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) return new Response("forbidden", { status: 403 });
    const [s, d, g, a] = await Promise.all([checkSite(), checkSupabase(), checkGithub(), activity()]);
    const total = s.problems + d.problems + g.problems + a.problems;
    if (total > 0) {
      await send(OWNER_CHAT_ID, `🚨 <b>${total} problem(s) found</b>\n\n${[fmt("Website", s), fmt("Supabase", d), fmt("GitHub", g), fmt("Activity", a)].join("\n\n")}`);
    }
    return new Response(JSON.stringify({ problems: total }));
  }

  // Telegram webhook: must carry the secret token set via setWebhook.
  if (!same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", WEBHOOK_SECRET)) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (!msg?.text) return new Response("ok");
  // Only the owner gets answers; everyone else is ignored silently.
  if (String(msg.chat?.id) !== OWNER_CHAT_ID || String(msg.from?.id) !== OWNER_CHAT_ID) return new Response("ok");

  const cmd = msg.text.trim().split(/[\s@]/)[0].toLowerCase();
  try {
    await send(OWNER_CHAT_ID, await handle(cmd));
  } catch (e) {
    await send(OWNER_CHAT_ID, `⚠️ check failed: ${esc(String(e))}`);
  }
  return new Response("ok");
});
