import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_data as bd

POOL_HEAD = (
    "<table><thead><tr><th>Standing<th>Preliminary Username<th>Team Name(s)<th>Institute Name(s)"
    "<th>Problems Solved<th>Score<th>Total Time<th>Penalty<th>PHNCHRG<th>IC26CS<th>IC26MP<th>IC26CB"
    "<th>IC26SH<th>IC26LR<th>IC26TM<th>IC26AM<th>IC26MM<th>IC26BM</thead><tbody>"
)


def pool_row(rank, user, team, college, solved, time="01:00:00", penalty=0):
    marks = "".join("<td>100" for _ in range(solved)) + "".join("<td>" for _ in range(10 - solved))
    return (
        f"<tr><td>{rank}<td>{user}<td>{team}<td>{college}<td>{solved}<td>{solved * 100}"
        f"<td>{time}<td>{penalty}{marks}\n"
    )


def pool_page(rows, stated):
    return f"<p>{stated} teams in standing order. 100 teams per page.</p>{POOL_HEAD}{''.join(rows)}</tbody></table>"


class ParseTables(unittest.TestCase):
    def test_reads_cells_when_closing_tags_are_missing(self):
        html = "<table><tr><td>1<td>a<tr><td>2<td>b</table>"
        self.assertEqual(bd.parse_tables(html), [[["1", "a"], ["2", "b"]]])

    def test_decodes_entities_and_tidies_spaces(self):
        html = "<table><tr><td>Thapar  &amp;\n Tech</td></tr></table>"
        self.assertEqual(bd.parse_tables(html), [[["Thapar & Tech"]]])

    def test_keeps_two_tables_apart(self):
        html = "<table><tr><td>a</td></tr></table><p>x</p><table><tr><td>b</td></tr></table>"
        self.assertEqual(bd.parse_tables(html), [[["a"]], [["b"]]])


class ParsePool(unittest.TestCase):
    def test_reads_every_team_field(self):
        html = pool_page(
            [pool_row(1, "icpcol260148", "3 of a Kind", "Indian Institute of Technology - Roorkee", 8, "04:33:43", 2)],
            "1",
        )
        self.assertEqual(
            bd.parse_pool(html),
            [
                {
                    "rank": 1,
                    "user": "icpcol260148",
                    "name": "3 of a Kind",
                    "college": "Indian Institute of Technology - Roorkee",
                    "short": "IIT Roorkee",
                    "solved": 8,
                    "time": "04:33:43",
                    "penalty": 2,
                    "problems": "1111111100",
                }
            ],
        )

    def test_splits_a_team_with_a_different_name_per_regional(self):
        html = pool_page(
            [pool_row(2921, "icpcol260031", "Amritapuri 1163490: Flyer Kanpur 1155398: Grandmaster", "CMR", 2)], "1"
        )
        team = bd.parse_pool(html)[0]
        self.assertEqual(team["name"], "Flyer / Grandmaster")
        self.assertEqual(
            team["names"],
            [
                {"regional": "Amritapuri", "id": "1163490", "name": "Flyer"},
                {"regional": "Kanpur", "id": "1155398", "name": "Grandmaster"},
            ],
        )

    def test_shows_a_repeated_regional_name_once(self):
        html = pool_page([pool_row(5, "u", "Amritapuri 1000001: Same Kanpur 1000002: Same", "C", 1)], "1")
        self.assertEqual(bd.parse_pool(html)[0]["name"], "Same")

    def test_does_not_split_a_team_name_that_mentions_a_city(self):
        html = pool_page([pool_row(9, "u", "Kanpur Kings 2026", "C", 1)], "1")
        team = bd.parse_pool(html)[0]
        self.assertEqual(team["name"], "Kanpur Kings 2026")
        self.assertNotIn("names", team)

    def test_stops_when_solved_count_disagrees_with_problem_cells(self):
        row = pool_row(1, "u", "T", "C", 3).replace("<td>3<td>300", "<td>4<td>400")
        with self.assertRaises(bd.DataError):
            bd.parse_pool(pool_page([row], "1"))

    def test_stops_when_page_lost_rows_during_download(self):
        with self.assertRaises(bd.DataError):
            bd.parse_pool(pool_page([pool_row(1, "u", "T", "C", 1)], "3,884"))

    def test_stops_when_page_no_longer_states_a_team_count(self):
        html = f"{POOL_HEAD}{pool_row(1, 'u', 'T', 'C', 1)}</tbody></table>"
        with self.assertRaises(bd.DataError):
            bd.parse_pool(html)


class ShortCollege(unittest.TestCase):
    def test_shortens_only_the_well_known_names(self):
        cases = [
            ("Indian Institute of Technology - Roorkee", "IIT Roorkee"),
            ("Indian Institute of Technology (ISM), Dhanbad", "IIT (ISM) Dhanbad"),
            ("Indian Institute of Information Technology, Allahabad", "IIIT Allahabad"),
            ("International Institute of Information Technology - Bangalore", "IIIT Bangalore"),
            ("National Institute of Technology, Patna", "NIT Patna"),
            ("National Institute of Technology Karnataka, Surathkul", "NIT Karnataka, Surathkul"),
            ("Motilal Nehru National Institute of Technology - Allahabad", "Motilal Nehru National Institute of Technology - Allahabad"),
            ("Indian Institute of Science, Bangalore", "Indian Institute of Science, Bangalore"),
            (
                "Indian Institute of Information Technology and Management, Gwalior",
                "Indian Institute of Information Technology and Management, Gwalior",
            ),
        ]
        for full, want in cases:
            with self.subTest(full):
                self.assertEqual(bd.short_college(full), want)


CHENNAI_HEAD = "<table><thead><tr><th>S.No</th><th>Team Name</th><th>Problems Solved</th><th>Username</th><th>Institute</th><th>Category</th></tr></thead><tbody>"


def chennai_page(*rows):
    cells = "".join(
        "<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in rows
    )
    return f"{CHENNAI_HEAD}{cells}</tbody></table>"


class ParseChennai(unittest.TestCase):
    def test_gives_each_team_a_plain_category_and_counts_open_slots(self):
        html = chennai_page(
            ("1", "A", "8", "icpcol1", "X", "Overall Topper"),
            ("48", "B", "6", "icpcol2", "Y", "Institutional Toppers"),
            ("117", "C", "4", "icpcol3", "Z", "ALL Women Team"),
            ("118", "To Be Announced", "—", "—", "To Be Announced", "ALL Women Team"),
        )
        teams, open_slots = bd.parse_chennai(html)
        self.assertEqual(
            teams,
            {
                "icpcol1": {"category": "Overall topper"},
                "icpcol2": {"category": "Institutional topper"},
                "icpcol3": {"category": "All women"},
            },
        )
        self.assertEqual(open_slots, 1)

    def test_stops_on_a_category_it_does_not_know(self):
        html = chennai_page(("1", "A", "8", "icpcol1", "X", "Wild Card"))
        with self.assertRaises(bd.DataError):
            bd.parse_chennai(html)

    def test_stops_when_a_named_team_has_no_username(self):
        html = chennai_page(("1", "Real Team", "8", "—", "X", "Overall Topper"))
        with self.assertRaises(bd.DataError):
            bd.parse_chennai(html)


class ParseAmritapuri(unittest.TestCase):
    def test_reads_centre_and_rank_with_commas_in_college_names(self):
        text = (
            "﻿Rank,Team Name,Institution,Username,Score,Total Time,Site\n"
            '359,"O(3log n)","University College of Engineering, Osmania University",icpcol263358,1,00:47:01,Bengaluru\n'
        )
        self.assertEqual(bd.parse_amritapuri(text), {"icpcol263358": {"centre": "Bengaluru", "rank": 359}})


KANPUR_PAGE = (
    "<table><tr><th>Sl No</th><th>Team Name</th><th>Team ID</th><th>Institute Name</th><th>Selection Quota</th></tr>"
    "<tr><td>62</td><td>bumblebee</td><td>1153339</td><td>IIIT Allahabad</td><td>All Women</td></tr></table>"
    "<table><tr><th>Waiting List No.</th><th>Team Name</th><th>Team ID</th><th>Institute Name</th><th>Selection Quota</th></tr>"
    "<tr><td>1</td><td>Critical_Path</td><td>1156460</td><td>IIT Kharagpur</td><td>General</td></tr></table>"
)


class ParseKanpur(unittest.TestCase):
    def test_marks_rows_as_selected_or_waiting(self):
        self.assertEqual(
            bd.parse_kanpur(KANPUR_PAGE),
            [
                {"status": "selected", "number": 62, "name": "bumblebee", "id": "1153339", "college": "IIIT Allahabad", "quota": "All Women"},
                {"status": "waiting", "number": 1, "name": "Critical_Path", "id": "1156460", "college": "IIT Kharagpur", "quota": "General"},
            ],
        )

    def test_stops_when_the_waiting_list_table_is_missing(self):
        one_table = KANPUR_PAGE.split("</table>")[0] + "</table>"
        with self.assertRaises(bd.DataError):
            bd.parse_kanpur(one_table)


def kanpur_row(name, team_id, college, status="selected", number=1, quota="General"):
    return {"status": status, "number": number, "name": name, "id": team_id, "college": college, "quota": quota}


class LinkKanpur(unittest.TestCase):
    pool = [
        {"user": "u_id", "name": "Void / Void_", "college": "IIT Guwahati", "names": [{"regional": "Kanpur", "id": "1155310", "name": "Void_"}]},
        {"user": "u_name", "name": "Can't Decide a Name", "college": "COEP Tech"},
        {"user": "u_twin1", "name": "Gryffindor", "college": "Same College"},
        {"user": "u_twin2", "name": "Gryffindor", "college": "Same College"},
    ]

    def test_links_by_team_id_even_when_the_name_differs(self):
        linked = bd.link_kanpur([kanpur_row("Totally Different", "1155310", "Other")], self.pool)
        self.assertEqual(list(linked), ["u_id"])

    def test_links_by_name_and_college_ignoring_case_and_punctuation(self):
        linked = bd.link_kanpur([kanpur_row("CANT decide a name", "999", "coep-tech", "waiting", 4)], self.pool)
        self.assertEqual(linked, {"u_name": {"status": "waiting", "number": 4, "id": "999", "quota": "General"}})

    def test_stops_when_a_team_cannot_be_found(self):
        with self.assertRaises(bd.DataError):
            bd.link_kanpur([kanpur_row("Nobody", "999", "Nowhere")], self.pool)

    def test_stops_instead_of_guessing_between_two_matches(self):
        with self.assertRaises(bd.DataError):
            bd.link_kanpur([kanpur_row("Gryffindor", "999", "Same College")], self.pool)


class BuildDataset(unittest.TestCase):
    def teams(self):
        return [{"user": u, "name": u} for u in ("both", "kanpur", "wait", "none")]

    def build(self, amritapuri=None):
        return bd.build_dataset(
            self.teams(),
            amritapuri if amritapuri is not None else {"both": {"centre": "Mysuru", "rank": 1}},
            {"both": {"category": "Overall topper"}},
            4,
            {
                "kanpur": {"status": "selected", "number": 1, "id": "1", "quota": "General"},
                "wait": {"status": "waiting", "number": 1, "id": "2", "quota": "General"},
            },
            "2026-11-02",
        )

    def test_attaches_each_list_to_the_right_team(self):
        by_user = {t["user"]: t for t in self.build()["teams"]}
        self.assertEqual(by_user["both"]["amritapuri"], {"centre": "Mysuru", "rank": 1})
        self.assertEqual(by_user["both"]["chennai"], {"category": "Overall topper"})
        self.assertEqual(by_user["wait"]["kanpur"]["status"], "waiting")
        self.assertEqual(set(by_user["none"]), {"user", "name"})

    def test_counts_selected_waiting_and_not_listed_teams(self):
        data = self.build()
        self.assertEqual(data["checked"], "2026-11-02")
        self.assertEqual(
            data["counts"],
            {
                "pool": 4,
                "selected": 2,
                "two_regionals": 1,
                "kanpur_waiting_only": 1,
                "not_listed": 1,
                "amritapuri": 1,
                "chennai": 1,
                "chennai_open_women": 4,
                "kanpur": 1,
                "kanpur_waiting": 1,
            },
        )

    def test_stops_when_a_selected_team_is_not_in_the_pool(self):
        with self.assertRaises(bd.DataError):
            self.build(amritapuri={"ghost": {"centre": "Mysuru", "rank": 1}})


if __name__ == "__main__":
    unittest.main()
