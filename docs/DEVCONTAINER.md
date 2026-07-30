# Developing in a dev container (with a second GitHub account)

The dev container gives this project its own Node toolchain **and its own GitHub
credentials**, so you can commit, push and deploy as an account that has nothing to do with
the one signed in on your host machine.

- [Why a container for this](#why-a-container-for-this)
- [Prerequisites](#prerequisites)
- [Open it](#open-it)
- [Sign in as the other account](#sign-in-as-the-other-account)
- [Push and deploy from inside](#push-and-deploy-from-inside)
- [How the isolation actually works](#how-the-isolation-actually-works)
- [What persists, what does not](#what-persists-what-does-not)
- [Troubleshooting](#troubleshooting)

---

## Why a container for this

Two GitHub accounts on one machine normally means juggling SSH config, `includeIf` blocks in
`~/.gitconfig`, and a keychain entry that silently reasserts itself. The failure is quiet:
you push, it succeeds, and the commits are attributed to the wrong person.

Inside this container:

| | Host | Container |
| --- | --- | --- |
| `gh` token | your usual account | the second account (own volume) |
| `git` commit identity | your usual name/email | set per-repo by `npm run account` |
| SSH key | your usual key | optional container-only key |
| Push credentials | host keychain | the container's `gh` token or key |

Nothing you do in here can push as your host account, and nothing in here touches your host
git configuration.

---

## Prerequisites

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Colima / Rancher
   Desktop / Podman with the Docker socket), running.
2. VS Code with the **Dev Containers** extension (`ms-vscode-remote.remote-containers`).

---

## Open it

Open the project folder in VS Code, then either:

- click **Reopen in Container** in the toast that appears, or
- **Cmd/Ctrl+Shift+P → Dev Containers: Reopen in Container**.

The first build takes a couple of minutes. When it finishes, `post-create.sh` has:

- created and taken ownership of the `~/.ssh` and `~/.config/gh` volumes,
- **stripped any git identity or credential helper inherited from the host**,
- run `npm install`,
- printed the next command.

You land in `/workspaces/household-shop` as the non-root `node` user, with Node 22 (matching
`.nvmrc` and CI) and the GitHub CLI installed.

---

## Sign in as the other account

One interactive command, in the container's terminal:

```bash
npm run account
```

It will:

1. run `gh auth login` (browser code flow) — **sign in with the second account here**,
2. make `gh` git's credential helper for github.com,
3. ask for the commit name and email, defaulting to that account's GitHub name and its
   `…@users.noreply.github.com` address, and set them **`--local`** (this repository only),
4. verify and print exactly who you will act as.

The verification step is the point of the script. It does not assume the setup worked — it
asks git what it would really send:

```
▶ Verification
  ✔ gh API acts as: second-account
  ✔ commits authored as: Second Account <12345+second-account@users.noreply.github.com>
  ✔ origin: https://github.com/second-account/household-shop.git
  ✔ HTTPS pushes use the gh token for second-account.
```

If a host credential helper is somehow still in play, it says so and tells you the fix
instead of letting you discover it after a push.

### Useful variants

```bash
npm run account -- --status                        # verify only, change nothing
npm run account -- --remote second-account/household-shop
                                                   # repoint origin at the other account
npm run account -- --ssh                           # create a container-only SSH key,
                                                   # upload it via gh, switch origin to SSH
npm run account -- --name "A Name" --email a@b.com # skip the prompts
```

Use `--ssh` if you want the strongest guarantee: `GIT_SSH_COMMAND` in `devcontainer.json`
pins git to `/home/node/.ssh/id_ed25519` with `IdentitiesOnly=yes`, so keys forwarded from
your host agent are ignored outright rather than merely deprioritised.

> Currently `origin` points at `shajil-t/household-shop` (your host account). If the second
> account should own the repository, either run `npm run account -- --remote <owner>/<repo>`
> against an existing repo, or create a fresh one from inside the container:
> `npm run deploy -- --create household-shop`.

---

## Push and deploy from inside

Exactly the same commands as on the host — they now act as the container's account:

```bash
npm run serve                      # http://localhost:4173 (port is auto-forwarded)
npm run sync                       # pull the Google Sheet into data/items.json
npm run deploy                     # Pages preflight, read-only
npm run deploy -- --push           # commit + push
npm run deploy -- --create <name>  # create the repo under this account, push, enable Pages
```

Then enable Pages once for that repository — **Settings ▸ Pages ▸ Deploy from a branch ▸
your branch ▸ `/ (root)`** — as described in [DEPLOYMENT.md](DEPLOYMENT.md).

The preflight's Git section is the quick sanity check before any push:

```
▶ Git
  ✔ On branch main — select this branch in Settings ▸ Pages.
  ✔ Origin: second-account/household-shop
```

---

## How the isolation actually works

Four independent measures, because any single one can be defeated by a stale setting:

1. **`.vscode/settings.json`** sets `dev.containers.copyGitConfig: false` and
   `dev.containers.gitCredentialHelperConfigLocation: "none"`, which stops VS Code copying
   your host `~/.gitconfig` in and injecting a helper that proxies to the host.
   *If VS Code marks these as machine-scoped, copy the two lines into your User settings.*
2. **`post-create.sh`** unsets `user.name`, `user.email`, `credential.helper` and
   `credential.https://github.com.helper` in the container's global config — so anything
   that slipped past step 1 is removed anyway.
3. **Named volumes** hold `~/.config/gh` and `~/.ssh`. The container never reads your host
   `~/.ssh` or keychain.
4. **`GIT_SSH_COMMAND`** with `IdentitiesOnly=yes` pins SSH to the container's own key, so a
   forwarded host agent cannot authenticate you.

And then `npm run account` **verifies the result** rather than trusting it — via
`git credential fill` for HTTPS remotes, or `ssh -T git@github.com` for SSH ones, comparing
the answer against the signed-in `gh` account.

Commit identity is set with `git config --local`, which lives in `.git/config`. That file is
in the bind-mounted working tree, so the identity applies to this repository whether you are
inside the container or on the host — worth knowing if you also work on it from outside.

---

## What persists, what does not

| | Survives a container rebuild? |
| --- | --- |
| `gh` login | ✅ volume `household-shop-gh` |
| SSH key | ✅ volume `household-shop-ssh` |
| `node_modules` | ✅ it lives in the bind-mounted workspace |
| Shell history, other installs | ❌ rebuild starts clean |

To wipe the container's identity completely:

```bash
docker volume rm household-shop-gh household-shop-ssh
```

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "Reopen in Container" never appears | The Dev Containers extension is not installed, or the folder was opened via a symlink. Use the Command Palette |
| Build fails with a Docker socket error | Docker Desktop is not running |
| `npm run account` says it does not look like a dev container | You are running it on the host. Only run it inside — it would rewrite your real git config otherwise |
| Verification reports a different account for HTTPS | A host credential helper survived. `git config --global --unset-all credential.helper && gh auth setup-git`, then `npm run account -- --status` |
| Verification reports a different account for SSH | A forwarded host key won. Use `npm run account -- --ssh`, and confirm `GIT_SSH_COMMAND` is set (`echo $GIT_SSH_COMMAND`) |
| `git@github.com: Permission denied (publickey)` | The container key is not on the account yet. `npm run account -- --ssh` uploads it, or paste `~/.ssh/id_ed25519.pub` into <https://github.com/settings/keys> |
| `gh ssh-key add` fails with a scope error | Run `gh auth refresh -h github.com -s admin:public_key`, then retry |
| Commits show the wrong author after all this | `git config user.email` inside the repo, then re-run `npm run account`. Already-made commits need `git commit --amend --reset-author` |
| `localhost:4173` does not open | Check the **Ports** panel; the container forwards 4173. Or run `npm run serve` and click the link in the terminal |
| Permission errors writing to `~/.ssh` | Rebuild the container so `post-create.sh` re-runs its `chown` (**Dev Containers: Rebuild Container**) |
