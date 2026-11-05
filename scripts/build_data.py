"""Download the official ICPC India 2026 lists and combine them into public/data.json.

Run from the project root:  python3 -I scripts/build_data.py
Add --offline to reuse the files in .cache/ instead of downloading again.

If anything looks wrong the script stops with an error and leaves data.json untouched.
"""
import csv
import io
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
OUTPUT = ROOT / "public" / "data.json"
CHENNAI_SITE = "https://icpcchennai.vercel.app"
MATHURA_SITE = "https://mathuraicpc.in"

# Above this many teams missing from the pool, a list is probably broken, not just out of date.
MAX_NOT_IN_POOL = 3

SOURCES = {
    "pool": "https://indiaicpc.in/selection_pool_2026.html",
    "kanpur": "https://kanpur.indiaicpc.in/onsite2026.html",
    "chennai": "https://icpcchennai.vercel.app/contest-info/official-ranklist",
    "amritapuri": "https://amritaicpc.in/data/Amritapuri%20Final%20Ranklist%202026.csv",
    "mathura": "https://mathuraicpc.in/",
}

SHORT_NAMES = [
    ("Indian Institute of Information Technology", "IIIT"),
    ("International Institute of Information Technology", "IIIT"),
    ("Indian Institute of Technology", "IIT"),
    ("National Institute of Technology", "NIT"),
]

CHENNAI_CATEGORIES = {
    "Overall Topper": "Overall topper",
    "Institutional Topper": "Institutional topper",
    "Institutional Toppers": "Institutional topper",
    "ALL Women Team": "All women",
}

# Colleges that a regional list writes differently from the pool. Checked by hand on 5 Nov 2026.
COLLEGE_ALIASES = {
    "JSS Academy Of Technical Education": "JSS Academy of Technical Education, Noida",
    "KL University H": "Koneru Lakshmaiah Education Foundation",
    "Shri Ramdeobaba College of Engineering and Management, Nagpur": "Ramdeobaba University, Nagpur",
}

MATHURA_QUOTAS = {"General": "General", "Female": "All Women"}

REGIONAL_NAME = re.compile(r"(Amritapuri|Chennai|Kanpur|Mathura) (\d{6,8}): ")
CHENNAI_CODE_PATH = re.compile(r"/_next/static/chunks/app/contest-info/official-ranklist/page-[a-z0-9]+\.js")
CHENNAI_WAITLIST_ROW = re.compile(r'\{sno:(\d+),category:"Waitlist",.*?username:"(icpcol\d+)"')
MATHURA_CODE_PATH = re.compile(r"/assets/index-[A-Za-z0-9_-]+\.js")
MATHURA_LIST = re.compile(r"([\w$]+)=\[(\{serialNo:.*?\})\]")
MATHURA_ROW = re.compile(
    r'\{serialNo:(\d+),teamName:"((?:[^"\\]|\\.)*)",institute:"((?:[^"\\]|\\.)*)",teamId:"(\d+)",quota:"(\w+)"\}'
)
MATHURA_SELECTED = re.compile(r'([\w$]+)\.filter\(\w+=>\w+\.quota==="General"\)')


class DataError(Exception):
    """An official list did not look the way this script expects."""


class _TableReader(HTMLParser):
    """Collects table cells. A new cell or row also ends the previous one,
    because the official pool page leaves out its closing tags."""

    def __init__(self):
        super().__init__()
        self.tables = []
        self.row = None
        self.cell = None

    def _end_cell(self):
        if self.cell is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None

    def _end_row(self):
        self._end_cell()
        if self.row is not None:
            self.tables[-1].append(self.row)
            self.row = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.tables.append([])
        elif tag == "tr" and self.tables:
            self._end_row()
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self._end_cell()
            self.cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th"):
            self._end_cell()
        elif tag in ("tr", "thead", "tbody", "table"):
            self._end_row()

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def parse_tables(html):
    reader = _TableReader()
    reader.feed(html)
    reader.close()
    return reader.tables


def _norm(text):
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def short_college(college):
    for full, short in SHORT_NAMES:
        if college.startswith(full):
            rest = college[len(full):]
            if rest.startswith(" and "):
                return college
            return f"{short} {rest.lstrip(' -,').replace('), ', ') ')}"
    return college


def _split_names(cell):
    parts = REGIONAL_NAME.split(cell)
    if len(parts) == 1 or parts[0]:
        return []
    return [
        {"regional": regional, "id": team_id, "name": name.strip()}
        for regional, team_id, name in zip(parts[1::3], parts[2::3], parts[3::3])
    ]


def _stated_team_count(html):
    text = re.sub(r"<[^>]+>", " ", html)
    match = re.search(r"([\d,]+)\s+teams in standing order", text)
    if not match:
        raise DataError("The pool page no longer says how many teams it has.")
    return int(match.group(1).replace(",", ""))


def parse_pool(html):
    tables = parse_tables(html)
    if not tables:
        raise DataError("The pool page has no table.")
    rows = tables[0][1:]
    stated = _stated_team_count(html)
    if len(rows) != stated:
        raise DataError(f"The pool page says {stated} teams but has {len(rows)} rows.")

    teams = []
    for row in rows:
        if len(row) != 18:
            raise DataError(f"A pool row has {len(row)} cells instead of 18: {row[:3]}")
        rank, user, name_cell, college, solved, score, time, penalty = row[:8]
        marks = row[8:]
        if set(marks) - {"", "100"}:
            raise DataError(f"Team {user} has an unexpected problem score: {marks}")
        problems = "".join("1" if mark else "0" for mark in marks)
        if problems.count("1") != int(solved) or int(score) != int(solved) * 100:
            raise DataError(f"Team {user} says {solved} solved but its problem cells disagree.")

        team = {
            "rank": int(rank),
            "user": user,
            "name": name_cell,
            "college": college,
            "short": short_college(college),
            "solved": int(solved),
            "time": time,
            "penalty": int(penalty),
            "problems": problems,
        }
        names = _split_names(name_cell)
        if names:
            team["names"] = names
            team["name"] = " / ".join(dict.fromkeys(n["name"] for n in names))
        teams.append(team)
    return teams


def parse_chennai(html):
    tables = parse_tables(html)
    if not tables:
        raise DataError("The Chennai page has no table.")
    header, *rows = tables[0]
    teams = {}
    open_slots = 0
    for values in rows:
        row = dict(zip(header, values))
        if row["Team Name"] == "To Be Announced":
            open_slots += 1
            continue
        if not re.fullmatch(r"icpcol\d+", row["Username"]):
            raise DataError(f"Chennai team {row['Team Name']} has no username.")
        if row["Category"] not in CHENNAI_CATEGORIES:
            raise DataError(f"Chennai has a new category: {row['Category']}")
        teams[row["Username"]] = {"status": "selected", "category": CHENNAI_CATEGORIES[row["Category"]]}
    return teams, open_slots


def chennai_code_path(html):
    match = CHENNAI_CODE_PATH.search(html)
    if not match:
        raise DataError("The Chennai page no longer points to the code file that holds its waiting list.")
    return match.group(0)


def parse_chennai_waitlist(html, code):
    """Chennai keeps its waiting list inside the page's code, not in a table.
    Read it as plain text with a pattern. The downloaded code is never run."""
    match = re.search(r"(\d+)\s+Waitlisted Teams", re.sub(r"<[^>]+>", " ", html))
    if not match:
        raise DataError("The Chennai page no longer says how many teams are waitlisted.")
    teams = {user: {"status": "waiting", "number": int(number)} for number, user in CHENNAI_WAITLIST_ROW.findall(code)}
    if len(teams) != int(match.group(1)):
        raise DataError(f"The Chennai page says {match.group(1)} waitlisted teams but has {len(teams)}.")
    return teams


def combine_chennai(selected, waitlist):
    both = set(selected) & set(waitlist)
    if both:
        raise DataError(f"Chennai lists teams as both selected and waitlisted: {sorted(both)[:5]}")
    return {**selected, **waitlist}


def parse_amritapuri(text):
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    return {row["Username"]: {"centre": row["Site"], "rank": int(row["Rank"])} for row in reader}


def mathura_code_path(html):
    match = MATHURA_CODE_PATH.search(html)
    if not match:
        raise DataError("The Mathura page no longer points to the code file that holds its lists.")
    return match.group(0)


def _js_text(text):
    try:
        return json.loads(f'"{text}"')
    except json.JSONDecodeError as error:
        raise DataError(f"Mathura has text this script cannot read: {text[:40]}") from error


def parse_mathura(code):
    """Mathura keeps both lists inside the page's code, not in a table.
    Read them as plain text with a pattern. The downloaded code is never run.
    The selected list is the one the page counts by quota, so new short names don't matter."""
    lists = dict(MATHURA_LIST.findall(code))
    counted = set(MATHURA_SELECTED.findall(code))
    if len(lists) != 2 or len(counted) != 1 or not counted <= set(lists):
        raise DataError("The Mathura code no longer has one selected list and one waiting list.")
    (selected,) = counted
    (waiting,) = set(lists) - counted

    rows = []
    for status, name in (("selected", selected), ("waiting", waiting)):
        body = lists[name]
        found = MATHURA_ROW.findall(body)
        if len(found) != body.count("serialNo:"):
            raise DataError(f"Some Mathura {status} rows are written in a shape this script does not know.")
        if [int(row[0]) for row in found] != list(range(1, len(found) + 1)):
            raise DataError(f"The Mathura {status} list skips serial numbers.")
        for number, team, college, team_id, quota in found:
            if quota not in MATHURA_QUOTAS:
                raise DataError(f"Mathura has a new quota: {quota}")
            rows.append(
                {
                    "status": status,
                    "number": int(number),
                    "name": _js_text(team),
                    "id": team_id,
                    "college": _js_text(college),
                    "quota": MATHURA_QUOTAS[quota],
                }
            )
    return rows


def parse_kanpur(html):
    tables = parse_tables(html)
    if len(tables) != 2 or tables[0][0][0] != "Sl No" or tables[1][0][0] != "Waiting List No.":
        raise DataError("The Kanpur page no longer has its selected and waiting tables.")
    rows = []
    for status, table in zip(("selected", "waiting"), tables):
        header, *values = table
        for cells in values:
            row = dict(zip(header, cells))
            rows.append(
                {
                    "status": status,
                    "number": int(cells[0]),
                    "name": row["Team Name"],
                    "id": row["Team ID"],
                    "college": row["Institute Name"],
                    "quota": row["Selection Quota"],
                }
            )
    return rows


def link_teams(rows, pool, label):
    """Kanpur and Mathura have Team IDs but no usernames, so find each team in the pool:
    by Team ID when the pool shows one, otherwise by team name and college.
    If two pool teams look the same once spaces and case are ignored, keep the exact spelling."""
    by_id = {n["id"]: team["user"] for team in pool for n in team.get("names", [])}
    by_name = {}
    for team in pool:
        by_name.setdefault((_norm(team["name"]), _norm(team["college"])), []).append(team)

    linked = {}
    for row in rows:
        user = by_id.get(row["id"])
        if user is None:
            college = COLLEGE_ALIASES.get(row["college"], row["college"])
            matches = by_name.get((_norm(row["name"]), _norm(college)), [])
            if len(matches) > 1:
                matches = [team for team in matches if team["name"] == row["name"]]
            if len(matches) != 1:
                raise DataError(f"{label} team {row['name']} ({row['college']}) does not match exactly one pool team.")
            user = matches[0]["user"]
        if user in linked:
            raise DataError(f"{label} lists pool team {user} twice.")
        linked[user] = {"status": row["status"], "number": row["number"], "id": row["id"], "quota": row["quota"]}
    return linked


def build_dataset(teams, amritapuri, chennai, chennai_open_women, kanpur, mathura, checked):
    """A team can stay on a regional list after leaving the final pool. Leave it out and
    only count it, because the site never names teams that left the pool."""
    users = {team["user"] for team in teams}
    not_in_pool = {}
    for label, listed in (("Amritapuri", amritapuri), ("Chennai", chennai), ("Kanpur", kanpur), ("Mathura", mathura)):
        unknown = set(listed) - users
        if len(unknown) > MAX_NOT_IN_POOL:
            raise DataError(f"{label} lists {len(unknown)} teams that are not in the pool: {sorted(unknown)[:5]}")
        if label in ("Amritapuri", "Chennai"):
            not_in_pool[label.lower()] = len(unknown)
        elif unknown:
            raise DataError(f"{label} was linked to teams that are not in the pool: {sorted(unknown)[:5]}")

    merged = []
    counts = {"selected": 0, "two_regionals": 0, "waiting_only": 0, "not_listed": 0}
    for team in teams:
        team = dict(team)
        user = team["user"]
        if user in amritapuri:
            team["amritapuri"] = amritapuri[user]
        if user in chennai:
            team["chennai"] = chennai[user]
        if user in kanpur:
            team["kanpur"] = kanpur[user]
        if user in mathura:
            team["mathura"] = mathura[user]
        merged.append(team)

        selected_at = (
            (user in amritapuri)
            + (chennai.get(user, {}).get("status") == "selected")
            + (kanpur.get(user, {}).get("status") == "selected")
            + (mathura.get(user, {}).get("status") == "selected")
        )
        if selected_at:
            counts["selected"] += 1
        if selected_at == 2:
            counts["two_regionals"] += 1
        if not selected_at:
            counts["waiting_only" if user in kanpur or user in chennai or user in mathura else "not_listed"] += 1

    statuses = [entry["status"] for entry in kanpur.values()]
    chennai_statuses = [entry["status"] for user, entry in chennai.items() if user in users]
    mathura_statuses = [entry["status"] for entry in mathura.values()]
    counts.update(
        pool=len(teams),
        amritapuri=len(set(amritapuri) & users),
        chennai=chennai_statuses.count("selected"),
        chennai_waiting=chennai_statuses.count("waiting"),
        chennai_open_women=chennai_open_women,
        kanpur=statuses.count("selected"),
        kanpur_waiting=statuses.count("waiting"),
        mathura=mathura_statuses.count("selected"),
        mathura_waiting=mathura_statuses.count("waiting"),
    )
    return {"checked": checked, "counts": counts, "not_in_pool": not_in_pool, "teams": merged}


def _page_path(name):
    return CACHE / name / "page"


def _download(name, url):
    path = _page_path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {name}...")
    subprocess.run(["curl", "-sS", "--fail", "--max-time", "60", url, "-o", str(path)], check=True)


def download_all():
    for name, url in SOURCES.items():
        _download(name, url)
    code_path = chennai_code_path(_page_path("chennai").read_text(encoding="utf-8"))
    _download("chennai_code", CHENNAI_SITE + code_path)
    code_path = mathura_code_path(_page_path("mathura").read_text(encoding="utf-8"))
    _download("mathura_code", MATHURA_SITE + code_path)


def main(argv):
    if "--offline" not in argv:
        download_all()
    read = lambda name: _page_path(name).read_text(encoding="utf-8")

    pool = parse_pool(read("pool"))
    chennai_selected, open_slots = parse_chennai(read("chennai"))
    chennai = combine_chennai(chennai_selected, parse_chennai_waitlist(read("chennai"), read("chennai_code")))
    amritapuri = parse_amritapuri(read("amritapuri"))
    kanpur = link_teams(parse_kanpur(read("kanpur")), pool, "Kanpur")
    mathura = link_teams(parse_mathura(read("mathura_code")), pool, "Mathura")
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date().isoformat()
    data = build_dataset(pool, amritapuri, chennai, open_slots, kanpur, mathura, today)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    for key, value in data["counts"].items():
        print(f"{key}: {value}")
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size // 1024} KB)")
    for regional, missing in data["not_in_pool"].items():
        if missing:
            print(f"NOTE: {missing} team(s) on the {regional} list are not in the final pool and were left out.")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (DataError, subprocess.CalledProcessError) as error:
        sys.exit(f"Stopped, data.json was not changed: {error}")
