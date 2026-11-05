import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collegeOptions,
  filterTeams,
  nextDeadline,
  onAnyList,
  paginate,
  prepareTeams,
  regionalStatus,
  resultText,
  submissionLinks,
  isClosed,
} from "../public/logic.js";

const base = { solved: 6, time: "01:00:00", penalty: 0, problems: "1111110000" };

const threeOfAKind = {
  ...base,
  rank: 1,
  user: "icpcol260148",
  name: "3 of a Kind",
  college: "Indian Institute of Technology - Roorkee",
  short: "IIT Roorkee",
  solved: 8,
  problems: "1111111100",
  amritapuri: { centre: "Amritapuri", rank: 1 },
  chennai: { status: "selected", category: "Overall topper" },
};
const hogabhai = {
  ...base,
  rank: 355,
  user: "icpcol262390",
  name: "Hogabhai",
  college: "Amrita Vishwa Vidyapeetham, Amritapuri",
  short: "Amrita Vishwa Vidyapeetham, Amritapuri",
  chennai: { status: "selected", category: "Institutional topper" },
  kanpur: { status: "selected", number: 6, id: "1151874", quota: "General" },
};
const criticalPath = {
  ...base,
  rank: 71,
  user: "icpcol261642",
  name: "Critical_Path",
  college: "Indian Institute of Technology - Kharagpur",
  short: "IIT Kharagpur",
  chennai: { status: "selected", category: "Overall topper" },
  kanpur: { status: "waiting", number: 1, id: "1156460", quota: "General" },
};
const phiChance = {
  ...base,
  rank: 64,
  user: "icpcol263530",
  name: "Phi Chance",
  college: "Indian Institute of Technology - Kanpur",
  short: "IIT Kanpur",
};
const bumblebee = {
  ...base,
  rank: 320,
  user: "icpcol260964",
  name: "bumblebee",
  college: "Indian Institute of Information Technology, Allahabad",
  short: "IIIT Allahabad",
  solved: 5,
  problems: "1111100000",
  kanpur: { status: "selected", number: 62, id: "1153339", quota: "All Women" },
};
const voidTeam = {
  ...base,
  rank: 37,
  user: "icpcol260017",
  name: "Void / Void_",
  college: "Indian Institute of Technology - Guwahati",
  short: "IIT Guwahati",
  names: [
    { regional: "Amritapuri", id: "1153983", name: "Void" },
    { regional: "Kanpur", id: "1155310", name: "Void_" },
  ],
  amritapuri: { centre: "Coimbatore", rank: 33 },
  kanpur: { status: "selected", number: 102, id: "1155310", quota: "General (Tentative)" },
};
const teams = prepareTeams([threeOfAKind, hogabhai, criticalPath, phiChance, bumblebee, voidTeam]);
const users = (list) => list.map((team) => team.name);

test("search finds a team by each thing a student might type", () => {
  const cases = [
    ["3 of a kind", ["3 of a Kind"]],
    ["iit roorkee", ["3 of a Kind"]],
    ["ROORKEE 3", ["3 of a Kind"]],
    ["indian institute of technology - kharagpur", ["Critical_Path"]],
    ["icpcol263530", ["Phi Chance"]],
    ["1151874", ["Hogabhai"]],
    ["1153983", ["Void / Void_"]],
    ["void_", ["Void / Void_"]],
    ["no such team", []],
  ];
  for (const [query, want] of cases) {
    assert.deepEqual(users(filterTeams(teams, { query })), want, query);
  }
});

test("an empty search keeps every team in order", () => {
  assert.deepEqual(users(filterTeams(teams, { query: "   " })), users(teams));
});

test("the Show filter picks the right teams for each list", () => {
  const cases = [
    ["all", ["3 of a Kind", "Hogabhai", "Critical_Path", "Phi Chance", "bumblebee", "Void / Void_"]],
    ["selected", ["3 of a Kind", "Hogabhai", "Critical_Path", "bumblebee", "Void / Void_"]],
    ["two", ["3 of a Kind", "Hogabhai", "Void / Void_"]],
    ["none", ["Phi Chance"]],
    ["chennai-overall", ["3 of a Kind", "Critical_Path"]],
    ["chennai-inst", ["Hogabhai"]],
    ["chennai-women", []],
    ["kanpur-waiting", ["Critical_Path"]],
    ["kanpur-women", ["bumblebee"]],
    ["kanpur-tentative", ["Void / Void_"]],
    ["amritapuri-Amritapuri", ["3 of a Kind"]],
    ["amritapuri-Coimbatore", ["Void / Void_"]],
    ["amritapuri-Mysuru", []],
  ];
  for (const [show, want] of cases) {
    assert.deepEqual(users(filterTeams(teams, { show })), want, show);
  }
});

test("a waiting team does not count as selected at two regionals", () => {
  assert.equal(filterTeams(teams, { show: "two" }).includes(teams[2]), false);
});

test("the solved filter wants the exact number, including when it arrives as text", () => {
  assert.deepEqual(users(filterTeams(teams, { solved: "8" })), ["3 of a Kind"]);
  assert.deepEqual(users(filterTeams(teams, { solved: 5 })), ["bumblebee"]);
});

test("the college filter wants the exact college", () => {
  const college = "Indian Institute of Technology - Kanpur";
  assert.deepEqual(users(filterTeams(teams, { college })), ["Phi Chance"]);
});

test("all filters must match together", () => {
  const picked = filterTeams(teams, { query: "iit", regionals: ["chennai"], solved: "6", college: "" });
  assert.deepEqual(users(picked), ["Critical_Path"]);
});

test("ticked regionals keep teams selected at any of them by default", () => {
  const cases = [
    [["kanpur"], ["Hogabhai", "bumblebee", "Void / Void_"]],
    [["amritapuri"], ["3 of a Kind", "Void / Void_"]],
    [["kanpur", "amritapuri"], ["3 of a Kind", "Hogabhai", "bumblebee", "Void / Void_"]],
    [["chennai", "kanpur", "amritapuri"], ["3 of a Kind", "Hogabhai", "Critical_Path", "bumblebee", "Void / Void_"]],
  ];
  for (const [regionals, want] of cases) {
    assert.deepEqual(users(filterTeams(teams, { regionals })), want, regionals.join());
  }
});

test("the all rule keeps only teams selected at every ticked regional", () => {
  const cases = [
    [["kanpur", "amritapuri"], ["Void / Void_"]],
    [["chennai", "amritapuri"], ["3 of a Kind"]],
    [["chennai", "kanpur"], ["Hogabhai"]],
    [["chennai", "kanpur", "amritapuri"], []],
    [["kanpur"], ["Hogabhai", "bumblebee", "Void / Void_"]],
  ];
  for (const [regionals, want] of cases) {
    assert.deepEqual(users(filterTeams(teams, { regionals, match: "all" })), want, regionals.join());
  }
});

test("no ticked regionals means no regional limit, whichever rule is set", () => {
  assert.equal(filterTeams(teams, { regionals: [] }).length, 6);
  assert.equal(filterTeams(teams, { regionals: [], match: "all" }).length, 6);
});

test("ticked regionals combine with the Show filter", () => {
  assert.deepEqual(users(filterTeams(teams, { regionals: ["kanpur"], show: "chennai-inst" })), ["Hogabhai"]);
  assert.deepEqual(users(filterTeams(teams, { regionals: ["amritapuri"], show: "chennai-inst" })), []);
});

test("a Chennai waiting list team is never counted as selected", () => {
  const hit = {
    ...base,
    rank: 1383,
    user: "icpcol262384",
    name: "HIT",
    college: "National Institute of Technology, Calicut",
    short: "NIT Calicut",
    chennai: { status: "waiting", number: 1 },
  };
  const list = prepareTeams([hit]);
  assert.deepEqual(regionalStatus(hit, "chennai"), { kind: "waiting", text: "Waiting list #1" });
  assert.deepEqual(users(filterTeams(list, { show: "chennai-waiting" })), ["HIT"]);
  for (const filters of [{ show: "selected" }, { show: "chennai-overall" }, { show: "chennai-inst" }, { show: "none" }, { regionals: ["chennai"] }]) {
    assert.deepEqual(users(filterTeams(list, filters)), [], JSON.stringify(filters));
  }
});

test("a waiting list place does not make a second regional", () => {
  const both = prepareTeams([{ ...bumblebee, chennai: { status: "waiting", number: 2 } }]);
  assert.deepEqual(users(filterTeams(both, { show: "two" })), []);
  assert.deepEqual(users(filterTeams(both, { show: "selected" })), ["bumblebee"]);
  assert.deepEqual(users(filterTeams(both, { regionals: ["chennai", "kanpur"], match: "all" })), []);
});

test("Mathura shows selected with its quota and waiting with its number", () => {
  const nit = { ...base, short: "NIT Kurukshetra", college: "National Institute of Technology, Kurukshetra" };
  const picked = { ...nit, rank: 641, user: "icpcol263588", name: "Powerpuff girls", mathura: { status: "selected", number: 80, id: "1153256", quota: "General" } };
  const women = { ...nit, rank: 700, user: "w1", name: "Women Team", mathura: { status: "selected", number: 5, id: "1160001", quota: "All Women" } };
  const waiter = { ...nit, rank: 1480, user: "w2", name: "Debug Divas", mathura: { status: "waiting", number: 11, id: "1152821", quota: "All Women" } };
  const list = prepareTeams([picked, women, waiter, phiChance]);

  assert.deepEqual(regionalStatus(picked, "mathura"), { kind: "selected", text: "General" });
  assert.deepEqual(regionalStatus(women, "mathura"), { kind: "selected", text: "All Women" });
  assert.deepEqual(regionalStatus(waiter, "mathura"), { kind: "waiting", text: "Waiting list #11" });
  assert.deepEqual(regionalStatus(phiChance, "mathura"), { kind: "none", text: "" });

  const cases = [
    [{ show: "mathura-waiting" }, ["Debug Divas"]],
    [{ show: "mathura-women" }, ["Women Team"]],
    [{ show: "selected" }, ["Powerpuff girls", "Women Team"]],
    [{ show: "none" }, ["Phi Chance"]],
    [{ regionals: ["mathura"] }, ["Powerpuff girls", "Women Team"]],
    [{ query: "1153256" }, ["Powerpuff girls"]],
  ];
  for (const [filters, want] of cases) assert.deepEqual(users(filterTeams(list, filters)), want, JSON.stringify(filters));
});

test("selected at Mathura and Kanpur counts as two regionals", () => {
  const both = prepareTeams([{ ...bumblebee, mathura: { status: "selected", number: 3, id: "1", quota: "General" } }]);
  assert.deepEqual(users(filterTeams(both, { show: "two" })), ["bumblebee"]);
  assert.deepEqual(users(filterTeams(both, { regionals: ["kanpur", "mathura"], match: "all" })), ["bumblebee"]);
});

test("college options are unique and sorted by the name shown", () => {
  const options = collegeOptions(prepareTeams([phiChance, bumblebee, { ...phiChance, user: "x" }]));
  assert.deepEqual(options, [
    { value: "Indian Institute of Information Technology, Allahabad", label: "IIIT Allahabad" },
    { value: "Indian Institute of Technology - Kanpur", label: "IIT Kanpur" },
  ]);
});

test("paging gives the right slice and numbers", () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  const page3 = paginate(items, 3, 100);
  assert.equal(page3.items.length, 50);
  assert.deepEqual(
    { page: page3.page, pages: page3.pages, start: page3.start, end: page3.end, total: page3.total },
    { page: 3, pages: 3, start: 201, end: 250, total: 250 },
  );
});

test("paging moves a too-high or too-low page back inside the list", () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  assert.equal(paginate(items, 99, 100).page, 3);
  assert.equal(paginate(items, 0, 100).page, 1);
});

test("paging an empty list reports no teams instead of a broken range", () => {
  assert.deepEqual(paginate([], 1, 100), { items: [], page: 1, pages: 1, start: 0, end: 0, total: 0 });
});

test("the result line counts teams in plain words", () => {
  const cases = [
    [{ start: 1, end: 100, total: 3884, pages: 39 }, "Showing 1–100 of 3,884 teams"],
    [{ start: 3801, end: 3884, total: 3884, pages: 39 }, "Showing 3,801–3,884 of 3,884 teams"],
    [{ start: 1, end: 96, total: 96, pages: 1 }, "96 teams"],
    [{ start: 1, end: 1, total: 1, pages: 1 }, "1 team"],
    [{ start: 0, end: 0, total: 0, pages: 1 }, "0 teams"],
  ];
  for (const [view, want] of cases) assert.equal(resultText(view), want);
});

test("submission links exist only for solved problems", () => {
  const links = submissionLinks(threeOfAKind);
  assert.equal(links.length, 10);
  assert.deepEqual(links[0], {
    code: "PHNCHRG",
    solved: true,
    url: "https://www.codechef.com/ICPCOL2026/status/PHNCHRG?usernames=icpcol260148",
  });
  assert.deepEqual(links[7], {
    code: "IC26AM",
    solved: true,
    url: "https://www.codechef.com/ICPCOL2026/status/IC26AM?usernames=icpcol260148",
  });
  assert.deepEqual(links[8], { code: "IC26MM", solved: false, url: null });
  assert.deepEqual(links[9], { code: "IC26BM", solved: false, url: null });
});

test("submission links keep an odd username safe inside the URL", () => {
  const [first] = submissionLinks({ user: "a&b c", problems: "1000000000" });
  assert.equal(first.url, "https://www.codechef.com/ICPCOL2026/status/PHNCHRG?usernames=a%26b%20c");
});

test("each regional cell says selected, waiting, or nothing", () => {
  const cases = [
    [threeOfAKind, "amritapuri", { kind: "selected", text: "Amritapuri" }],
    [voidTeam, "amritapuri", { kind: "selected", text: "Coimbatore" }],
    [threeOfAKind, "chennai", { kind: "selected", text: "Overall topper" }],
    [hogabhai, "kanpur", { kind: "selected", text: "General" }],
    [bumblebee, "kanpur", { kind: "selected", text: "All Women" }],
    [voidTeam, "kanpur", { kind: "selected", text: "General (Tentative)" }],
    [criticalPath, "kanpur", { kind: "waiting", text: "Waiting list #1" }],
    [phiChance, "kanpur", { kind: "none", text: "" }],
    [phiChance, "chennai", { kind: "none", text: "" }],
    [phiChance, "amritapuri", { kind: "none", text: "" }],
  ];
  for (const [team, regional, want] of cases) {
    assert.deepEqual(regionalStatus(team, regional), want, `${team.name} ${regional}`);
  }
});

test("a deadline closes at its exact time", () => {
  const iso = "2026-11-03T19:00:00+05:30";
  assert.equal(isClosed(iso, new Date("2026-11-03T18:59:59+05:30")), false);
  assert.equal(isClosed(iso, new Date("2026-11-03T19:00:00+05:30")), true);
});

test("the next deadline is the earliest one not yet closed, across regionals", () => {
  const regionals = [
    { name: "Kanpur", deadlines: [{ label: "Fee", iso: "2026-11-12T17:00:00+05:30" }, { label: "Email", iso: "2026-11-03T22:00:00+05:30" }] },
    { name: "Chennai", deadlines: [{ label: "Rank form", iso: "2026-11-03T19:00:00+05:30" }] },
    { name: "Mathura", deadlines: [] },
  ];
  assert.deepEqual(nextDeadline(regionals, new Date("2026-11-02T12:00:00+05:30")), {
    regional: "Chennai",
    label: "Rank form",
    iso: "2026-11-03T19:00:00+05:30",
  });
  assert.equal(nextDeadline(regionals, new Date("2026-11-03T20:00:00+05:30")).label, "Email");
  assert.equal(nextDeadline(regionals, new Date("2026-12-01T00:00:00+05:30")), null);
});

test("a team on any one regional list, Mathura included, is on a list", () => {
  const mathuraOnly = { ...phiChance, mathura: { status: "selected", number: 44, id: "1162526", quota: "General" } };
  const mathuraWaiting = { ...phiChance, mathura: { status: "waiting", number: 3, id: "1162526", quota: "General" } };
  assert.equal(onAnyList(mathuraOnly), true);
  assert.equal(onAnyList(mathuraWaiting), true);
  assert.equal(onAnyList(criticalPath), true);
  assert.equal(onAnyList(phiChance), false);
});
