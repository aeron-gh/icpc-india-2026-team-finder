// Dates, deadlines and links. Edit this file by hand when a regional posts something new.
// "when" is what students read. "iso" is the same moment in IST, used to mark it closed.

export const REGIONALS = [
  {
    key: "chennai",
    name: "Chennai",
    published: true,
    dates: "10–11 Dec 2026",
    where: "SRM Institute of Science and Technology",
    fee: "Onsite fee: ₹4,500 per team",
    site: "https://icpcchennai.vercel.app/",
    list: "https://icpcchennai.vercel.app/contest-info/official-ranklist",
    deadlines: [
      {
        label: "Rank issue form closes",
        when: "3 Nov, 7 PM",
        iso: "2026-11-03T19:00:00+05:30",
        url: "https://forms.gle/CEM9VRWYhjL8RCD77",
      },
      {
        label: "Women's team claim closes",
        when: "4 Nov, 8 PM",
        iso: "2026-11-04T20:00:00+05:30",
        url: "https://forms.gle/GJLyYsAkXxPMRUak9",
      },
      { label: "Onsite confirmation closes", when: "18 Nov", iso: "2026-11-18T23:59:00+05:30" },
    ],
  },
  {
    key: "kanpur",
    name: "Kanpur",
    published: true,
    dates: "22–23 Dec 2026",
    where: "Kanpur, Gandhinagar or Pune. Your centre comes by email.",
    fee: "Onsite fee: ₹4,500 per team",
    site: "https://kanpur.indiaicpc.in/",
    list: "https://kanpur.indiaicpc.in/onsite2026.html",
    deadlines: [
      { label: "Selected teams get an email by", when: "3 Nov, 10 PM", iso: "2026-11-03T22:00:00+05:30" },
      { label: "Fee and onsite form due", when: "12 Nov, 5 PM", iso: "2026-11-12T17:00:00+05:30" },
    ],
    warning: "Miss this and your slot goes to the waiting list.",
  },
  {
    key: "mathura",
    name: "Mathura",
    published: false,
    dates: "27–28 Dec 2026",
    where: "GLA University",
    fee: "Onsite fee: ₹4,500 per team",
    site: "https://mathuraicpc.in/",
    deadlines: [],
  },
  {
    key: "amritapuri",
    name: "Amritapuri",
    published: true,
    dates: "1–2 Jan 2027",
    where: "Amritapuri (Kollam), Bengaluru, Coimbatore or Mysuru",
    fee: "Onsite fee: check the regional site",
    site: "https://amritaicpc.in/",
    list: "https://amritaicpc.in/selected-amritapuri",
    deadlines: [],
    note: "No confirmation deadline posted yet.",
  },
];

export const LINKS = [
  { label: "Final selection pool", url: "https://indiaicpc.in/selection_pool_2026.html" },
  {
    label: "Post-contest statement",
    url: "https://indiaicpc.in/requests/c01a70d1cc220e9f-ICPC_India_2026_Contest_Integrity_Review.pdf",
  },
  { label: "Practice the contest problems", url: "https://www.codechef.com/ICPCOL26POST" },
  { label: "ICPC regional rules", url: "https://icpc.global/regionals/rules" },
  { label: "ICPC India main site", url: "https://indiaicpc.in/" },
];
