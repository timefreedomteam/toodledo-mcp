import type { IncomingMessage, ServerResponse } from "node:http";
import { checkConnectPassword, signState, verifyState } from "../auth/oauth-server.js";
import { authorizationUrl, callbackUrl, exchangeCode, loadApp, saveApp } from "./auth.js";

// One-time Basecamp sign-in pages, protected by the same connect password as
// the claude.ai connector:
//   GET  /basecamp/connect   form for password + Basecamp app credentials
//   POST /basecamp/connect   saves the app, sends the browser to Basecamp
//   GET  /basecamp/callback  Basecamp sends the browser back here

function getOrigin(req: IncomingMessage): string {
  return `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function page(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Basecamp</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:10vh auto;padding:0 16px;line-height:1.5}
label{display:block;margin-top:12px}input,button{width:100%;padding:10px;margin-top:4px;font-size:16px;box-sizing:border-box}
button{margin-top:16px}code{word-break:break-all}.err{color:#b00020}</style></head>
<body>${body}</body></html>`);
}

async function renderForm(req: IncomingMessage, res: ServerResponse, error?: string) {
  const app = await loadApp().catch(() => null);
  const keep = app ? " (leave blank to keep the saved one)" : "";
  page(res, error ? 401 : 200, `<h2>Connect Claude to Basecamp</h2>
<p>In your Basecamp app at launchpad.37signals.com/integrations, the Redirect URI must be:<br>
<code>${escapeHtml(callbackUrl(getOrigin(req)))}</code></p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/basecamp/connect">
<label>Connect password<input type="password" name="password" required autofocus></label>
<label>Basecamp Client ID${keep}<input name="client_id" autocomplete="off" ${app ? "" : "required"}></label>
<label>Basecamp Client Secret${keep}<input type="password" name="client_secret" autocomplete="off" ${app ? "" : "required"}></label>
<button type="submit">Continue to Basecamp</button></form>`);
}

export async function handleBasecampConnect(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method === "GET") {
      await renderForm(req, res);
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method not allowed");
      return;
    }

    const params = new URLSearchParams(await readBody(req));
    if (!checkConnectPassword(params.get("password") ?? "")) {
      await renderForm(req, res, "Wrong password. Try again.");
      return;
    }

    const clientId = params.get("client_id")?.trim();
    const clientSecret = params.get("client_secret")?.trim();
    const saved = await loadApp();
    const app = clientId && clientSecret ? { clientId, clientSecret } : saved;
    if (!app) {
      await renderForm(req, res, "Enter both the Client ID and the Client Secret.");
      return;
    }
    if (app !== saved) await saveApp(app);

    res.writeHead(302, { Location: authorizationUrl(app, getOrigin(req), signState()) });
    res.end();
  } catch (err) {
    console.error("Basecamp connect failed:", err);
    page(res, 500, `<h2>Something went wrong</h2><p class="err">${escapeHtml(String(err))}</p>`);
  }
}

export async function handleBasecampCallback(req: IncomingMessage, res: ServerResponse, url: URL) {
  try {
    if (!verifyState(url.searchParams.get("state"))) {
      page(res, 400, `<h2>This sign-in link expired</h2><p><a href="/basecamp/connect">Start again</a>.</p>`);
      return;
    }
    const code = url.searchParams.get("code");
    const app = await loadApp();
    if (!code || !app) {
      page(res, 400, `<h2>Basecamp didn't approve the sign-in</h2><p><a href="/basecamp/connect">Try again</a>.</p>`);
      return;
    }
    const tokens = await exchangeCode(app, getOrigin(req), code);
    page(res, 200, `<h2>Basecamp is connected</h2>
<p>Account: ${escapeHtml(tokens.account_name)}. You can close this page and ask Claude about Basecamp.</p>`);
  } catch (err) {
    console.error("Basecamp callback failed:", err);
    page(res, 500, `<h2>Something went wrong</h2><p class="err">${escapeHtml(String(err))}</p>
<p><a href="/basecamp/connect">Try again</a>.</p>`);
  }
}
