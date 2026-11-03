// Opens the real page in headless Chromium and uses it like a student would.
// Run it after every data update:  npm run check
// Add a folder to also save screenshots:  node tests/browser-check.mjs shots
// Expected counts are worked out here from data.json, separately from public/logic.js.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { REGIONALS } from "../public/info.js";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const SHOTS = process.argv[2];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const data = JSON.parse(readFileSync(join(PUBLIC, "data.json"), "utf-8"));
const all = data.teams;
const atChennai = (t) => t.chennai?.status === "selected";
const atKanpur = (t) => t.kanpur?.status === "selected";
const atAmritapuri = (t) => Boolean(t.amritapuri);
const howMany = (test) => all.filter(test).length;
const india = (n) => n.toLocaleString("en-IN");
const teamsText = (n) => (n === 1 ? "1 team" : `${india(n)} teams`);

const ATTACK = JSON.stringify({
  checked: data.checked,
  counts: { ...data.counts, pool: 1 },
  teams: [{
    rank: 1, user: 'evil"><img src=x onerror="window.__xss=3">', name: '<img src=x onerror="window.__xss=1">',
    college: "<script>window.__xss=2</script>", short: "<b>bold</b>", solved: 1, time: "00:10:00", penalty: 0, problems: "1000000000",
  }],
});

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
let dataMode = "real";
const server = http.createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/data.json" && dataMode === "attack") return res.writeHead(200, { "content-type": "application/json" }).end(ATTACK);
  if (path === "/data.json" && dataMode === "broken") return res.writeHead(500).end("broken");
  try {
    const file = join(PUBLIC, normalize(path === "/" ? "/index.html" : path));
    const body = readFileSync(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const SITE = `http://127.0.0.1:${server.address().port}/`;

const profile = mkdtempSync(join(tmpdir(), "team-finder-check-"));
const chrome = spawn(
  process.env.CHROME ?? "chromium",
  ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let wsUrl;
for await (const chunk of chrome.stderr) {
  const found = String(chunk).match(/ws:\/\/[^\s]+/);
  if (found) { wsUrl = found[0]; break; }
}
const targets = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener("open", ok));

let nextId = 0;
const waiting = new Map();
const pageErrors = [];
ws.addEventListener("message", ({ data: raw }) => {
  const msg = JSON.parse(raw);
  if (msg.id && waiting.has(msg.id)) {
    const { ok, no } = waiting.get(msg.id);
    waiting.delete(msg.id);
    msg.error ? no(new Error(JSON.stringify(msg.error))) : ok(msg.result);
  }
  if (msg.method === "Runtime.exceptionThrown") pageErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") pageErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
});
const send = (method, params = {}) => new Promise((ok, no) => {
  const id = ++nextId;
  const timer = setTimeout(() => no(new Error(`timed out: ${method}`)), 20000);
  waiting.set(id, { ok: (v) => { clearTimeout(timer); ok(v); }, no: (e) => { clearTimeout(timer); no(e); } });
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await send("Runtime.enable");
await send("Page.enable");
// Headless Chromium marks a page hidden after about 20 seconds and stops drawing it.
await send("Emulation.setFocusEmulationEnabled", { enabled: true });

const size = (width, height, mobile = false) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
const open = async () => {
  await send("Page.navigate", { url: SITE });
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    const text = await js(`document.getElementById("result")?.textContent ?? ""`).catch(() => "");
    if (text && !text.startsWith("Loading")) break;
  }
  await js("document.fonts.ready.then(() => true)");
};
const shot = async (name) => {
  if (!SHOTS) return;
  await send("Page.bringToFront");
  const { data: image } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(image, "base64"));
};
const result = () => js(`document.getElementById("result").textContent`);
const total = async () => (await result()).split(" of ").at(-1);
const pick = (id, value) => js(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
const clear = () => js(`document.getElementById("clear").hidden || document.getElementById("clear").click()`);
const type = async (text) => {
  await js(`(() => { const e = document.getElementById("search"); e.focus(); e.value = ""; e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await send("Input.insertText", { text });
};
const tick = (key) => js(`document.querySelector('#regionalChecks input[value="${key}"]').click()`);
const rule = (value) => js(`document.querySelector('input[name="match"][value="${value}"]').click()`);
const ruleHidden = () => js(`getComputedStyle(document.getElementById("matchRule")).display === "none"`);

let passed = 0;
const failures = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};

/* First load */
await size(1280, 900);
await open();
const selected = howMany((t) => atChennai(t) || atKanpur(t) || atAmritapuri(t));
const pages = Math.ceil(all.length / 100);
check("first load", await result(), `Showing 1–100 of ${india(all.length)} teams`);
check("100 rows", await js(`document.querySelectorAll("#rows .team-row").length`), 100);
check("page count", await js(`document.getElementById("page").textContent`), `Page 1 of ${pages}`);
check("summary", (await js(`document.getElementById("summary").textContent`)).startsWith(`${india(all.length)} teams are in the final pool. ${india(selected)} are selected`), true);
check("font", await js(`document.fonts.check('15px "Atkinson Hyperlegible Next"')`), true);
const REPO = "https://github.com/aeron-gh/icpc-india-2026-team-finder";
check("repo buttons", await js(`[...document.querySelectorAll(".repo-link")].map((a) => [a.textContent.trim(), a.href, a.target, a.rel])`), [["View on GitHub", REPO, "_blank", "noopener"], ["Star on GitHub", REPO, "_blank", "noopener"]]);
const first = all[0];
check("first team", await js(`document.querySelector("#rows .team-name").textContent`), first.name);
check("solved dots are links", await js(`document.querySelector("#rows .team-row").querySelectorAll("a.dot").length`), first.solved);
check("first dot url", await js(`document.querySelector("#rows a.dot").href`), `https://www.codechef.com/ICPCOL2026/status/PHNCHRG?usernames=${first.user}`);
await shot("laptop-top");

/* Show filter */
const hasStatus = (t) => t.amritapuri || t.chennai || t.kanpur;
const showCases = [
  ["selected", (t) => atChennai(t) || atKanpur(t) || atAmritapuri(t)],
  ["two", (t) => atChennai(t) + atKanpur(t) + atAmritapuri(t) === 2],
  ["none", (t) => !hasStatus(t)],
  ["chennai-overall", (t) => t.chennai?.category === "Overall topper"],
  ["chennai-inst", (t) => t.chennai?.category === "Institutional topper"],
  ["chennai-waiting", (t) => t.chennai?.status === "waiting"],
  ["kanpur-waiting", (t) => t.kanpur?.status === "waiting"],
  ["kanpur-women", (t) => atKanpur(t) && t.kanpur.quota === "All Women"],
  ["kanpur-tentative", (t) => atKanpur(t) && t.kanpur.quota === "General (Tentative)"],
  ["amritapuri-Amritapuri", (t) => t.amritapuri?.centre === "Amritapuri"],
  ["amritapuri-Bengaluru", (t) => t.amritapuri?.centre === "Bengaluru"],
  ["amritapuri-Coimbatore", (t) => t.amritapuri?.centre === "Coimbatore"],
  ["amritapuri-Mysuru", (t) => t.amritapuri?.centre === "Mysuru"],
];
for (const [id, test] of showCases) {
  const want = howMany(test);
  if (want === 0) continue;
  await pick("show", id);
  check(`show ${id}`, await total(), teamsText(want));
}
await clear();
check("clear resets", await result(), `Showing 1–100 of ${india(all.length)} teams`);
check("clear hides itself", await js(`document.getElementById("clear").hidden`), true);

/* Waiting lists */
const chennaiWaiter = all.find((t) => t.chennai?.status === "waiting" && !t.kanpur && !t.amritapuri);
if (chennaiWaiter) {
  await type(chennaiWaiter.user);
  check("Chennai waiting team shows waiting", await js(`document.querySelectorAll("#rows .status-cell")[0].textContent`), `Waiting list #${chennaiWaiter.chennai.number}`);
  check("Chennai waiting team is not shown as selected", await js(`document.querySelector("#rows .status-cell").className.includes("status-waiting")`), true);
  await tick("chennai");
  check("Chennai waiting team is hidden by the Chennai checkbox", await result(), "0 teams");
  await clear();
}
const kanpurWaiter = all.find((t) => t.kanpur?.status === "waiting");
await type(kanpurWaiter.user);
await tick("kanpur");
check("Kanpur waiting team is hidden by the Kanpur checkbox", await result(), "0 teams");
await clear();

/* Regional checkboxes */
const pairs = [
  [["chennai", "kanpur"], [atChennai, atKanpur]],
  [["kanpur", "amritapuri"], [atKanpur, atAmritapuri]],
  [["chennai", "amritapuri"], [atChennai, atAmritapuri]],
];
check("checkbox labels", await js(`[...document.querySelectorAll("#regionalChecks label")].map((l) => l.textContent)`), [
  `Chennai (${india(howMany(atChennai))})`, `Kanpur (${india(howMany(atKanpur))})`, "Mathura (not out)", `Amritapuri (${india(howMany(atAmritapuri))})`,
]);
check("Mathura is greyed out", await js(`document.querySelector('#regionalChecks input[value="mathura"]').disabled`), true);
check("rule hidden at first", await ruleHidden(), true);
for (const [[a, b], [testA, testB]] of pairs) {
  const any = howMany((t) => testA(t) || testB(t));
  const both = howMany((t) => testA(t) && testB(t));
  await tick(a);
  check(`${a} alone hides the rule`, await ruleHidden(), true);
  check(`${a} alone`, await total(), teamsText(howMany(testA)));
  await tick(b);
  check(`${a} or ${b}`, await total(), teamsText(any));
  check(`${a} + ${b} rule text`, await js(`[...document.querySelectorAll("#matchRule label")].map((l) => l.textContent)`), [`Any of these (${india(any)})`, `All of these (${india(both)})`]);
  await rule("all");
  check(`${a} and ${b}`, await total(), teamsText(both));
  await clear();
}
await tick("kanpur");
await tick("amritapuri");
await shot("laptop-checkboxes");
await clear();
check("clear unticks everything", await js(`[document.querySelectorAll("#regionalChecks input:checked").length, document.querySelector('input[name="match"]:checked').value]`), [0, "any"]);

/* Solved, college and search */
await pick("solved", String(first.solved));
check("solved filter", await total(), teamsText(howMany((t) => t.solved === first.solved)));
await clear();
await pick("college", first.college);
check("college filter", await total(), teamsText(howMany((t) => t.college === first.college)));
await clear();
await type(first.user);
check("search by username", await result(), "1 team");
await js(`document.querySelector("#rows .more").click()`);
check("details open", (await js(`document.querySelector(".detail").textContent`)).includes(`Username${first.user}`), true);
check("details links", await js(`[document.querySelectorAll(".detail a.problem-link").length, document.querySelectorAll(".detail .problem-no").length]`), [first.solved, 10 - first.solved]);
await js(`document.querySelector("#rows .more").click()`);
check("details close", await js(`document.querySelector(".detail") === null`), true);
const multi = all.find((t) => t.names?.length);
await type(multi.names[0].id);
check("search by Team ID", await js(`document.querySelector("#rows .team-name").textContent`), multi.name);
const brackets = all.find((t) => t.name.includes("<"));
await type(brackets.name);
check("name with brackets stays as typed", await js(`document.querySelector("#rows .team-name").textContent`), brackets.name);
await type("zzzzqqqq");
check("no match", await js(`[document.getElementById("result").textContent, document.getElementById("empty").hidden, getComputedStyle(document.getElementById("teams")).display, getComputedStyle(document.getElementById("pager")).display]`), ["0 teams", false, "none", "none"]);
await clear();

/* Paging */
await js(`document.getElementById("nextPage").click()`);
check("next page", await result(), `Showing 101–200 of ${india(all.length)} teams`);
for (let i = 2; i < pages; i++) await js(`document.getElementById("nextPage").click()`);
check("last page", await result(), `Showing ${india((pages - 1) * 100 + 1)}–${india(all.length)} of ${india(all.length)} teams`);
check("next disabled at the end", await js(`document.getElementById("nextPage").disabled`), true);
await type("a");
check("new search goes back to page 1", (await js(`document.getElementById("page").textContent`)).startsWith("Page 1 "), true);
await clear();

/* Deadlines close by themselves */
const deadlines = REGIONALS.flatMap((r) => r.deadlines.map((d) => ({ regional: r.name, ...d }))).sort((a, b) => new Date(a.iso) - new Date(b.iso));
const afterFirst = new Date(new Date(deadlines[0].iso).getTime() + 60000).toISOString();
const moved = await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `{ const R = Date; const fixed = new R("${afterFirst}").getTime(); globalThis.Date = class extends R { constructor(...a) { a.length ? super(...a) : super(fixed); } static now() { return fixed; } }; }`,
});
await open();
check("first deadline is marked closed", await js(`[...document.querySelectorAll(".regional li.closed")].some((l) => l.textContent.startsWith(${JSON.stringify(deadlines[0].label)}) && l.textContent.endsWith("(closed)") && !l.querySelector("a"))`), true);
check("next deadline moves on", await js(`document.getElementById("next").textContent`), `Next deadline: ${deadlines[1].label} (${deadlines[1].regional}), ${deadlines[1].when}`);
await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: moved.identifier });

/* Team names written as attacks stay plain text */
dataMode = "attack";
await open();
await sleep(300);
check("attack name is plain text", await js(`document.querySelector("#rows .team-name").textContent`), '<img src=x onerror="window.__xss=1">');
await js(`document.querySelector("#rows .more").click()`);
await sleep(200);
check("nothing injected", await js(`document.querySelectorAll("#rows img, #rows script, #rows b").length`), 0);
check("attack did not run", await js(`String(window.__xss)`), "undefined");

/* Data file fails to load */
dataMode = "broken";
pageErrors.length = 0;
await open();
check("failed load message", await result(), "The team list did not load. Refresh the page to try again.");
check("failed load hides the table", await js(`getComputedStyle(document.getElementById("teams")).display`), "none");
pageErrors.length = 0;
dataMode = "real";

/* Phones */
for (const width of [375, 320]) {
  await size(width, 800, true);
  await open();
  const noSideways = () => js(`document.documentElement.scrollWidth <= innerWidth`);
  check(`${width}px no sideways scroll`, await noSideways(), true);
  check(`${width}px dates start closed`, await js(`document.getElementById("dates").open`), false);
  check(`${width}px repo buttons fit`, await js(`[...document.querySelectorAll(".repo-link")].every((a) => { const r = a.getBoundingClientRect(); return r.height >= 40 && r.right <= innerWidth && r.left >= 0; })`), true);
  check(`${width}px search hint fits`, await js(`(() => { const e = document.getElementById("search"); const s = getComputedStyle(e); const c = document.createElement("canvas").getContext("2d"); c.font = s.fontSize + " " + s.fontFamily; return c.measureText(e.placeholder).width <= e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); })()`), true);
  check(`${width}px dots are big enough to tap`, await js(`(() => { const r = document.querySelector("a.dot").getBoundingClientRect(); return r.width >= 26 && r.height >= 34; })()`), true);
  check(`${width}px dots stay on screen`, await js(`[...document.querySelector("#rows .team-row").querySelectorAll(".dot")].every((d) => d.getBoundingClientRect().right <= innerWidth)`), true);
  await tick("kanpur");
  await tick("amritapuri");
  check(`${width}px no sideways scroll with the rule showing`, await noSideways(), true);
  check(`${width}px checkboxes are easy to tap`, await js(`[...document.querySelectorAll("#regionalChecks label, #matchRule label")].every((l) => l.getBoundingClientRect().height >= 40)`), true);
  await clear();
  const waiter = chennaiWaiter ?? kanpurWaiter;
  await type(waiter.user);
  await js(`document.querySelector("#rows .more").click()`);
  await sleep(100);
  check(`${width}px codes stay whole`, await js(`[...document.querySelectorAll(".detail .problem-link, .detail .problem-no")].every((p) => p.getClientRects().length === 1)`), true);
  check(`${width}px no sideways scroll with details open`, await noSideways(), true);
  await js(`document.querySelector(".team-row").scrollIntoView({ block: "center" })`);
  await sleep(100);
  await shot(`phone-${width}-card`);
  await clear();
  await js(`document.getElementById("dates").open = true`);
  await sleep(100);
  check(`${width}px no sideways scroll with dates open`, await noSideways(), true);
  await js(`document.getElementById("dates").scrollIntoView()`);
  await sleep(100);
  await shot(`phone-${width}-dates`);
}

/* Dark mode */
await size(1280, 900);
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await open();
await shot("laptop-dark");
check("dark background", await js(`getComputedStyle(document.body).backgroundColor`), "rgb(18, 23, 29)");

check("no errors on the page", pageErrors, []);
console.log(`${passed} checks passed, ${failures.length} failed`);
for (const failure of failures) console.log(` FAIL ${failure}`);

ws.close();
chrome.kill();
server.close();
await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(failures.length ? 1 : 0);
