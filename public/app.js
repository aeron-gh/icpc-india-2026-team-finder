// Connects the data and rules to the page.
// Team names come from outside (one team is called <hopefullytopkfrombits.h>), so all text
// goes in through el(), which adds it as plain text. Never use innerHTML here.

import { LINKS, REGIONALS } from "./info.js";
import {
  NO_FILTERS,
  SHOW_GROUPS,
  collegeOptions,
  filterTeams,
  filtersFromQuery,
  filtersToQuery,
  isClosed,
  nextDeadline,
  number,
  onAnyList,
  paginate,
  pinsFrom,
  prepareTeams,
  regionalStatus,
  resultText,
  submissionLinks,
  teamDeadlines,
} from "./logic.js";

const PAGE_SIZE = 100;
const PIN_STORE = "pinned-teams";
const LISTS_OUT = REGIONALS.filter((regional) => regional.published);
const byId = (id) => document.getElementById(id);

const state = { ...NO_FILTERS };
let teams = [];
let pins = [];

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "role" || key.startsWith("aria-") || key.startsWith("data-")) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children);
  return node;
}

const externalLink = (text, href, props = {}) => el("a", { href, target: "_blank", rel: "noopener", ...props }, text);

function svg(tag, attributes) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

/* Motion */

// How long animations take comes from style.css, which makes it 0 when someone turns motion off.
const motion = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur")) || 0;

// "shut" is the closed look. Removing it two frames after the node appears lets the opening play.
// "moving" hides overflow only while it plays, so focus outlines are not cut off afterwards.
function enter(node) {
  const time = motion();
  if (!time) return;
  node.classList.add("shut", "moving");
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.remove("shut")));
  setTimeout(() => node.classList.remove("moving"), time + 50);
}

function leave(node, done) {
  node.classList.add("shut", "moving");
  setTimeout(done, motion());
}

let toastTimer;
function toast(text) {
  byId("toast").textContent = text;
  byId("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => byId("toast").classList.remove("show"), 2000);
}

/* Sharing */

const teamLink = (team) => `${location.origin}${location.pathname}${filtersToQuery({ ...NO_FILTERS, query: team.user })}`;

// Phones open their share menu. Elsewhere the link is copied.
async function share(team) {
  const url = teamLink(team);
  if (navigator.share) {
    try {
      await navigator.share({ title: team.name, url });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied");
  } catch {
    toast("Copy the link shown next to the button");
  }
}

/* Pinned teams. Storage can be blocked, so pins then last only for this visit. */

function loadPins() {
  let saved = null;
  try {
    saved = localStorage.getItem(PIN_STORE);
  } catch {}
  pins = pinsFrom(saved, teams);
  savePins();
}

function savePins() {
  try {
    localStorage.setItem(PIN_STORE, JSON.stringify(pins));
  } catch {}
}

function showPinState(button, team) {
  const on = pins.includes(team.user);
  button.setAttribute("aria-pressed", String(on));
  button.setAttribute("aria-label", on ? `Unpin ${team.name}` : `Pin ${team.name} to the top`);
  button.title = on ? "Unpin" : "Pin to the top";
  // Phones have no hover to show the title, so they also show a word.
  button.querySelector(".pin-word").textContent = on ? "Pinned" : "Pin";
}

function pinButton(team) {
  const button = el(
    "button",
    { type: "button", className: "pin", "data-user": team.user },
    svg("svg", { viewBox: "0 0 16 16", "aria-hidden": "true" }),
    el("span", { className: "pin-word", "aria-hidden": "true" }),
  );
  button.firstChild.append(svg("circle", { cx: "8", cy: "5.5", r: "3.8" }), svg("path", { d: "M8 9.3V15" }));
  showPinState(button, team);
  button.addEventListener("click", () => togglePin(team));
  return button;
}

function togglePin(team) {
  const on = !pins.includes(team.user);
  pins = on ? [...pins, team.user] : pins.filter((user) => user !== team.user);
  savePins();
  for (const button of document.querySelectorAll("#rows .pin")) {
    if (button.dataset.user !== team.user) continue;
    showPinState(button, team);
    button.classList.remove("popped");
    if (on) {
      void button.offsetWidth;
      button.classList.add("popped");
    }
  }
  const card = [...byId("pins").children].find((item) => item.dataset.user === team.user);
  if (!on && card) leave(card, () => renderPins());
  else renderPins(on ? team.user : null);
}

function pinCard(team, fresh) {
  const statuses = LISTS_OUT.map((regional) => [regional, regionalStatus(team, regional.key)]).filter(
    ([, status]) => status.kind !== "none",
  );
  const unpin = el("button", { type: "button", className: "text-button unpin" }, "Unpin");
  unpin.addEventListener("click", () => togglePin(team));
  const deadlines = teamDeadlines(team, LISTS_OUT, new Date()).map((deadline) =>
    el(
      "p",
      { className: "pin-next" },
      el("b", {}, "Next deadline: "),
      deadline.url ? externalLink(deadline.label, deadline.url) : deadline.label,
      ` (${deadline.regional}), ${deadline.when}`,
    ),
  );
  const card = el(
    "li",
    { className: "pin-card reveal", "data-user": team.user },
    el(
      "div",
      {},
      el(
        "div",
        { className: "pin-inner" },
        el("span", { className: "pin-name" }, team.name),
        el("span", { className: "pin-meta" }, `${team.short} · Rank ${number(team.rank)}`),
        ...(statuses.length
          ? statuses.map(([regional, status]) =>
              el("span", { className: `status-${status.kind}` }, `${regional.name}: ${statusText(status)}`),
            )
          : [el("span", { className: "pin-meta" }, "Not on a published list yet")]),
        unpin,
        ...deadlines,
      ),
    ),
  );
  if (fresh) enter(card);
  return card;
}

// Teams are in rank order, so pins are too.
function renderPins(fresh = null) {
  const pinned = teams.filter((team) => pins.includes(team.user));
  byId("pinned").hidden = pinned.length === 0;
  byId("pins").replaceChildren(...pinned.map((team) => pinCard(team, team.user === fresh)));
}

/* Top of the page */

function teamCountLine(regional, counts) {
  if (regional.key === "chennai") {
    const open = counts.chennai_open_women;
    const waiting = `, ${counts.chennai_waiting} on the waiting list`;
    return `${number(counts.chennai)} teams selected${waiting}${open ? `, ${open} women's slots still open` : ""}`;
  }
  if (regional.key === "kanpur" || regional.key === "mathura") {
    return `${number(counts[regional.key])} teams selected, ${counts[`${regional.key}_waiting`]} on the waiting list`;
  }
  if (regional.key === "amritapuri") return `${number(counts.amritapuri)} teams selected`;
  return "List not published yet";
}

function deadlineItem(deadline, now) {
  const closed = isClosed(deadline.iso, now);
  const title = el("b", {}, deadline.url && !closed ? externalLink(deadline.label, deadline.url) : deadline.label);
  return el("li", { className: closed ? "closed" : "" }, title, closed ? `${deadline.when} (closed)` : deadline.when);
}

function notInPoolLine(regional, notInPool) {
  const missing = notInPool?.[regional.key] ?? 0;
  if (!missing) return "";
  const teams = missing === 1 ? "1 more team that is" : `${missing} more teams that are`;
  return el("p", { className: "quiet" }, `The official list also has ${teams} no longer in the final pool.`);
}

function regionalColumn(regional, counts, notInPool, now) {
  const links = [externalLink("Official site", regional.site)];
  if (regional.list) links.push(externalLink("Official list", regional.list));
  return el(
    "section",
    { className: `regional${regional.published ? " is-out" : ""}` },
    el("h2", {}, regional.name),
    el("p", { className: "when" }, regional.dates),
    el("p", { className: "quiet" }, regional.where),
    el("p", { className: "quiet" }, regional.fee),
    el("p", { className: "count" }, teamCountLine(regional, counts)),
    notInPoolLine(regional, notInPool),
    regional.deadlines.length ? el("ul", {}, ...regional.deadlines.map((deadline) => deadlineItem(deadline, now))) : "",
    regional.warning ? el("p", { className: "warning" }, regional.warning) : "",
    regional.note ? el("p", { className: "quiet" }, regional.note) : "",
    el("p", { className: "site-links" }, ...links),
  );
}

function renderTop({ counts, checked, not_in_pool: notInPool }, now) {
  const waitingFor = REGIONALS.filter((regional) => !regional.published).map((regional) => regional.name);
  byId("summary").textContent =
    `${number(counts.pool)} teams are in the final pool. ${number(counts.selected)} are selected so far across ` +
    (waitingFor.length
      ? `${LISTS_OUT.map((regional) => regional.name).join(", ")}. Still to come: ${waitingFor.join(", ")}.`
      : "all four regionals.");

  const day = new Date(`${checked}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  byId("checked").textContent = `Unofficial page. Always confirm on the official sites. Lists last checked ${day}.`;

  const next = nextDeadline(REGIONALS, now);
  if (next) {
    const label = next.url ? externalLink(next.label, next.url) : next.label;
    byId("next").replaceChildren("Next deadline: ", label, ` (${next.regional}), ${next.when}`);
    byId("next").hidden = false;
  }

  byId("regionals").replaceChildren(...REGIONALS.map((regional) => regionalColumn(regional, counts, notInPool, now)));
  byId("links").replaceChildren(...LINKS.map((link) => el("li", {}, externalLink(link.label, link.url))));

  const small = matchMedia("(max-width: 980px)");
  const fit = () => {
    byId("dates").open = !small.matches;
  };
  fit();
  small.addEventListener("change", fit);
}

/* Filters */

function fillRegionalChecks(counts) {
  byId("regionalChecks").replaceChildren(
    ...REGIONALS.map((regional) => {
      const box = el("input", { type: "checkbox", value: regional.key, disabled: !regional.published });
      const text = regional.published ? `${regional.name} (${number(counts[regional.key])})` : `${regional.name} (not out)`;
      return el("label", { className: regional.published ? "check" : "check is-off" }, box, text);
    }),
  );
}

function fillFilters() {
  const groups = SHOW_GROUPS.map((group) => {
    const options = group.options
      .map((option) => [option, filterTeams(teams, { show: option.id }).length])
      .filter(([, count]) => count > 0)
      .map(([option, count]) => el("option", { value: option.id }, `${option.label} (${number(count)})`));
    return el("optgroup", { label: group.label }, ...options);
  });
  byId("show").replaceChildren(...groups);

  const solvedCounts = new Map();
  for (const team of teams) solvedCounts.set(team.solved, (solvedCounts.get(team.solved) ?? 0) + 1);
  const solved = [...solvedCounts].sort((a, b) => b[0] - a[0]);
  byId("solved").replaceChildren(
    el("option", { value: "" }, "Any number"),
    ...solved.map(([count, total]) => el("option", { value: String(count) }, `${count} solved (${number(total)})`)),
  );

  byId("college").replaceChildren(
    el("option", { value: "" }, "All colleges"),
    ...collegeOptions(teams).map((option) => el("option", { value: option.value }, option.label)),
  );
}

// A shared link sets the filters. A value the page has no option for stays at its default.
function applyLink() {
  const wanted = filtersFromQuery(location.search, LISTS_OUT.map((regional) => regional.key));
  const choose = (id, value, fallback) => {
    const box = byId(id);
    box.value = value;
    if (box.selectedIndex < 0 || box.value !== value) box.value = fallback;
    return box.value;
  };
  Object.assign(state, wanted, {
    show: choose("show", wanted.show, "all"),
    solved: choose("solved", wanted.solved, ""),
    college: choose("college", wanted.college, ""),
  });
  byId("search").value = wanted.query;
  for (const box of byId("regionalChecks").querySelectorAll("input")) box.checked = wanted.regionals.includes(box.value);
  document.querySelector(`input[name="match"][value="${wanted.match}"]`).checked = true;
}

function watchFilters() {
  // Rows slide in after a filter change, but not on every letter typed.
  const update = (key, animate = true) => (event) => {
    state[key] = event.target.value;
    state.page = 1;
    renderTeams({ animate });
  };
  byId("search").addEventListener("input", update("query", false));
  byId("show").addEventListener("change", update("show"));
  byId("solved").addEventListener("change", update("solved"));
  byId("college").addEventListener("change", update("college"));
  byId("matchRule").addEventListener("change", update("match"));

  const boxes = () => byId("regionalChecks").querySelectorAll("input");
  byId("regionalChecks").addEventListener("change", () => {
    state.regionals = [...boxes()].filter((box) => box.checked).map((box) => box.value);
    state.page = 1;
    renderTeams();
  });

  byId("clear").addEventListener("click", () => {
    Object.assign(state, NO_FILTERS);
    for (const box of boxes()) box.checked = false;
    document.querySelector('input[name="match"][value="any"]').checked = true;
    byId("search").value = "";
    byId("show").value = "all";
    byId("solved").value = "";
    byId("college").value = "";
    renderTeams();
    byId("search").focus();
  });

  const turnPage = (change) => () => {
    state.page += change;
    renderTeams();
    byId("result").scrollIntoView({ behavior: motion() ? "smooth" : "auto" });
  };
  byId("prev").addEventListener("click", turnPage(-1));
  byId("nextPage").addEventListener("click", turnPage(1));
}

/* The table */

function renderHead() {
  byId("head").replaceChildren(
    el("th", { className: "num", scope: "col" }, "Rank"),
    el("th", { scope: "col" }, "Team"),
    el("th", { scope: "col" }, "Solved"),
    el("th", { className: "num", scope: "col" }, "Time"),
    el("th", { className: "num", scope: "col" }, "Penalty"),
    ...LISTS_OUT.map((regional) => el("th", { scope: "col" }, regional.name)),
    el("th", { scope: "col" }, el("span", { className: "sr" }, "Details")),
  );
}

function dots(team) {
  const items = submissionLinks(team).map((problem) =>
    problem.solved
      ? externalLink("", problem.url, {
          className: "dot solved",
          title: `${problem.code}: see submissions`,
          "aria-label": `${problem.code}: see submissions by ${team.name} on CodeChef`,
        })
      : el("span", {
          className: "dot",
          title: `${problem.code}: not solved`,
          role: "img",
          "aria-label": `${problem.code}: not solved`,
        }),
  );
  return el("span", { className: "dots" }, ...items);
}

// A non-breaking space keeps the tick on the same line as its first word.
function statusText(status) {
  return status.kind === "selected" ? `✓\u00a0${status.text}` : status.text || "–";
}

function statusCell(team, regional) {
  const status = regionalStatus(team, regional.key);
  const className = `status-cell label-cell status-${status.kind}`;
  return el("td", { className, "data-label": `${regional.name}:` }, statusText(status));
}

function detailRow(team) {
  const entries = [
    ["Username", team.user],
    ["College", team.college],
  ];
  for (const entry of team.names ?? []) {
    entries.push([`${entry.regional} name`, `${entry.name} (Team ID ${entry.id})`]);
  }
  for (const regional of ["kanpur", "mathura"]) {
    const entry = team[regional];
    if (entry && !team.names?.some((name) => name.id === entry.id)) {
      const label = REGIONALS.find((item) => item.key === regional).name;
      entries.push([`${label} Team ID`, entry.id]);
    }
  }
  if (team.amritapuri) entries.push(["Amritapuri list", `Rank ${team.amritapuri.rank}`]);

  const list = el("dl", {});
  for (const [term, value] of entries) list.append(el("dt", {}, term), el("dd", {}, value));

  const problems = submissionLinks(team);
  const solved = problems.filter((problem) => problem.solved);
  const unsolved = problems.filter((problem) => !problem.solved);
  list.append(
    el("dt", {}, "See submissions"),
    el("dd", {}, ...solved.map((problem) => externalLink(problem.code, problem.url, { className: "problem-link" }))),
  );
  if (unsolved.length) {
    list.append(
      el("dt", {}, "Not solved"),
      el("dd", {}, ...unsolved.map((problem) => el("span", { className: "problem-no" }, problem.code))),
    );
  }

  const shareButton = el("button", { type: "button", className: "share" }, "Share link");
  shareButton.addEventListener("click", () => share(team));
  const shareRow = el("p", { className: "share-row" }, shareButton, el("span", { className: "share-url" }, teamLink(team)));

  const box = el("div", { className: "reveal" }, el("div", {}, list, shareRow));
  enter(box);
  const span = 6 + LISTS_OUT.length;
  return el("tr", { className: "detail" }, el("td", { colSpan: span }, box));
}

function teamRow(team, index) {
  const open = el("button", { type: "button", className: "more", "aria-expanded": "false" }, "Details");
  const row = el(
    "tr",
    { className: "team-row" },
    el("td", { className: "num rank-cell" }, String(team.rank)),
    el(
      "td",
      { className: "team-cell" },
      el("span", { className: "team-name" }, team.name),
      el("span", { className: "team-college", title: team.college }, team.short),
    ),
    el("td", { className: "solved-cell" }, el("span", { className: "solved-count" }, String(team.solved)), dots(team)),
    el("td", { className: "num label-cell", "data-label": "Time" }, team.time),
    el("td", { className: "num label-cell", "data-label": "Penalty" }, String(team.penalty)),
    ...LISTS_OUT.map((regional) => statusCell(team, regional)),
    el("td", { className: "more-cell" }, pinButton(team), open),
  );
  // The first rows slide in one after another; the rest arrive together.
  row.style.setProperty("--i", String(Math.min(index, 12)));
  if (!onAnyList(team)) {
    row.insertBefore(el("td", { className: "none-note" }, "Not on a published list yet"), row.lastChild);
  }
  open.addEventListener("click", () => {
    const next = row.nextElementSibling;
    if (next?.classList.contains("detail") && !next.classList.contains("closing")) {
      next.classList.add("closing");
      leave(next.querySelector(".reveal"), () => next.remove());
      open.textContent = "Details";
      open.setAttribute("aria-expanded", "false");
    } else {
      row.after(detailRow(team));
      open.textContent = "Hide";
      open.setAttribute("aria-expanded", "true");
    }
  });
  return row;
}

function renderMatchRule() {
  const { regionals } = state;
  byId("matchRule").hidden = regionals.length < 2;
  if (regionals.length < 2) return;
  const any = filterTeams(teams, { regionals, match: "any" }).length;
  const all = filterTeams(teams, { regionals, match: "all" }).length;
  byId("matchAny").textContent = `Any of these (${number(any)})`;
  byId("matchAll").textContent = `All of these (${number(all)})`;
}

function renderTeams({ animate = true } = {}) {
  renderMatchRule();
  const view = paginate(filterTeams(teams, state), state.page, PAGE_SIZE);
  state.page = view.page;
  const found = view.total > 0;

  const rows = byId("rows");
  rows.classList.remove("fresh");
  rows.replaceChildren(...view.items.map(teamRow));
  if (animate) {
    void rows.offsetWidth;
    rows.classList.add("fresh");
  }
  byId("teams").hidden = !found;
  byId("empty").hidden = found;
  byId("pager").hidden = view.pages === 1;
  byId("legend").hidden = !found;
  byId("page").textContent = `Page ${view.page} of ${view.pages}`;
  byId("prev").disabled = view.page === 1;
  byId("nextPage").disabled = view.page === view.pages;
  byId("result").textContent = resultText(view);
  byId("clear").hidden = !(state.query || state.show !== "all" || state.solved || state.college || state.regionals.length);

  // replaceState changes the address without adding a Back step.
  const address = location.pathname + filtersToQuery(state);
  if (address !== location.pathname + location.search) history.replaceState(null, "", address);
}

async function start() {
  try {
    const response = await fetch("data.json");
    if (!response.ok) throw new Error(`data.json answered ${response.status}`);
    const data = await response.json();
    teams = prepareTeams(data.teams);
    const now = new Date();
    renderTop(data, now);
    renderHead();
    fillRegionalChecks(data.counts);
    fillFilters();
    const fromLink = location.search !== "";
    applyLink();
    loadPins();
    renderPins();
    watchFilters();
    byId("skeleton").hidden = true;
    renderTeams();
    // A link to one team opens its details.
    const shown = byId("rows").querySelectorAll(".team-row");
    if (fromLink && shown.length === 1) shown[0].querySelector(".more").click();
  } catch (error) {
    console.error(error);
    byId("result").textContent = "The team list did not load. Refresh the page to try again.";
  } finally {
    byId("skeleton").hidden = true;
  }
}

start();
