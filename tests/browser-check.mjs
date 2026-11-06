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
const atMathura = (t) => t.mathura?.status === "selected";
const AT = { chennai: atChennai, kanpur: atKanpur, mathura: atMathura, amritapuri: atAmritapuri };
const published = REGIONALS.filter((r) => r.published);
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
  if (path === "/data.json" && dataMode === "slow") {
    setTimeout(() => res.writeHead(200, { "content-type": "application/json" }).end(readFileSync(join(PUBLIC, "data.json"))), 3000);
    return;
  }
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

let passed = 0;
const failures = [];
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
// A script that fails on the page counts as a failed check, so one run lists every problem.
const js = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const why = (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).split("\n")[0];
    failures.push(`page script failed: ${expression.slice(0, 140)}\n     ${why}`);
    return undefined;
  }
  return r.result.value;
};

await send("Runtime.enable");
await send("Page.enable");
// Headless Chromium marks a page hidden after about 20 seconds and stops drawing it.
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
// Lets the check read what "Share link" copied.
await send("Browser.grantPermissions", { origin: new URL(SITE).origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });

const size = (width, height, mobile = false) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
const open = async (url = SITE) => {
  await send("Page.navigate", { url });
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
  // A hidden page draws no frames, so animations only start now. Let them finish first.
  await sleep(700);
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
const until = async (expression, ms = 1500) => {
  for (let waited = 0; waited < ms; waited += 50) {
    if (await js(`(() => { try { return Boolean(${expression}); } catch { return false; } })()`)) return true;
    await sleep(50);
  }
  return false;
};
const STORE = "pinned-teams";
const pinIn = (user) => `[...document.querySelectorAll("#rows .pin")].find((b) => b.dataset.user === ${JSON.stringify(user)})`;
const pinnedNames = () => js(`[...document.querySelectorAll("#pins .pin-name")].map((n) => n.textContent)`);
const ruleHidden = () => js(`getComputedStyle(document.getElementById("matchRule")).display === "none"`);

const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};

/* First load */
await size(1280, 900);
await open();
const selected = howMany((t) => published.some((r) => AT[r.key](t)));
const pages = Math.ceil(all.length / 100);
check("first load", await result(), `Showing 1–100 of ${india(all.length)} teams`);
check("100 rows", await js(`document.querySelectorAll("#rows .team-row").length`), 100);
check("page count", await js(`document.getElementById("page").textContent`), `Page 1 of ${pages}`);
check("summary", (await js(`document.getElementById("summary").textContent`)).startsWith(`${india(all.length)} teams are in the final pool. ${india(selected)} are selected`), true);
check("one column per published regional", await js(`[...document.querySelectorAll("#head th")].map((t) => t.textContent)`), ["Rank", "Team", "Solved", "Time", "Penalty", ...published.map((r) => r.name), "Details"]);
for (const [key, missing] of Object.entries(data.not_in_pool ?? {})) {
  const name = REGIONALS.find((r) => r.key === key).name;
  const note = `The official list also has ${missing === 1 ? "1 more team that is" : `${missing} more teams that are`} no longer in the final pool.`;
  check(`${name} card explains teams left out`, await js(`[...document.querySelectorAll(".regional")].find((c) => c.querySelector("h2").textContent === ${JSON.stringify(name)}).textContent.includes(${JSON.stringify(note)})`), missing > 0);
}
check("font", await js(`document.fonts.check('15px "Atkinson Hyperlegible Next"')`), true);
const REPO = "https://github.com/aeron-gh/icpc-india-2026-team-finder";
check("repo buttons", await js(`[...document.querySelectorAll(".repo-link")].map((a) => [a.textContent.trim(), a.href, a.target, a.rel])`), [["View on GitHub", REPO, "_blank", "noopener"], ["Star on GitHub", REPO, "_blank", "noopener"]]);
const first = all[0];
check("first team", await js(`document.querySelector("#rows .team-name").textContent`), first.name);
check("solved dots are links", await js(`document.querySelector("#rows .team-row").querySelectorAll("a.dot").length`), first.solved);
check("first dot url", await js(`document.querySelector("#rows a.dot").href`), `https://www.codechef.com/ICPCOL2026/status/PHNCHRG?usernames=${first.user}`);
await shot("laptop-top");
const tickStaysWithWord = () => js(`[...document.querySelectorAll("#rows .status-selected")].every((cell) => { const r = document.createRange(); r.setStart(cell.firstChild, 0); r.setEnd(cell.firstChild, 3); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size === 1; })`);
check("tick stays on the same line as its word", await tickStaysWithWord(), true);
await size(1024, 800);
check("1024px laptop: no sideways scroll", await js(`document.documentElement.scrollWidth <= innerWidth`), true);
check("1024px laptop: tick stays with its word", await tickStaysWithWord(), true);
await size(1280, 900);

/* Show filter */
const hasStatus = (t) => t.amritapuri || t.chennai || t.kanpur || t.mathura;
const mathuraOnly = all.find((t) => atMathura(t) && !t.amritapuri && !t.chennai && !t.kanpur);
const showCases = [
  ["selected", (t) => atChennai(t) || atKanpur(t) || atMathura(t) || atAmritapuri(t)],
  ["two", (t) => atChennai(t) + atKanpur(t) + atMathura(t) + atAmritapuri(t) === 2],
  ["none", (t) => !hasStatus(t)],
  ["chennai-overall", (t) => t.chennai?.category === "Overall topper"],
  ["chennai-inst", (t) => t.chennai?.category === "Institutional topper"],
  ["chennai-waiting", (t) => t.chennai?.status === "waiting"],
  ["kanpur-waiting", (t) => t.kanpur?.status === "waiting"],
  ["kanpur-women", (t) => atKanpur(t) && t.kanpur.quota === "All Women"],
  ["kanpur-tentative", (t) => atKanpur(t) && t.kanpur.quota === "General (Tentative)"],
  ["mathura-waiting", (t) => t.mathura?.status === "waiting"],
  ["mathura-women", (t) => atMathura(t) && t.mathura.quota === "All Women"],
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
const mathuraWaiter = all.find((t) => t.mathura?.status === "waiting" && !t.kanpur && !t.chennai);
if (mathuraWaiter) {
  await type(mathuraWaiter.user);
  const column = published.findIndex((r) => r.key === "mathura");
  check("Mathura waiting team shows waiting", await js(`document.querySelectorAll("#rows .status-cell")[${column}].textContent`), `Waiting list #${mathuraWaiter.mathura.number}`);
  await tick("mathura");
  check("Mathura waiting team is hidden by the Mathura checkbox", await result(), "0 teams");
  await clear();
}
const kanpurWaiter = all.find((t) => t.kanpur?.status === "waiting");
await type(kanpurWaiter.user);
await tick("kanpur");
check("Kanpur waiting team is hidden by the Kanpur checkbox", await result(), "0 teams");
await clear();

/* Regional checkboxes */
const pairs = [];
for (const [i, a] of published.entries()) for (const b of published.slice(i + 1)) pairs.push([[a.key, b.key], [AT[a.key], AT[b.key]]]);
check("checkbox labels", await js(`[...document.querySelectorAll("#regionalChecks label")].map((l) => l.textContent)`),
  REGIONALS.map((r) => (r.published ? `${r.name} (${india(howMany(AT[r.key]))})` : `${r.name} (not out)`)));
check("only unpublished regionals are greyed out", await js(`[...document.querySelectorAll("#regionalChecks input")].map((i) => i.disabled)`), REGIONALS.map((r) => !r.published));
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
const link = `${SITE}?q=${first.user}`;
check("details show the team's link", await js(`document.querySelector(".detail .share-url").textContent`), link);
await js(`document.querySelector(".detail .share").click()`);
check("share copies the team's link", await until(`document.getElementById("toast").classList.contains("show")`), true);
check("share says it copied", await js(`document.getElementById("toast").textContent`), "Link copied");
await sleep(400);
await shot("laptop-share");
check("copied link", await js(`navigator.clipboard.readText()`), link);
await js(`document.querySelector("#rows .more").click()`);
check("details close", await until(`document.querySelector(".detail") === null`), true);
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

/* The address follows the filters */
// Chrome keeps at most 50 Back steps, so start from a clean history to see new ones.
await send("Page.resetNavigationHistory");
const before = await js(`history.length`);
await type("iit");
await tick("mathura");
check("address follows the filters", await js(`location.search`), "?q=iit&at=mathura");
check("typing adds no Back steps", await js(`history.length`), before);
await clear();
check("clear empties the address", await js(`location.search`), "");

await open(`${SITE}?q=${first.user}`);
check("team link fills the search", await js(`document.getElementById("search").value`), first.user);
check("team link shows one team", await result(), "1 team");
check("team link opens its details", await js(`document.querySelector(".detail") !== null`), true);

const both = howMany((t) => atKanpur(t) && atMathura(t));
await open(`${SITE}?at=mathura&at=kanpur&match=all`);
check("link ticks its regionals", await js(`[...document.querySelectorAll("#regionalChecks input:checked")].map((i) => i.value)`), ["kanpur", "mathura"]);
check("link sets the rule", await js(`document.querySelector('input[name="match"]:checked').value`), "all");
check("link gives the same teams", await total(), teamsText(both));

await open(`${SITE}?show=kanpur-waiting&college=${encodeURIComponent(first.college)}`);
check("link picks Show and college", await js(`[document.getElementById("show").value, document.getElementById("college").value]`), ["kanpur-waiting", first.college]);
check("link gives Show and college together", await total(), teamsText(howMany((t) => t.kanpur?.status === "waiting" && t.college === first.college)));

await open(`${SITE}?show=nope&college=nope&solved=99&at=pune&page=2`);
check("unknown link values are ignored", await js(`[document.getElementById("show").value, document.getElementById("college").value, document.getElementById("solved").value, document.querySelectorAll("#regionalChecks input:checked").length]`), ["all", "", "", 0]);
check("a link can open a later page", await result(), `Showing 101–200 of ${india(all.length)} teams`);
check("address drops what it ignored", await js(`location.search`), "?page=2");
await open();

/* Pinned teams */
check("no pins at first", await js(`document.getElementById("pinned").hidden`), true);
await js(`${pinIn(first.user)}.click()`);
check("pin shows the team at the top", await pinnedNames(), [first.name]);
check("pin button shows it is on", await js(`${pinIn(first.user)}.getAttribute("aria-pressed")`), "true");
check("pin is saved", await js(`localStorage.getItem("${STORE}")`), JSON.stringify([first.user]));
await open();
check("pin stays after a reload", await pinnedNames(), [first.name]);
const mathuraNext = REGIONALS.find((r) => r.key === "mathura").deadlines.filter((d) => new Date(d.iso) > new Date()).sort((a, b) => new Date(a.iso) - new Date(b.iso))[0];
await type(mathuraOnly.user);
await js(`${pinIn(mathuraOnly.user)}.click()`);
check("pins are in rank order", await pinnedNames(), [first, mathuraOnly].sort((a, b) => a.rank - b.rank).map((t) => t.name));
await js(`scrollTo(0, document.getElementById("finder").offsetTop - 20)`);
await sleep(400);
await shot("laptop-pinned");
const mathuraCard = `[...document.querySelectorAll("#pins li")].find((c) => c.querySelector(".pin-name").textContent === ${JSON.stringify(mathuraOnly.name)})`;
check("pinned card shows its status", await js(`${mathuraCard}.textContent.includes("Mathura: ✓\u00a0${mathuraOnly.mathura.quota}")`), true);
if (mathuraNext) check("pinned card shows its next deadline", await js(`${mathuraCard}.querySelector(".pin-next").textContent`), `Next deadline: ${mathuraNext.label} (Mathura), ${mathuraNext.when}`);
await js(`${mathuraCard}.querySelector(".unpin").click()`);
check("unpin removes the card", await until(`document.querySelectorAll("#pins li").length === 1`), true);
check("unpin turns the row button off", await js(`${pinIn(mathuraOnly.user)}.getAttribute("aria-pressed")`), "false");
check("unpin is saved", await js(`localStorage.getItem("${STORE}")`), JSON.stringify([first.user]));
await clear();
await js(`${pinIn(first.user)}.click()`);
check("last unpin hides the box", await until(`document.getElementById("pinned").hidden`), true);

await js(`localStorage.setItem("${STORE}", JSON.stringify(["icpcol000000", "not a team"]))`);
await open();
check("pins for teams not in the list are dropped", await js(`[document.getElementById("pinned").hidden, localStorage.getItem("${STORE}")]`), [true, "[]"]);
await js(`localStorage.setItem("${STORE}", "{broken")`);
await open();
check("broken saved pins do not break the page", await result(), `Showing 1–100 of ${india(all.length)} teams`);

const blocked = await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error("blocked"); };`,
});
await open();
check("blocked storage: list still loads", await result(), `Showing 1–100 of ${india(all.length)} teams`);
await js(`${pinIn(first.user)}.click()`);
check("blocked storage: pins still work for this visit", await pinnedNames(), [first.name]);
await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: blocked.identifier });
await js(`localStorage.clear()`);

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

/* While the list loads */
dataMode = "slow";
await send("Page.navigate", { url: SITE });
check("placeholder shows while loading", await until(`!document.getElementById("skeleton").hidden && document.getElementById("result").textContent === "Loading teams..."`, 2500), true);
check("placeholder goes once loaded", await until(`document.getElementById("skeleton").hidden`, 6000), true);

/* Data file fails to load */
dataMode = "broken";
pageErrors.length = 0;
await open();
check("failed load message", await result(), "The team list did not load. Refresh the page to try again.");
check("failed load hides the placeholder", await js(`document.getElementById("skeleton").hidden`), true);
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
  await type(mathuraOnly.user);
  check(`${width}px Mathura-only team has no "not on a list" note`, await js(`document.querySelector("#rows .none-note") === null`), true);
  const unlisted = all.find((t) => !hasStatus(t));
  await type(unlisted.user);
  check(`${width}px team on no list says so`, await js(`document.querySelector("#rows .none-note")?.textContent`), "Not on a published list yet");
  check(`${width}px pin is easy to tap`, await js(`(() => { const r = document.querySelector("#rows .pin").getBoundingClientRect(); return r.width >= 40 && r.height >= 40; })()`), true);
  check(`${width}px pin says what it does`, await js(`document.querySelector("#rows .pin").innerText.trim()`), "Pin");
  await js(`document.querySelector("#rows .pin").click()`);
  check(`${width}px pin says when it is on`, await js(`document.querySelector("#rows .pin").innerText.trim()`), "Pinned");
  check(`${width}px no sideways scroll with a pinned team`, await noSideways(), true);
  await js(`document.getElementById("finder").scrollIntoView()`);
  await sleep(400);
  await shot(`phone-${width}-pinned`);
  await js(`document.querySelector("#rows .pin").click()`);
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

/* People who turn motion off see no animation */
await size(1280, 900);
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await open();
await tick("mathura");
check("reduced motion: rows appear at once", await js(`getComputedStyle(document.querySelector("#rows .team-row")).opacity`), "1");
await js(`document.querySelector("#rows .more").click()`);
check("reduced motion: details appear at once", await js(`getComputedStyle(document.querySelector(".detail .reveal")).opacity`), "1");
check("reduced motion: placeholder does not move", await js(`getComputedStyle(document.querySelector("#skeleton .bar")).animationName`), "none");
await send("Emulation.setEmulatedMedia", { features: [] });
await open();
await tick("mathura");
check("motion on: rows slide in", await js(`getComputedStyle(document.querySelector("#rows .team-row")).animationName`), "rise");

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
