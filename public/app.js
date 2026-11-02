// Connects the data and rules to the page.
// Team names come from outside (one team is called <hopefullytopkfrombits.h>), so all text
// goes in through el(), which adds it as plain text. Never use innerHTML here.

import { LINKS, REGIONALS } from "./info.js";
import {
  SHOW_GROUPS,
  collegeOptions,
  filterTeams,
  isClosed,
  nextDeadline,
  paginate,
  prepareTeams,
  regionalStatus,
  submissionLinks,
} from "./logic.js";

const PAGE_SIZE = 100;
const LISTS_OUT = REGIONALS.filter((regional) => regional.published);
const number = (value) => value.toLocaleString("en-IN");
const byId = (id) => document.getElementById(id);

const state = { query: "", show: "all", solved: "", college: "", page: 1 };
let teams = [];

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

/* Top of the page */

function teamCountLine(regional, counts) {
  if (regional.key === "chennai") {
    const open = counts.chennai_open_women;
    return `${number(counts.chennai)} teams selected${open ? `, ${open} women's slots still open` : ""}`;
  }
  if (regional.key === "kanpur") {
    return `${number(counts.kanpur)} teams selected, ${counts.kanpur_waiting} on the waiting list`;
  }
  if (regional.key === "amritapuri") return `${number(counts.amritapuri)} teams selected`;
  return "List not published yet";
}

function deadlineItem(deadline, now) {
  const closed = isClosed(deadline.iso, now);
  const title = el("b", {}, deadline.url && !closed ? externalLink(deadline.label, deadline.url) : deadline.label);
  return el("li", { className: closed ? "closed" : "" }, title, closed ? `${deadline.when} (closed)` : deadline.when);
}

function regionalColumn(regional, counts, now) {
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
    regional.deadlines.length ? el("ul", {}, ...regional.deadlines.map((deadline) => deadlineItem(deadline, now))) : "",
    regional.warning ? el("p", { className: "warning" }, regional.warning) : "",
    regional.note ? el("p", { className: "quiet" }, regional.note) : "",
    el("p", { className: "site-links" }, ...links),
  );
}

function renderTop({ counts, checked }, now) {
  byId("summary").textContent =
    `${number(counts.pool)} teams are in the final pool. ${number(counts.selected)} are selected so far across ` +
    "Chennai, Kanpur and Amritapuri. Mathura's list isn't out yet.";

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

  byId("regionals").replaceChildren(...REGIONALS.map((regional) => regionalColumn(regional, counts, now)));
  byId("links").replaceChildren(...LINKS.map((link) => el("li", {}, externalLink(link.label, link.url))));

  const small = matchMedia("(max-width: 980px)");
  const fit = () => {
    byId("dates").open = !small.matches;
  };
  fit();
  small.addEventListener("change", fit);
}

/* Filters */

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

function watchFilters() {
  const update = (key) => (event) => {
    state[key] = event.target.value;
    state.page = 1;
    renderTeams();
  };
  byId("search").addEventListener("input", update("query"));
  byId("show").addEventListener("change", update("show"));
  byId("solved").addEventListener("change", update("solved"));
  byId("college").addEventListener("change", update("college"));

  byId("clear").addEventListener("click", () => {
    Object.assign(state, { query: "", show: "all", solved: "", college: "", page: 1 });
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
    byId("result").scrollIntoView();
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

function statusCell(team, regional) {
  const status = regionalStatus(team, regional.key);
  const className = `status-cell label-cell status-${status.kind}`;
  const text = status.kind === "selected" ? `✓ ${status.text}` : status.text || "–";
  return el("td", { className, "data-label": `${regional.name}:` }, text);
}

function detailRow(team) {
  const entries = [
    ["Username", team.user],
    ["College", team.college],
  ];
  for (const entry of team.names ?? []) {
    entries.push([`${entry.regional} name`, `${entry.name} (Team ID ${entry.id})`]);
  }
  if (team.kanpur && !team.names?.some((entry) => entry.id === team.kanpur.id)) {
    entries.push(["Kanpur Team ID", team.kanpur.id]);
  }
  if (team.amritapuri) entries.push(["Amritapuri list", `Rank ${team.amritapuri.rank}`]);

  const list = el("dl", {});
  for (const [term, value] of entries) list.append(el("dt", {}, term), el("dd", {}, value));

  const problems = submissionLinks(team).map((problem) =>
    problem.solved
      ? externalLink(problem.code, problem.url, { className: "problem-link" })
      : el("span", { className: "problem-no" }, `${problem.code} not solved`),
  );
  list.append(el("dt", {}, "Submissions"), el("dd", {}, ...problems));

  const span = 6 + LISTS_OUT.length;
  return el("tr", { className: "detail" }, el("td", { colSpan: span }, list));
}

function teamRow(team) {
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
    el("td", { className: "more-cell" }, open),
  );
  if (!team.amritapuri && !team.chennai && !team.kanpur) {
    row.insertBefore(el("td", { className: "none-note" }, "Not on a published list yet"), row.lastChild);
  }
  open.addEventListener("click", () => {
    const next = row.nextElementSibling;
    if (next?.classList.contains("detail")) {
      next.remove();
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

function renderTeams() {
  const view = paginate(filterTeams(teams, state), state.page, PAGE_SIZE);
  state.page = view.page;
  const found = view.total > 0;

  byId("rows").replaceChildren(...view.items.map(teamRow));
  byId("teams").hidden = !found;
  byId("empty").hidden = found;
  byId("pager").hidden = view.pages === 1;
  byId("legend").hidden = !found;
  byId("page").textContent = `Page ${view.page} of ${view.pages}`;
  byId("prev").disabled = view.page === 1;
  byId("nextPage").disabled = view.page === view.pages;
  byId("result").textContent = found
    ? `Showing ${number(view.start)}–${number(view.end)} of ${number(view.total)} teams`
    : "0 teams";
  byId("clear").hidden = !(state.query || state.show !== "all" || state.solved || state.college);
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
    fillFilters();
    watchFilters();
    renderTeams();
  } catch (error) {
    console.error(error);
    byId("result").textContent = "The team list did not load. Refresh the page to try again.";
  }
}

start();
