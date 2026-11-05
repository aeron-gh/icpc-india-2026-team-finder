// The rules behind the page: search, filters, paging, links and deadlines.
// Nothing here touches the page, so tests can run it without a browser.

export const PROBLEMS = ["PHNCHRG", "IC26CS", "IC26MP", "IC26CB", "IC26SH", "IC26LR", "IC26TM", "IC26AM", "IC26MM", "IC26BM"];

const selectedAtKanpur = (team) => team.kanpur?.status === "selected";
const selectedAtChennai = (team) => team.chennai?.status === "selected";
const selectedAtMathura = (team) => team.mathura?.status === "selected";
const selectedCount = (team) =>
  Boolean(team.amritapuri) + selectedAtChennai(team) + selectedAtKanpur(team) + selectedAtMathura(team);
const chennaiIs = (category) => (team) => team.chennai?.category === category;
const kanpurQuotaIs = (quota) => (team) => selectedAtKanpur(team) && team.kanpur.quota === quota;
const centreIs = (centre) => (team) => team.amritapuri?.centre === centre;

// On any regional list at all, selected or waiting.
export const onAnyList = (team) => Boolean(team.amritapuri || team.chennai || team.kanpur || team.mathura);

export const SHOW_GROUPS = [
  {
    label: "All regionals",
    options: [
      { id: "all", label: "All teams", test: () => true },
      { id: "selected", label: "Selected at any regional", test: (team) => selectedCount(team) > 0 },
      { id: "two", label: "Selected at two regionals", test: (team) => selectedCount(team) === 2 },
      { id: "none", label: "Not on any list yet", test: (team) => !onAnyList(team) },
    ],
  },
  {
    label: "Chennai",
    options: [
      { id: "chennai-overall", label: "Chennai: overall toppers", test: chennaiIs("Overall topper") },
      { id: "chennai-inst", label: "Chennai: institutional toppers", test: chennaiIs("Institutional topper") },
      { id: "chennai-women", label: "Chennai: all women", test: chennaiIs("All women") },
      { id: "chennai-waiting", label: "Chennai: waiting list", test: (team) => team.chennai?.status === "waiting" },
    ],
  },
  {
    label: "Kanpur",
    options: [
      { id: "kanpur-waiting", label: "Kanpur: waiting list", test: (team) => team.kanpur?.status === "waiting" },
      { id: "kanpur-women", label: "Kanpur: all women", test: kanpurQuotaIs("All Women") },
      { id: "kanpur-tentative", label: "Kanpur: tentative", test: kanpurQuotaIs("General (Tentative)") },
    ],
  },
  {
    label: "Mathura",
    options: [
      { id: "mathura-waiting", label: "Mathura: waiting list", test: (team) => team.mathura?.status === "waiting" },
      { id: "mathura-women", label: "Mathura: all women", test: (team) => selectedAtMathura(team) && team.mathura.quota === "All Women" },
    ],
  },
  {
    label: "Amritapuri",
    options: [
      { id: "amritapuri-Amritapuri", label: "Amritapuri: Amritapuri centre", test: centreIs("Amritapuri") },
      { id: "amritapuri-Bengaluru", label: "Amritapuri: Bengaluru centre", test: centreIs("Bengaluru") },
      { id: "amritapuri-Coimbatore", label: "Amritapuri: Coimbatore centre", test: centreIs("Coimbatore") },
      { id: "amritapuri-Mysuru", label: "Amritapuri: Mysuru centre", test: centreIs("Mysuru") },
    ],
  },
];

const SHOW_TESTS = Object.fromEntries(
  SHOW_GROUPS.flatMap((group) => group.options.map((option) => [option.id, option.test])),
);

// Search looks through one lowercase string per team, built once on load.
export function prepareTeams(teams) {
  return teams.map((team) => ({
    ...team,
    search: [
      team.name,
      ...(team.names ?? []).flatMap((entry) => [entry.name, entry.id]),
      team.user,
      team.college,
      team.short,
      team.kanpur?.id ?? "",
      team.mathura?.id ?? "",
    ]
      .join(" ")
      .toLowerCase(),
  }));
}

function selectedAtTicked(team, regionals, match) {
  if (regionals.length === 0) return true;
  const selectedAt = (regional) => regionalStatus(team, regional).kind === "selected";
  return match === "all" ? regionals.every(selectedAt) : regionals.some(selectedAt);
}

export function filterTeams(teams, { query = "", show = "all", solved = "", college = "", regionals = [], match = "any" } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const onList = SHOW_TESTS[show];
  return teams.filter(
    (team) =>
      onList(team) &&
      selectedAtTicked(team, regionals, match) &&
      (solved === "" || team.solved === Number(solved)) &&
      (college === "" || team.college === college) &&
      words.every((word) => team.search.includes(word)),
  );
}

export function collegeOptions(teams) {
  const labels = new Map(teams.map((team) => [team.college, team.short]));
  return [...labels]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
}

export function paginate(items, page, size) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(page, 1), pages);
  const from = (current - 1) * size;
  return {
    items: items.slice(from, from + size),
    page: current,
    pages,
    start: total === 0 ? 0 : from + 1,
    end: Math.min(from + size, total),
    total,
  };
}

export const number = (value) => value.toLocaleString("en-IN");

export function resultText({ start, end, total, pages }) {
  if (pages > 1) return `Showing ${number(start)}–${number(end)} of ${number(total)} teams`;
  return total === 1 ? "1 team" : `${number(total)} teams`;
}

export function submissionLinks(team) {
  return PROBLEMS.map((code, index) => {
    const solved = team.problems[index] === "1";
    const url = solved
      ? `https://www.codechef.com/ICPCOL2026/status/${code}?usernames=${encodeURIComponent(team.user)}`
      : null;
    return { code, solved, url };
  });
}

export function regionalStatus(team, regional) {
  const none = { kind: "none", text: "" };
  if (regional === "amritapuri") {
    return team.amritapuri ? { kind: "selected", text: team.amritapuri.centre } : none;
  }
  if (regional === "chennai") {
    if (!team.chennai) return none;
    return team.chennai.status === "waiting"
      ? { kind: "waiting", text: `Waiting list #${team.chennai.number}` }
      : { kind: "selected", text: team.chennai.category };
  }
  const entry = team[regional];
  if (!entry) return none;
  return entry.status === "waiting"
    ? { kind: "waiting", text: `Waiting list #${entry.number}` }
    : { kind: "selected", text: entry.quota };
}

export function isClosed(iso, now) {
  return now >= new Date(iso);
}

export function nextDeadline(regionals, now) {
  const open = regionals
    .flatMap((regional) => regional.deadlines.map((deadline) => ({ regional: regional.name, ...deadline })))
    .filter((deadline) => !isClosed(deadline.iso, now))
    .sort((a, b) => new Date(a.iso) - new Date(b.iso));
  return open[0] ?? null;
}
