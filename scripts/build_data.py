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
    "Institutional Toppers": "Institutional topper",
    "ALL Women Team": "All women",
}

REGIONAL_NAME = re.compile(r"(Amritapuri|Chennai|Kanpur|Mathura) (\d{6,8}): ")


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
        teams[row["Username"]] = {"category": CHENNAI_CATEGORIES[row["Category"]]}
    return teams, open_slots


def parse_amritapuri(text):
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    return {row["Username"]: {"centre": row["Site"], "rank": int(row["Rank"])} for row in reader}


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


def link_kanpur(rows, pool):
    """Kanpur has Team IDs but no usernames, so find each team in the pool:
    by Team ID when the pool shows one, otherwise by team name and college."""
    by_id = {n["id"]: team["user"] for team in pool for n in team.get("names", [])}
    by_name = {}
    for team in pool:
        by_name.setdefault((_norm(team["name"]), _norm(team["college"])), []).append(team["user"])

    linked = {}
    for row in rows:
        user = by_id.get(row["id"])
        if user is None:
            matches = by_name.get((_norm(row["name"]), _norm(row["college"])), [])
            if len(matches) != 1:
                raise DataError(f"Kanpur team {row['name']} matched {len(matches)} pool teams.")
            user = matches[0]
        if user in linked:
            raise DataError(f"Kanpur lists pool team {user} twice.")
        linked[user] = {"status": row["status"], "number": row["number"], "id": row["id"], "quota": row["quota"]}
    return linked


def build_dataset(teams, amritapuri, chennai, chennai_open_women, kanpur, checked):
    users = {team["user"] for team in teams}
    for label, listed in (("Amritapuri", amritapuri), ("Chennai", chennai), ("Kanpur", kanpur)):
        unknown = set(listed) - users
        if unknown:
            raise DataError(f"{label} lists teams that are not in the pool: {sorted(unknown)[:5]}")

    merged = []
    counts = {"selected": 0, "two_regionals": 0, "kanpur_waiting_only": 0, "not_listed": 0}
    for team in teams:
        team = dict(team)
        user = team["user"]
        if user in amritapuri:
            team["amritapuri"] = amritapuri[user]
        if user in chennai:
            team["chennai"] = chennai[user]
        if user in kanpur:
            team["kanpur"] = kanpur[user]
        merged.append(team)

        selected_at = (user in amritapuri) + (user in chennai) + (kanpur.get(user, {}).get("status") == "selected")
        if selected_at:
            counts["selected"] += 1
        if selected_at == 2:
            counts["two_regionals"] += 1
        if not selected_at:
            counts["kanpur_waiting_only" if user in kanpur else "not_listed"] += 1

    statuses = [entry["status"] for entry in kanpur.values()]
    counts.update(
        pool=len(teams),
        amritapuri=len(amritapuri),
        chennai=len(chennai),
        chennai_open_women=chennai_open_women,
        kanpur=statuses.count("selected"),
        kanpur_waiting=statuses.count("waiting"),
    )
    return {"checked": checked, "counts": counts, "teams": merged}


def _page_path(name):
    return CACHE / name / "page"


def download_all():
    for name, url in SOURCES.items():
        path = _page_path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {name}...")
        subprocess.run(["curl", "-sS", "--fail", "--max-time", "60", url, "-o", str(path)], check=True)


def main(argv):
    if "--offline" not in argv:
        download_all()
    read = lambda name: _page_path(name).read_text(encoding="utf-8")

    pool = parse_pool(read("pool"))
    chennai, open_slots = parse_chennai(read("chennai"))
    amritapuri = parse_amritapuri(read("amritapuri"))
    kanpur = link_kanpur(parse_kanpur(read("kanpur")), pool)
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date().isoformat()
    data = build_dataset(pool, amritapuri, chennai, open_slots, kanpur, today)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    for key, value in data["counts"].items():
        print(f"{key}: {value}")
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size // 1024} KB)")
    if "<table" in read("mathura") or len(read("mathura")) > 5000:
        print("NOTE: the Mathura page has changed. Check if its list is out and add it to this script.")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (DataError, subprocess.CalledProcessError) as error:
        sys.exit(f"Stopped, data.json was not changed: {error}")
