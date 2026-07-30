# Deploying to GitHub Pages

Everything needed to get this catalogue live, and to keep it live. The site is static —
there is nothing to build and no server — so hosting it is mostly a matter of pushing the
repository and flipping one setting.

- [Before you start](#before-you-start)
- [Option 1 — the scripted path (fastest)](#option-1--the-scripted-path-fastest)
- [Option 2 — the manual path](#option-2--the-manual-path)
- [Choosing a Pages source](#choosing-a-pages-source)
- [Verifying the live site](#verifying-the-live-site)
- [Keeping it updated](#keeping-it-updated)
- [Custom domain](#custom-domain)
- [Things that break static hosting](#things-that-break-static-hosting)
- [Troubleshooting](#troubleshooting)
- [Rolling back](#rolling-back)
- [Taking the site down](#taking-the-site-down)

---

## Before you start

| Requirement | Why |
| --- | --- |
| A GitHub account | Pages is free on public repositories |
| Git installed | To push the site |
| Node.js 18+ | For `npm run sync` and the helper scripts. `nvm use` picks up the pinned version from `.nvmrc` (22), which is also what the workflows run |
| *(optional)* [GitHub CLI](https://cli.github.com/) | Lets `npm run deploy -- --create` do the whole setup |

Then set your own details — the preflight below will nag you about both:

1. **`js/config.js`** — `siteName`, `tagline` and especially `whatsappNumber`
   (digits only, international format: `082 123 4567` → `27821234567`).
2. **`scripts/sheet.config.json`** — your `sheetId`, if you want the hourly sync.
   The site works fine without it, straight from the committed `data/items.json`.

Run the preflight check at any time. It changes nothing:

```bash
npm run deploy
```

```
🚀 GitHub Pages preflight

Git
  ✔ Inside a git repository.
  ✔ On branch main — select this branch in Settings ▸ Pages.
  ✔ Origin: your-name/household-shop
  ✔ Working tree is clean.

Configuration
  ✔ WhatsApp number set (27821234567).
  ✔ Site name: "Household Clearance Sale".
  ✔ Google Sheet configured for the sync workflow.

Content
  ✔ 10 item(s) in the catalogue.
  ✔ Every referenced image is present.

Hosting readiness
  ✔ .nojekyll present (Pages serves files verbatim).
  ✔ All asset paths are relative (works under /<repo>/).
  ✔ Image filenames are URL-safe.
```

It checks the things that only show up *after* you publish: root-absolute paths that 404 on a
project site, image filenames with spaces, photos referenced in the sheet but never committed,
and a missing `.nojekyll`.

---

## Option 1 — the scripted path (fastest)

Requires the GitHub CLI, signed in (`gh auth login`).

```bash
npm run deploy -- --create household-shop
```

That one command:

1. runs the preflight and stops if anything is a blocker,
2. `git init` + commits, if the folder is not a repository yet,
3. creates the **public** GitHub repository and pushes to it,
4. enables Pages for your current branch, root folder,
5. prints the live URL.

Already have a repository and a remote? Publish the current state with:

```bash
npm run deploy -- --push
```

Both flags refuse to run while the preflight reports a blocker. Without a flag the script only
ever reads and prints.

---

## Option 2 — the manual path

### 1. Create the repository

On github.com: **New repository** → name it (e.g. `household-shop`) → **Public** → create it
**empty** (no README, no `.gitignore`, no licence — they will collide with these files).

### 2. Push this project

```bash
git init                                   # skip if already a repo
git add -A
git commit -m "feat: household catalogue site"
git branch -M main                         # optional; master works just as well
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 3. Turn Pages on

**Settings ▸ Pages**

| Field | Value |
| --- | --- |
| Source | **Deploy from a branch** |
| Branch | your default branch (`main` or `master`) |
| Folder | **`/ (root)`** |

Press **Save**. GitHub starts a `pages-build-deployment` run — watch it in the **Actions** tab.

### 4. Open the site

```
https://<you>.github.io/<repo>/
```

The first deployment usually takes 1–2 minutes. A repository named exactly
`<you>.github.io` is served from `https://<you>.github.io/` instead.

### 5. Let the sync workflow write to the repository

**Settings ▸ Actions ▸ General ▸ Workflow permissions** → **Read and write permissions** →
Save. Without this the hourly sheet sync cannot push `data/items.json`.

Optionally point the workflow at your sheet without committing the id:
**Settings ▸ Secrets and variables ▸ Actions ▸ Variables** → `SHEET_ID`, `SHEET_GID`
(or the secret `SHEET_CSV_URL`).

---

## Choosing a Pages source

There are two ways GitHub can publish this repository. **Pick one.**

| | **Deploy from a branch** (recommended) | **GitHub Actions** |
| --- | --- | --- |
| Setup | One dropdown | One dropdown + keep `deploy-pages.yml` |
| How it works | GitHub serves the branch as-is | The workflow uploads the repo as a Pages artifact |
| Extra Actions minutes | None | A short run per deploy |
| When to prefer it | Almost always — the site needs no build | You want deployment logs, environments, or a build step later |

- Using **Deploy from a branch**? You can delete `.github/workflows/deploy-pages.yml`.
- Using **GitHub Actions**? Set **Settings ▸ Pages ▸ Source** to *GitHub Actions* and keep the
  file. Note the wrinkle it already handles for you: pushes made by a workflow's
  `GITHUB_TOKEN` (like the hourly sync commit) deliberately **do not** fire `push` events, so
  a `push`-only deploy workflow would never notice new catalogue data. `deploy-pages.yml`
  therefore also triggers on `workflow_run` when *Sync Google Sheet* finishes successfully.

Either way, `.nojekyll` keeps GitHub from running the files through Jekyll.

---

## Verifying the live site

Work through this once, on the real URL rather than `localhost`:

1. **Items appear** — if you see skeleton cards forever, `data/items.json` failed to load.
2. **Photos load** — a "No photo yet" placeholder means a filename mismatch. Remember that
   Pages is **case-sensitive**: `IMG_1234.JPG` ≠ `img_1234.jpg`.
3. **Search, filters and sort** work, and the URL updates as you use them.
4. **Open an item** → the modal shows the gallery, then check:
   - **Contact Seller on WhatsApp** opens a chat with the right number and a filled-in message,
   - **Make an Offer** accepts an amount and puts it in the message,
   - **Share** opens the share sheet (mobile) or says "Link copied" (desktop),
   - pasting that copied link in a new tab reopens the same item.
5. **Mobile** — one card per row, the Filters drawer slides in, and nothing scrolls sideways.
6. **DevTools ▸ Console and Network** — no red. A 404 on `js/app.js` almost always means the
   Pages folder was set to `/docs` instead of `/ (root)`.

---

## Keeping it updated

| What changed | What to do | How long |
| --- | --- | --- |
| Item details, price, status | Edit the Google Sheet. Nothing else | Live within the hour |
| Want it live *now* | **Actions ▸ Sync Google Sheet ▸ Run workflow** | ~1 minute |
| New photos | Commit `images/<item-id>/…` and push | Immediately after the push |
| Site code or config | Commit and push (or `npm run deploy -- --push`) | Immediately after the push |
| Working offline | `npm run sync` locally, then commit `data/items.json` | On push |

The hourly workflow commits `data/items.json` only when the catalogue actually changed, so
quiet hours produce no commits and no rebuilds.

> GitHub pauses scheduled workflows in repositories with no activity for 60 days. If the
> sync goes quiet, open **Actions ▸ Sync Google Sheet ▸ Run workflow** once to wake it up.

---

## Custom domain

1. **Settings ▸ Pages ▸ Custom domain** → enter `shop.example.com` → **Save**.
   GitHub commits a `CNAME` file for you.
2. At your DNS provider:

   | Domain shape | Record | Value |
   | --- | --- | --- |
   | Subdomain (`shop.example.com`) | `CNAME` | `<you>.github.io` |
   | Apex (`example.com`) | four `A` records | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |

3. Wait for the DNS check to go green, then tick **Enforce HTTPS**.
4. Update the absolute URLs in `index.html` that social platforms read —
   `og:image`, `twitter:image` and `link rel="canonical"`.

---

## Things that break static hosting

- **Project sites live under a sub-path** (`/household-shop/`). Every path in this project is
  relative for that reason. Never change `href="css/styles.css"` to `href="/css/styles.css"`
  — the preflight flags this as a blocker.
- **Case sensitivity.** macOS and Windows do not care about case locally; Pages does. Keep
  ids, folders and filenames lowercase.
- **Spaces and `#`/`%`/`?` in filenames** need URL-escaping to work. Rename photos to
  `lowercase-with-dashes.jpg`. The preflight warns about these.
- **No server-side anything** — no redirects, no rewrites, no `.htaccess`, no server-side
  price checks. That is fine here: the catalogue is a JSON file and a set of images.
- **`file://` does not work.** ES modules and `fetch()` need HTTP. Locally use
  `npm run serve`, not a double-click on `index.html`.
- **Public repository.** Pages on the Free plan serves only public repositories, so treat
  everything committed — including photos and locations — as public.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| **404** at the Pages URL | Pages not enabled yet, wrong branch, or the folder is `/docs` instead of `/ (root)`. Also check the first `pages-build-deployment` run finished |
| Page loads but is unstyled and empty | `css/`, `js/` requests are 404ing. Almost always a root-absolute path (`/css/…`) or the wrong Pages folder |
| Console: *"Failed to load module script … MIME type text/html"* | Same cause: the JS request returned the 404 page instead of a file |
| Skeleton cards never go away | `data/items.json` is missing or invalid. Open `<site>/data/items.json` directly to see |
| "We could not load the catalogue" panel | Same as above; the exact reason is in the browser console |
| Photos show "No photo yet" | Filename or folder mismatch (check the case), or the images were never committed. `npm run sync` lists every referenced file that is missing |
| Sheet edits never appear | Check **Actions ▸ Sync Google Sheet**. `Google Sheets returned HTML instead of CSV` = the sheet is private; share it as *Anyone with the link ▸ Viewer* |
| Sync run fails on `git push` | **Settings ▸ Actions ▸ General ▸ Workflow permissions** → *Read and write* |
| Sync succeeds but the site is stale | With Pages source = *GitHub Actions*, confirm `deploy-pages.yml` exists and ran via `workflow_run`. Otherwise hard-refresh (`Cmd/Ctrl+Shift+R`) |
| Site updates hours late for you only | Browser or CDN cache. Hard-refresh, or open in a private window |
| Share button says "Copy failed" | Clipboard access needs a secure origin. Works on the HTTPS Pages URL; blocked on plain `http://` |
| WhatsApp opens with no message | `whatsappNumber` in `js/config.js` is empty or malformed. Digits only, no `+`, no spaces |

---

## Rolling back

The published site is just a commit, so undoing a bad change is a revert:

```bash
git log --oneline -10           # find the commit
git revert <sha>                # or: git revert HEAD
git push
```

To undo only a catalogue mistake, fix the sheet and run the sync workflow — the next commit
supersedes the bad data.

---

## Taking the site down

- **Temporarily:** Settings ▸ Pages ▸ Source → **None**.
- **Permanently:** make the repository private (Pages stops serving on the Free plan) or
  delete it. Note that anything already published may live on in caches and archives for a
  while, so remove photos you would rather not have public *and* stop the site.
