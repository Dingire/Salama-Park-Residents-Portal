// Browser smoke test: loads every route of the portal in headless Edge and
// fails if any of them is broken.
//
// This exists because the API harness cannot see a page that crashes while
// rendering. Two real bugs reached production that way: a sign-in account with
// no credential, and a page that threw during render because a lookup table
// was missing an entry. Both looked perfectly healthy to an API-only test.
//
// What it checks, per route:
//   - the document loads and the app mounts something
//   - no uncaught exception on the page
//   - no console error
//   - the error boundary text ("Something went wrong") is not shown
//   - the response is not a 5xx
//
// Usage:
//   node docs/browser-smoke.mjs                        # local default
//   E2E_API_BASE=... node docs/browser-smoke.mjs       # any base URL
//
// Exit code is non-zero when any route fails.

import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

const BASE = (process.env.E2E_API_BASE || "http://127.0.0.1:8099").replace(/\/$/, "");

// Routes that render without signing in. Authenticated pages are covered
// separately, because they need a session the browser cannot mint by itself.
const PUBLIC_ROUTES = [
  "/",
  "/about",
  "/documents",
  "/petition",
  "/membership",
  "/announcements",
  "/elections",
  "/results",
  "/privacy",
  "/faq",
  "/contact",
  "/sign-in",
  "/sign-up",
  "/login",
  "/register",
  "/forgot-password",
  "/verify-account",
];

// Routes that must respond, even when they redirect or ask for a sign-in.
const GUARDED_ROUTES = [
  "/resident/dashboard",
  "/resident/profile",
  "/resident/application",
  "/resident/subscription",
  "/resident/petition",
  "/resident/voting",
  "/resident/receipts",
  "/resident/notifications",
  "/admin/dashboard",
  "/admin/members",
  "/admin/verifications",
  "/admin/petitions",
  "/admin/register-snapshots",
  "/admin/finance",
  "/admin/map",
  "/admin/documents",
  "/admin/resolutions",
  "/admin/elections",
  "/admin/candidates",
  "/admin/results",
  "/admin/meetings",
  "/admin/announcements",
  "/admin/reports",
  "/admin/audit-logs",
  "/admin/settings",
];

const ALL_ROUTES = [...PUBLIC_ROUTES, ...GUARDED_ROUTES];

// A crash message the app itself shows when a component throws.
const ERROR_BOUNDARY_TEXT = "Something went wrong";

// Text the catch-all NotFound route renders. A route that was never registered
// in the router does not crash: it quietly falls through to NotFound and still
// mounts, so "did it mount?" alone cannot tell a real page from a missing one.
const NOT_FOUND_MARKERS = ["Page not found", "not found", "404"];

// Every authenticated route must actually reach its own page, not the catch-all.
// Without this, adding a page and forgetting to register it in the router passes.
const EXPECTED_HEADINGS = {
  "/resident/dashboard": "Your resident portal",
  "/resident/profile": "My profile",
  "/resident/application": "Membership application",
  "/resident/subscription": "Your subscription",
  "/admin/dashboard": "Association administration",
  "/admin/finance": "Association administration",
  "/admin/members": "Association administration",
  "/admin/settings": "Association administration",
};

function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function waitForDevTools(port) {
  for (let i = 0; i < 80; i++) {
    try {
      return await getJson(port, "/json/version");
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("Browser DevTools endpoint never became available.");
}

/** Loads one route and returns everything observed while it rendered. */
async function inspectRoute(sock, send, url) {
  const consoleErrors = [];
  const exceptions = [];
  const serverErrors = [];

  const onMessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      const text = (msg.params.args || [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(" ");
      consoleErrors.push(text);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      exceptions.push(d.exception?.description || d.text || "unknown exception");
    }
    if (msg.method === "Network.responseReceived") {
      const r = msg.params.response;
      if (r.status >= 500) serverErrors.push(`${r.status} ${r.url}`);
    }
  };

  sock.addEventListener("message", onMessage);

  await send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 4500));

  const res = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      href: location.href,
      rootChildren: document.getElementById('root')?.children.length ?? -1,
      text: (document.body.innerText || '').slice(0, 4000)
    })`,
    returnByValue: true,
  });

  sock.removeEventListener("message", onMessage);

  let state = { href: url, rootChildren: -1, text: "" };
  try {
    state = JSON.parse(res?.result?.value ?? "{}");
  } catch {
    // leave defaults
  }
  return { state, consoleErrors, exceptions, serverErrors };
}

const browserPath = findBrowser();
if (!browserPath) {
  console.error("No Chromium-based browser found. Set BROWSER_PATH to one.");
  process.exit(2);
}

const port = 9500 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), "spra-smoke-"));
const browser = spawn(
  browserPath,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--mute-audio",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const results = [];
let passed = 0;
let failed = 0;

try {
  await waitForDevTools(port);
  const targets = await getJson(port, "/json/list");
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("No page target available in the browser.");

  const sock = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      sock.send(JSON.stringify({ id: mid, method, params }));
    });

  await new Promise((resolve, reject) => {
    sock.addEventListener("open", resolve);
    sock.addEventListener("error", () => reject(new Error("DevTools socket failed.")));
  });

  sock.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });

  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.enable");

  console.log(`\nBrowser smoke test against ${BASE}`);
  console.log(`Routes: ${ALL_ROUTES.length}\n`);
  console.log("=".repeat(52));

  for (const route of ALL_ROUTES) {
    const url = BASE + route;
    const { state, consoleErrors, exceptions, serverErrors } = await inspectRoute(
      sock,
      send,
      url,
    );

    const problems = [];
    if (exceptions.length) problems.push(`uncaught: ${exceptions[0].split("\n")[0]}`);
    if (consoleErrors.length) problems.push(`console: ${consoleErrors[0].slice(0, 200)}`);
    if (state.text.includes(ERROR_BOUNDARY_TEXT)) problems.push("error boundary shown");
    if (state.rootChildren <= 0) problems.push("app did not mount");
    if (serverErrors.length) problems.push(`server: ${serverErrors[0]}`);

    // A registered route must reach its intended page. This catches a page that
    // exists as a component but was never added to the router: signed out it
    // looks fine (the sign-in guard renders), so we only assert when the app
    // actually rendered real content rather than the sign-in prompt.
    const signedOut = state.text.includes("Sign in to continue.");
    if (!signedOut && GUARDED_ROUTES.includes(route)) {
      const missedNotFound = NOT_FOUND_MARKERS.some((m) =>
        state.text.includes(m),
      );
      if (missedNotFound) {
        problems.push("fell through to the not-found page (route not registered)");
      }
      const expected = EXPECTED_HEADINGS[route];
      if (expected && !state.text.includes(expected)) {
        problems.push(`expected heading "${expected}" was not rendered`);
      }
    }

    if (problems.length === 0) {
      passed++;
      console.log(`  PASS  ${route}`);
    } else {
      failed++;
      console.log(`  FAIL  ${route}`);
      for (const p of problems) console.log(`          ${p}`);
    }
    results.push({ route, problems });
  }

  console.log("=".repeat(52));
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log("=".repeat(52));
  console.log("");
} catch (error) {
  console.error("Smoke test could not run:", error.message);
  failed++;
} finally {
  browser.kill();
  process.exit(failed === 0 ? 0 : 1);
}
