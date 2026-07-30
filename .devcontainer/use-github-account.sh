#!/usr/bin/env bash
#
# use-github-account.sh
# ---------------------------------------------------------------------------
# Signs this dev container in to a GitHub account, sets the commit identity for
# this repository only, and then *verifies* which account git and gh will
# actually act as — because "I thought I was signed in as the other account" is
# the failure mode this whole container exists to prevent.
#
# Usage (inside the dev container):
#   npm run account                       interactive
#   npm run account -- --ssh              also create/upload an SSH key and use it
#   npm run account -- --remote owner/repo
#                                         repoint origin at the new account's repo
#   npm run account -- --status           verify only, change nothing
#
# Everything it writes lives inside the container:
#   ~/.config/gh/hosts.yml   gh token          (named volume)
#   ~/.ssh/id_ed25519        optional SSH key  (named volume)
#   .git/config              commit identity + remote (repo-local, never global)

set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'

step() { printf '\n%s▶ %s%s\n' "$BOLD" "$1" "$RESET"; }
ok()   { printf '  %s✔%s %s\n' "$GREEN" "$RESET" "$1"; }
note() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
bad()  { printf '  %s✖%s %s\n' "$RED" "$RESET" "$1"; }
info() { printf '    %s\n' "$1"; }
cmd()  { printf '    %s%s%s\n' "$CYAN" "$1" "$RESET"; }

USE_SSH=false
STATUS_ONLY=false
NEW_REMOTE=''
GIT_NAME=''
GIT_EMAIL=''

while [ $# -gt 0 ]; do
  case "$1" in
    --ssh) USE_SSH=true ;;
    --status) STATUS_ONLY=true ;;
    --remote) NEW_REMOTE="${2:-}"; shift ;;
    --name) GIT_NAME="${2:-}"; shift ;;
    --email) GIT_EMAIL="${2:-}"; shift ;;
    -h|--help)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) bad "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

# A friendly guard: this script assumes the container's isolated HOME.
if [ ! -d /workspaces ] && [ "${REMOTE_CONTAINERS:-}" = '' ] && [ "${CODESPACES:-}" = '' ]; then
  note 'This does not look like a dev container.'
  info 'Running it on your host would change your real git config. Continue only if you meant to.'
  printf '    Continue? [y/N] '
  read -r reply
  case "$reply" in [yY]*) ;; *) exit 1 ;; esac
fi

# ---------------------------------------------------------------------------
# 1. Sign in to gh
# ---------------------------------------------------------------------------

if [ "$STATUS_ONLY" = false ]; then
  step 'GitHub CLI sign-in'

  if gh auth status >/dev/null 2>&1; then
    current="$(gh api user --jq .login 2>/dev/null || echo unknown)"
    ok "Already signed in as ${BOLD}${current}${RESET}."
    info 'To swap accounts: gh auth logout, then run this again.'
  else
    info 'A browser code flow starts now. Choose:'
    info '  • GitHub.com  • HTTPS  • authenticate with a web browser'
    info 'Sign in with the account you want THIS project pushed as.'
    printf '\n'
    gh auth login --hostname github.com --git-protocol https --web
    ok 'Signed in.'
  fi

  # Let gh answer git's credential prompts for github.com. Written to the
  # container's global config, which post-create.sh emptied of host helpers.
  gh auth setup-git --hostname github.com
  ok 'gh is now git'"'"'s credential helper for github.com.'
fi

GH_LOGIN="$(gh api user --jq .login 2>/dev/null || true)"
if [ -z "$GH_LOGIN" ]; then
  bad 'Not signed in to gh — cannot continue.'
  cmd 'gh auth login'
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Commit identity (repository-local on purpose)
# ---------------------------------------------------------------------------

if [ "$STATUS_ONLY" = false ]; then
  step 'Commit identity'

  if [ -z "$GIT_NAME" ]; then
    suggested="$(gh api user --jq '.name // .login')"
    printf '    Name for commits [%s]: ' "$suggested"
    read -r GIT_NAME
    GIT_NAME="${GIT_NAME:-$suggested}"
  fi

  if [ -z "$GIT_EMAIL" ]; then
    # The noreply address always belongs to the signed-in account and never
    # leaks a private address into a public repository.
    user_id="$(gh api user --jq .id)"
    suggested="${user_id}+${GH_LOGIN}@users.noreply.github.com"
    printf '    Email for commits [%s]: ' "$suggested"
    read -r GIT_EMAIL
    GIT_EMAIL="${GIT_EMAIL:-$suggested}"
  fi

  # --local keeps this to this repository: no chance of leaking into anything
  # else you happen to open in the container.
  git config --local user.name "$GIT_NAME"
  git config --local user.email "$GIT_EMAIL"
  ok "Commits from this repo will be authored by ${BOLD}${GIT_NAME} <${GIT_EMAIL}>${RESET}."
fi

# ---------------------------------------------------------------------------
# 3. Optional SSH key, created and kept inside the container
# ---------------------------------------------------------------------------

KEY="$HOME/.ssh/id_ed25519"

if [ "$USE_SSH" = true ] && [ "$STATUS_ONLY" = false ]; then
  step 'SSH key'

  if [ -f "$KEY" ]; then
    ok 'Container SSH key already exists.'
  else
    ssh-keygen -t ed25519 -N '' -C "devcontainer-${GH_LOGIN}-household-shop" -f "$KEY" >/dev/null
    ok "Created ${KEY} (never leaves this container's volume)."
  fi
  chmod 600 "$KEY"; chmod 644 "$KEY.pub"

  # Uploading needs a scope the default login does not request.
  if ! gh auth status 2>&1 | grep -q 'admin:public_key'; then
    info 'Requesting the admin:public_key scope so gh can upload the key…'
    gh auth refresh -h github.com -s admin:public_key || true
  fi

  if gh ssh-key add "$KEY.pub" --title "devcontainer household-shop" 2>/dev/null; then
    ok "Public key added to ${BOLD}${GH_LOGIN}${RESET}."
  else
    note 'Could not upload the key automatically (it may already be there).'
    info 'Add this to https://github.com/settings/keys if pushing fails:'
    printf '\n'
    cat "$KEY.pub" | sed 's/^/    /'
  fi

  ssh-keyscan -t ed25519 github.com >>"$HOME/.ssh/known_hosts" 2>/dev/null || true
  sort -u "$HOME/.ssh/known_hosts" -o "$HOME/.ssh/known_hosts" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 4. Remote
# ---------------------------------------------------------------------------

if [ -n "$NEW_REMOTE" ] && [ "$STATUS_ONLY" = false ]; then
  step 'Remote'

  if [ "$USE_SSH" = true ]; then
    url="git@github.com:${NEW_REMOTE}.git"
  else
    url="https://github.com/${NEW_REMOTE}.git"
  fi

  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$url"
  else
    git remote add origin "$url"
  fi
  ok "origin → ${url}"
elif [ "$USE_SSH" = true ] && [ "$STATUS_ONLY" = false ]; then
  # Convert an existing HTTPS remote to SSH so the container key is used.
  existing="$(git remote get-url origin 2>/dev/null || true)"
  case "$existing" in
    https://github.com/*)
      slug="${existing#https://github.com/}"; slug="${slug%.git}"
      git remote set-url origin "git@github.com:${slug}.git"
      step 'Remote'
      ok "origin switched to SSH → git@github.com:${slug}.git"
      ;;
  esac
fi

# ---------------------------------------------------------------------------
# 5. Verify — the part that matters
# ---------------------------------------------------------------------------

step 'Verification'

ok "gh API acts as: ${BOLD}${GH_LOGIN}${RESET}"

commit_name="$(git config user.name || echo '(unset)')"
commit_email="$(git config user.email || echo '(unset)')"
ok "commits authored as: ${BOLD}${commit_name} <${commit_email}>${RESET}"

remote_url="$(git remote get-url origin 2>/dev/null || echo '(no origin)')"
ok "origin: ${remote_url}"

case "$remote_url" in
  git@github.com:*|ssh://git@github.com/*)
    # `ssh -T git@github.com` exits 1 even on success, and prints the account.
    ssh_out="$(ssh -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 || true)"
    ssh_user="$(printf '%s' "$ssh_out" | sed -n 's/^Hi \([^!]*\)!.*/\1/p')"
    if [ -n "$ssh_user" ]; then
      if [ "$ssh_user" = "$GH_LOGIN" ]; then
        ok "SSH pushes as: ${BOLD}${ssh_user}${RESET} — matches the signed-in account."
      else
        bad "SSH pushes as ${BOLD}${ssh_user}${RESET}, but gh is ${BOLD}${GH_LOGIN}${RESET}."
        info 'A forwarded host key is winning. Check GIT_SSH_COMMAND in devcontainer.json.'
      fi
    else
      note 'Could not confirm the SSH identity.'
      info "$ssh_out"
    fi
    ;;
  https://github.com/*)
    # Ask git which username it would actually send for a push. This is the
    # only reliable way to catch a host credential helper still being in play.
    probe="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null || true)"
    probe_user="$(printf '%s' "$probe" | sed -n 's/^username=//p')"
    if [ -z "$probe_user" ]; then
      note 'git could not resolve a credential for github.com yet.'
      info 'Run: gh auth setup-git   (then re-run this script with --status)'
    elif [ "$probe_user" = "$GH_LOGIN" ] || [ "$probe_user" = 'x-access-token' ] || [ "$probe_user" = 'oauth2' ]; then
      ok "HTTPS pushes use the gh token for ${BOLD}${GH_LOGIN}${RESET}."
    else
      bad "HTTPS pushes would authenticate as ${BOLD}${probe_user}${RESET}, not ${BOLD}${GH_LOGIN}${RESET}."
      info 'That is a leftover host credential helper. Fix it with:'
      cmd 'git config --global --unset-all credential.helper && gh auth setup-git'
      info 'and set dev.containers.gitCredentialHelperConfigLocation to "none" in VS Code.'
    fi
    ;;
esac

step 'Next'
info 'Publish from inside the container:'
cmd 'npm run deploy               # preflight, changes nothing'
cmd 'npm run deploy -- --push     # commit + push as the account above'
printf '\n'
info 'Starting a brand new repository under this account instead:'
cmd 'npm run deploy -- --create household-shop'
printf '\n'
