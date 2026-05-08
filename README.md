# ✿ Carly's Archive ✿

A pink, sparkly, old-school personal archive of every book, album, show, game, concert, and trip I've loved.

Built as a static site (vanilla HTML/CSS/JS) with content sourced from Notion at build time, deployed to GitHub Pages.

---

## Quick start (local)

**Prereqs:** Node.js 18+ (`brew install node` on macOS).

```bash
npm install
cp .env.example .env
# fill in NOTION_TOKEN (and optionally TMDB/RAWG/SETLISTFM keys)
# fill in scripts/databases.json with your Notion database IDs
npm run build      # fetches Notion + enriches, writes /data/*.json
npm run serve      # opens a local static server
```

Then open <http://localhost:3000>.

> **Just want to preview the design without hooking up Notion?** Skip `npm run build` — the pages will load with empty-state placeholders.

---

## How it works

1. You keep your collections in **Notion** (one database per category).
2. A Node script (`scripts/fetch-notion.mjs`) reads each database via the Notion API, normalizes rows, and **auto-enriches** them by calling public APIs (Open Library, MusicBrainz, Jikan, TMDB, RAWG, Setlist.fm).
3. Cover images are downloaded into `/assets/covers/` so they don't expire.
4. The script writes `/data/<category>.json`, `/data/all.json`, and `/data/stats.json`.
5. The static frontend fetches those JSON files in the browser.
6. A GitHub Action runs the build and publishes to GitHub Pages on push, daily, or on demand.

**Notion always wins on conflict.** Anything you type into Notion (rating, notes, year, etc.) is preserved over what the API returns.

---

## Notion setup

### 1. Create the integration
1. Go to <https://www.notion.so/my-integrations> → **+ New integration**.
2. Name it "Carly's Archive", workspace = yours, type = Internal.
3. Copy the **Internal Integration Secret** → paste into `.env` as `NOTION_TOKEN`.

### 2. Create one database per category
For each category you want, create a Notion database (a Table view works great) with the properties below. Property names are matched case-insensitively.

#### Shared properties (all categories)
| Property      | Type         | Notes |
|---------------|--------------|-------|
| Title         | Title        | The default title property — already there. |
| Status        | Select       | Suggested options vary per category (see below). |
| Sentiment     | Select       | How you feel about it. Options: `favorite`, `liked`, `neutral`, `disliked`. |
| Notes         | Text         | Your review / thoughts. |
| Tags          | Multi-select | Free-form tags. |
| Date finished | Date         | When you finished/acquired/visited. |
| Override ID   | Text         | Optional — paste an explicit ID if auto-match picks the wrong record. |

#### Category-specific
- **Books** — add `Author` (Text), `Owned` (Checkbox), `Date started` (Date). Status options: `Read`, `Reading`, `Want to read`, `DNF`. Override ID = ISBN (10 or 13 digits).
- **Manga** — add `Author` (Text), `Volumes owned` (Multi-select of volume numbers like `1`,`2`,`3`,…). Status: `Reading`, `Read`, `On hold`, `Plan to read`, `Owned`. Override ID = MAL manga ID.
- **CDs** — add `Artist` (Text). Override ID = MusicBrainz release ID.
- **Concerts** — add `Artist` (Text), `Date` (Date), `Venue` (Text), `City` (Text). Override ID = setlist.fm setlist ID.
- **Anime** — no extras needed beyond Title. Status: `Watched`, `Watching`, `Plan to watch`. Override ID = MAL ID.
- **TV** — add `Year` (Number). Status: `Watched`, `Watching`, `Plan to watch`. Override ID = TMDB TV ID.
- **Movies** — add `Year` (Number). Status: `Watched`, `Plan to watch`. Override ID = TMDB movie ID.
- **Games** — add `Platform` (Select). Status: `Played`, `Playing`, `Plan to play`. Override ID = RAWG slug.
- **Travel** — add `Place` (Text), `Country` (Text), `Date` (Date). All manual; no API enrichment.

### 3. Share each database with the integration
Open each database → click **`•••`** (top right) → **Connections** → add **Carly's Archive**.

### 4. Grab the database IDs
The URL of a database looks like:
```
https://www.notion.so/<workspace>/<32-char-hex-id>?v=...
```
Copy the 32-char hex (no dashes) and paste into `scripts/databases.json` for the matching category. Leave blank to skip a category.

---

## API keys

All free. Add them to `.env` locally and to GitHub repo **Settings → Secrets → Actions** for deploys.

| Service     | Used for      | Where to get it |
|-------------|---------------|-----------------|
| Open Library | Books        | No key needed |
| MusicBrainz | CDs           | No key needed |
| Jikan       | Anime         | No key needed |
| TMDB        | Movies, TV    | <https://www.themoviedb.org/settings/api> |
| RAWG        | Games         | <https://rawg.io/apidocs> |
| Setlist.fm  | Concerts      | <https://api.setlist.fm/docs/1.0/index.html> |

If a key is missing, that category is still fetched from Notion — it just won't be enriched.

---

## Decoration

Drop cute gifs in `assets/decor/`. Suggested file names: `divider-default.gif`, `blinkie-1.gif`, `sticker-1.gif`, etc. Missing files won't break the page (they're hidden via `onerror`).

---

## Deploy to GitHub Pages

1. Push the repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Settings → Secrets → Actions → New repository secret** for each: `NOTION_TOKEN`, `TMDB_API_KEY`, `RAWG_API_KEY`, `SETLISTFM_API_KEY`.
4. Push to `main` (or run the workflow manually from the Actions tab).

The site rebuilds automatically once a day to pick up Notion changes.

---

## Project layout

```
index.html              ← home page (with sidebar)
404.html
pages/                  ← one HTML page per category + stats
css/theme.css           ← pink Neocities theme
js/
  sparkle.js            ← sparkle cursor trail
  layout.js             ← shared nav/footer helpers
  list-view.js          ← shared card grid + search/filter/sort + modal
assets/
  covers/<category>/    ← downloaded by build script
  decor/                ← your gifs go here
data/                   ← generated JSON; do not edit by hand
scripts/
  fetch-notion.mjs      ← main build entry
  databases.json        ← category → Notion DB ID map
  enrichers/            ← one module per API
  lib/utils.mjs
.github/workflows/deploy.yml
```
