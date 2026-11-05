# ICPC India 2026 Team Finder

An unofficial page that puts the ICPC India 2026 lists in one place. Search for a team to see its rank, where it was selected, and links to its submissions.

It is a plain static site. The page is in `public/` and needs no build step.

## Update the team lists

```
npm run data
npm test
npm run check
```

`npm run data` downloads the official lists and rewrites `public/data.json`. If a list looks wrong, it stops with an error and leaves the old file alone. Commit and push the new file to publish it.

A team can stay on a regional list after it leaves the final pool. The script leaves such teams out, prints a note, and the page only shows how many there are.

`npm run check` opens the page in headless Chromium and uses it like a student would.

## Update dates and deadlines

Edit `public/info.js`. Deadlines mark themselves closed once their time has passed.

## See it on your computer

```
python3 -m http.server --directory public 8000
```

Then open http://localhost:8000.

## Sources

- [Final selection pool](https://indiaicpc.in/selection_pool_2026.html)
- [Chennai list](https://icpcchennai.vercel.app/contest-info/official-ranklist)
- [Kanpur list](https://kanpur.indiaicpc.in/onsite2026.html)
- [Mathura list](https://mathuraicpc.in/onsite-teams)
- [Amritapuri list](https://amritaicpc.in/selected-amritapuri)
