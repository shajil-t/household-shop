# Household Clearance Sale — a static catalogue site

A small, fast, framework-free catalogue for selling household items. Think Facebook
Marketplace or Takealot, minus the shop: **there is no cart, no checkout and no payment
processing.** Buyers browse the items, then contact the seller, make an offer or share a
listing — all through WhatsApp and the device's own share sheet.

- **Content lives in a Google Sheet** — anyone who can edit a spreadsheet can run the sale.
- **A GitHub Action syncs the sheet to `data/items.json`** every hour (and on demand).
- **GitHub Pages serves the site** — no server, no build step, no dependencies at runtime.

Built with vanilla HTML, CSS and ES2022 modules. No framework, no jQuery, no CSS library.

---

## Contents

1. [Project structure](#project-structure)
2. [Quick start](#quick-start)
3. [Configuration](#configuration)
4. [Setting up the Google Sheet](#setting-up-the-google-sheet)
5. [Uploading images](#uploading-images)
6. [Item actions (contact, offer, share)](#item-actions-contact-offer-share)
7. [Deploying to GitHub Pages](#deploying-to-github-pages)
8. [How the GitHub Action works](#how-the-github-action-works)
9. [Day-to-day tasks](#day-to-day-tasks)
10. [Architecture notes](#architecture-notes)
11. [Browser support & accessibility](#browser-support--accessibility)
12. [Troubleshooting](#troubleshooting)

---

## Project structure

```
/
├── index.html                  Page shell: header, toolbar, grid, drawer, modal, lightbox
├── css/
│   └── styles.css              Design tokens + all styling (numbered sections)
├── js/
│   ├── app.js                  Entry point — wiring only
│   ├── config.js               ⚙️ Site settings you edit (WhatsApp number, branding…)
│   ├── api.js                  Loads and normalises data/items.json
│   ├── render.js               Cards, skeletons, carousels, filter controls, empty state
│   ├── modal.js                Detail modal + lightbox behaviour
│   ├── filters.js              View state, URL sync, search/filter/sort logic
│   ├── icons.js                Inline SVG icon set
│   └── utils.js                Formatting, debounce, focus trap, lazy loading helpers
├── data/
│   ├── items.json              Generated — do not edit by hand
│   └── sheet-template.csv      Starter content; import this into Google Sheets
├── images/
│   ├── <item-id>/…             One folder per item, named exactly like its id
│   ├── placeholder.svg         Fallback when a photo is missing
│   ├── favicon.svg
│   └── og-image.svg            Social sharing preview
├── docs/
│   └── DEPLOYMENT.md           Full GitHub Pages guide (hosting, domains, rollback)
├── scripts/
│   ├── sheet-to-json.js        Sheet ➜ JSON sync (npm run sync)
│   ├── sheet.config.json       ⚙️ Which sheet to sync
│   ├── serve.js                Local dev server (npm run serve)
│   └── deploy.js               Publish preflight + push helper (npm run deploy)
├── .github/workflows/
│   ├── sync-sheet.yml          Hourly + manual sheet sync, commits the result
│   └── deploy-pages.yml        Optional: Pages deploy when Source = GitHub Actions
├── .nvmrc                      Node version used locally and in CI (22)
├── .nojekyll                   Tells GitHub Pages to serve the files as-is
└── package.json
```

Only two files normally need editing: **`js/config.js`** and **`scripts/sheet.config.json`**.

---

## Quick start

```bash
nvm use              # optional: switches to the Node version in .nvmrc (22)
npm install          # no runtime dependencies — this just sets up package metadata
npm run serve        # http://localhost:4173
```

`.nvmrc` pins the Node major version, and `sync-sheet.yml` reads that same file via
`node-version-file`, so CI and your machine never drift apart. Without nvm, any Node 18+
works — that is the real floor declared in `package.json` `engines`.

> Open the site through `npm run serve`, not by double-clicking `index.html`.
> ES modules and `fetch()` are blocked on the `file://` protocol.

The repo ships with ten sample items and generated demo photos so you can see the finished
UI immediately. Replace them with your own (see below).

The four commands:

| Command | What it does |
| --- | --- |
| `npm run serve` | Static dev server on <http://localhost:4173> |
| `npm run sync` | Pull the Google Sheet into `data/items.json` |
| `npm run deploy` | GitHub Pages preflight check — reads only, prints what to do next |
| `npm run deploy -- --push` | Commit and push the site to `origin` |

---

## Configuration

### `js/config.js` — the front end

| Setting | What it does |
| --- | --- |
| `siteName` | Header title, page title and the WhatsApp message |
| `tagline` | Line under the title |
| `whatsappNumber` | Seller's number, digits only, international format. **Leave empty to hide the contact and offer buttons.** |
| `allowOffers` | Set to `false` to hide the "Make an Offer" button and its form |
| `carouselInterval` | Milliseconds per card slide (default `4000`) |
| `searchDebounce` | Search delay in ms (default `300`) |
| `sortOptions`, `defaultSort` | Contents and default of the sort dropdown |
| `placeholderImage` | Shown when a photo is missing or fails to load |

South African numbers: drop the leading `0` and prefix `27`.
`082 123 4567` becomes `27821234567`.

### `scripts/sheet.config.json` — the sync

```json
{
  "sheetId": "1AbC…the long id from your sheet URL",
  "gid": "0",
  "csvUrl": "",
  "outputFile": "data/items.json",
  "imagesDir": "images"
}
```

The sheet id is the long token in the sheet's address:

```
https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit#gid=<GID>
```

Environment variables override the file, which is how CI supplies them:
`SHEET_ID`, `SHEET_GID`, or a complete `SHEET_CSV_URL`.

---

## Setting up the Google Sheet

1. Create a new Google Sheet.
2. **File ▸ Import** `data/sheet-template.csv` to get the correct headers and a worked
   example, or type the header row yourself:

   | id | title | price | description | status | category | condition | location | images | date_added | featured |
   | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

3. Fill in one row per item:

   | Column | Required | Notes |
   | --- | --- | --- |
   | `id` | ✅ | Unique, lowercase, no spaces (e.g. `fridge-001`). **Also the image folder name.** |
   | `title` | ✅ | Shown on the card |
   | `price` | | Numbers only is best; `R6 000`, `6,000` and `6000.50` are all parsed. Leave blank for "Price on request" |
   | `description` | | Free text. Commas are fine |
   | `status` | | `available`, `reserved` or `sold`. Blank means `available` |
   | `category` | | Free text — the filter list builds itself from these values. Blank becomes `Other` |
   | `condition` | | Free text (e.g. `Excellent`) |
   | `location` | | Collection area (e.g. `Midrand`) |
   | `images` | | **Filenames only**, comma separated: `1.jpg,2.jpg,inside.jpg` |
   | `date_added` | | Optional `YYYY-MM-DD`; drives "Newest first" |
   | `featured` | | Optional `yes`/`true` |

   Column order does not matter, and headers are matched case- and space-insensitively.

4. Share the sheet: **Share ▸ General access ▸ Anyone with the link ▸ Viewer.**
   The sync reads the sheet's public CSV endpoint, so this step is required. Nothing but
   the columns above is ever published.

5. Put the sheet id into `scripts/sheet.config.json` (or the `SHEET_ID` repository
   variable) and run `npm run sync`.

---

## Uploading images

The `images` column holds **filenames only**. The folder comes from the item's `id`:

```
Sheet row:  id = fridge-001 , images = 1.jpg,2.jpg,inside.jpg
On disk:    images/fridge-001/1.jpg
            images/fridge-001/2.jpg
            images/fridge-001/inside.jpg
```

To add photos:

1. Create `images/<item-id>/` (exactly matching the `id`).
2. Drop the photos in. `.jpg`, `.png`, `.webp` and `.svg` all work.
3. List the filenames in the sheet's `images` column.
4. Commit and push the images (the Action syncs the *sheet*, never your photos).

Tips

- Resize to roughly **1200 × 900** and keep files under ~300 KB — cards are lazy-loaded, but
  visitors on mobile data will thank you.
- The first filename is the card's cover photo.
- A missing file silently falls back to `images/placeholder.svg`, and `npm run sync` prints a
  warning listing every referenced file that is not in the repo yet.
- Need to share one photo between items? Put a path with a slash in the `images` cell
  (e.g. `images/shared/lounge.jpg`) and it is used verbatim.

---

## Item actions (contact, offer, share)

Every item's modal ends with one action group. There is still no checkout — each action
either opens WhatsApp or hands the link to the visitor.

| Action | What happens |
| --- | --- |
| **Contact Seller on WhatsApp** | Opens `wa.me` with a pre-filled enquiry naming the item, its asking price and a link back to it |
| **Make an Offer** | Expands a small form, validates the amount, then opens WhatsApp with an enquiry that states the asking price *and* the visitor's offer |
| **Share** | Uses the device's native share sheet (WhatsApp, Messages, email…) and falls back to copying the link, confirming with "Link copied" on the button |

Details worth knowing:

- **Offers are messages, not bids.** Nothing is stored, ranked or recorded anywhere — the
  seller simply receives "Asking price: R6,000 / My offer: R5,500" on WhatsApp and replies.
  There is no server to hold a bid, which is exactly why this site is cheap to run.
- Amounts are validated in the browser: they must be a number above `R0` and below
  `R10,000,000`, and they are rounded to cents. Errors appear inline via `role="alert"`.
- `Enter` in the amount field submits; `Esc` collapses the form (and only then closes the
  modal); focus returns to the button that opened it.
- **Sold items** hide the contact and offer buttons but keep **Share**, so a listing can
  still be passed on.
- Share links are deep links: `https://…/#item=fridge-001` opens the site with that item's
  modal already open. The fragment is kept separate from the filter query parameters, so
  `?status=available#item=fridge-001` works too, and sharing never leaks the sender's
  current search.

---

## Deploying to GitHub Pages

📖 **Full guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — repository setup, the two Pages
sources, custom domains, verification checklist, rollback and a Pages-specific troubleshooting
table.

The short version:

```bash
npm run deploy                 # preflight: config, content, hosting gotchas (changes nothing)
npm run deploy -- --push       # commit + push to an existing origin
```

Then, once, in the repository: **Settings ▸ Pages** → Source **Deploy from a branch** →
Branch **your default branch** (`main` or `master`) → Folder **`/ (root)`** → **Save**.

Your site is at `https://<you>.github.io/<repo>/` a minute or two later. Every push
republishes it, including the hourly commits made by the sync workflow.

Starting from nothing and have the [GitHub CLI](https://cli.github.com/)? One command creates
the repository, pushes and enables Pages:

```bash
npm run deploy -- --create household-shop
```

Two more settings worth doing on the first deploy:

- **Settings ▸ Actions ▸ General ▸ Workflow permissions → Read and write** — otherwise the
  hourly sync cannot commit `data/items.json`.
- **Settings ▸ Secrets and variables ▸ Actions ▸ Variables** → `SHEET_ID`, `SHEET_GID`
  (optional; keeps the sheet id out of the committed config).

`.github/workflows/deploy-pages.yml` is only needed if you set the Pages source to
*GitHub Actions* instead of a branch — see the guide for which to pick. Delete it otherwise.

---

## How the GitHub Action works

`.github/workflows/sync-sheet.yml` runs **every hour** and whenever you press
*Run workflow* in the **Actions** tab:

```
Checkout ▸ Set up Node 20 ▸ npm install ▸ npm run sync ▸ commit data/items.json ▸ push
```

Details worth knowing:

- If the catalogue has not changed, the script leaves the file alone and the job commits
  nothing — no empty commits, no needless Pages rebuilds.
- The workflow has no `push` trigger, so it can never trigger itself. The commit deliberately
  omits `[skip ci]` so that `deploy-pages.yml` can still pick it up when Pages is set to
  *GitHub Actions* (a `GITHUB_TOKEN` push raises no `push` event, so that workflow listens for
  this one finishing instead).
- It rebases before pushing, so a sync that overlaps with your own push will not fail.
- Configure the sheet in CI with **Settings ▸ Secrets and variables ▸ Actions**:
  - Variables: `SHEET_ID`, `SHEET_GID`
  - or Secret: `SHEET_CSV_URL`

  Without them the workflow falls back to `scripts/sheet.config.json`, which is perfectly
  fine for a public sheet.
- GitHub disables scheduled workflows in repositories with no activity for 60 days; press
  *Run workflow* once to re-enable.

---

## Day-to-day tasks

### Add a new item

1. Add a row to the sheet with a fresh `id`, e.g. `heater-011`.
2. Create `images/heater-011/` and commit the photos.
3. List the filenames in the `images` column.
4. Wait for the hourly sync, or run the workflow manually, or run `npm run sync` and push.

### Mark an item as sold

Change its `status` cell to `sold`. Within the hour the card shows a **red SOLD badge**,
turns greyscale, sinks to the bottom of every sort order and loses its WhatsApp button.
Set it to `reserved` for an **orange RESERVED badge** while a buyer is deciding.

### Remove an item completely

Delete the row from the sheet. Optionally delete `images/<id>/` in a follow-up commit.

### Change the price

Edit the `price` cell. Prices render as South African Rand (`R6,000`).

### Reorder the catalogue

"Newest first" uses `date_added` when present and otherwise the sheet's row order — the
lower a row sits in the sheet, the newer it is considered.

---

## Architecture notes

**Data flow**

```
Google Sheet ──(GitHub Action, hourly)──► data/items.json ──(fetch)──► browser
```

**Module boundaries** — each file has one job, and only `app.js` knows about all of them:

| Module | Responsibility |
| --- | --- |
| `config.js` | Settings. No logic |
| `api.js` | The *only* place that fetches data. Normalises every field so the rest of the app can trust its input |
| `filters.js` | `FilterState` (a tiny observable store) + pure `applyFilters()`. Framework-free but predictable: one state change ➜ one render |
| `render.js` | All DOM construction. Caches cards by id, so re-sorting reorders nodes instead of rebuilding them |
| `modal.js` | Detail overlay and lightbox, including focus management |
| `utils.js` | Formatting, `debounce`, focus trap, lazy-loading observer |
| `icons.js` | Inline SVG set — no icon font, no sprite request |
| `app.js` | Wiring: cache DOM, load data, bind events, render |

**Performance choices**

- Skeleton cards during load; images are lazy (`loading="lazy"` + an `IntersectionObserver`
  that only promotes `data-src` shortly before a card scrolls in).
- A card's remaining carousel photos are prefetched just before it scrolls into view, and
  on demand if the carousel reaches a slide first.
- **One** timer drives every carousel on the page. Off-screen, hovered, focused and
  background-tab carousels are skipped.
- Card nodes are reused across renders, and `render()` bails out early when a state update
  changes nothing.
- Event delegation on the grid means the number of listeners does not grow with the
  catalogue.

**State in the URL** — search, filters and sort are mirrored into the query string
(`?q=fridge&status=available&category=Kitchen&sort=price-asc`), and the open item into the
fragment (`#item=fridge-001`), so any view can be shared or bookmarked. Both use
`replaceState`, so browsing does not fill up the Back button; Back still leaves the site.

---

## Browser support & accessibility

Targets the current versions of Chrome, Edge, Firefox and Safari (ES2022 modules,
`:has()`, `aspect-ratio`, `AbortSignal.timeout`).

- Full keyboard support: `Tab` reaches every card's **View Details** button (and its carousel
  dots), `Enter`/`Space` opens the item, `Esc` closes the modal, drawer or lightbox, `←`/`→`
  move through photos, and `/` jumps back to the search box. `Esc` closes the offer form
  before the modal, so nothing is dismissed unexpectedly.
- Focus is trapped inside overlays and restored to the element that opened them.
- ARIA labels on every icon-only control; `role="status"` announces the result count.
- Alt text is generated from each item's title and photo position.
- Honours `prefers-reduced-motion` (animations and smooth scrolling switch off).
- Visible focus rings, and a "skip to items" link.
- Printing produces a clean one-item-per-row list with photos, prices and no chrome.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Google Sheets returned HTML instead of CSV` | The sheet is private. Share it as *Anyone with the link ▸ Viewer* |
| `Google Sheet is not configured` | Set `sheetId` in `scripts/sheet.config.json` or the `SHEET_ID` variable |
| `The sheet must contain at least "id" and "title" columns` | The first row must be the header row — no title rows or merged cells above it |
| Items show the "No photo yet" placeholder | The folder or filename does not match the `images` cell. Names are case-sensitive on GitHub Pages. Run `npm run sync` to list missing files |
| Nothing renders, console shows a module error | The site was opened via `file://`. Use `npm run serve` |
| The Action fails with `permission denied` on push | Settings ▸ Actions ▸ General ▸ Workflow permissions ▸ *Read and write* |
| A Pages-specific problem (404, unstyled page, stale site) | See the table in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#troubleshooting) |
| The hourly sync stopped running | GitHub pauses schedules in dormant repos; press *Run workflow* once |
| The share button says "Copy failed" | The browser blocked clipboard access — this happens on `http://` origins other than `localhost`. GitHub Pages is HTTPS, so it works there |
| Contact / offer buttons are missing | `whatsappNumber` is empty in `js/config.js`, `allowOffers` is `false`, or the item's status is `sold` |
| The sheet changed but the site did not | Wait for the next hourly run, check the Actions tab, then hard-refresh (`Cmd/Ctrl+Shift+R`) |

---

## Licence

MIT. The demo photos in `images/` are generated placeholders — replace them with your own.
