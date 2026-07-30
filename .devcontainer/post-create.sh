#!/usr/bin/env bash
#
# post-create.sh
# ---------------------------------------------------------------------------
# Runs once, the first time the dev container is created (and after a rebuild).
#
#   • fixes ownership on the credential volumes
#   • removes any git identity or credential helper inherited from the host
#   • installs dependencies
#   • prints what to do next
#
# It never signs you in: that is `npm run account`, which is interactive.

set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'

step() { printf '\n%s▶ %s%s\n' "$BOLD" "$1" "$RESET"; }
ok()   { printf '  %s✔%s %s\n' "$GREEN" "$RESET" "$1"; }
note() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }

# Hard guard. This script clears global git settings, which is correct inside a
# throwaway container and destructive on a real machine. Refuse rather than ask:
# it runs unattended, so there is nobody to answer a prompt.
if [ ! -f /.dockerenv ] && [ -z "${REMOTE_CONTAINERS:-}" ] && [ -z "${CODESPACES:-}" ]; then
  printf '%s✖%s Refusing to run outside a container.\n' "$RED" "$RESET"
  printf '    This script unsets global git identity and credential helpers.\n'
  printf '    It is meant to be run by the dev container, not by hand.\n'
  exit 1
fi

step 'Preparing credential volumes'

# Docker creates named-volume mount points as root; the node user needs them.
for dir in "$HOME/.ssh" "$HOME/.config/gh"; do
  sudo mkdir -p "$dir"
  sudo chown -R "$(id -u):$(id -g)" "$dir"
done
chmod 700 "$HOME/.ssh"
ok "~/.ssh and ~/.config/gh are writable and container-only."

step 'Clearing any inherited git identity'

# VS Code copies the host ~/.gitconfig into the container and injects a
# credential helper that talks back to the host. Both would make you commit and
# push as the *host* account, which is exactly what this container avoids.
# See docs/DEVCONTAINER.md for the two VS Code settings that stop the copy at
# source; this is the belt to that braces.
git config --global --unset-all user.name 2>/dev/null || true
git config --global --unset-all user.email 2>/dev/null || true
git config --global --unset-all credential.helper 2>/dev/null || true
git config --global --unset-all credential.https://github.com.helper 2>/dev/null || true

# Safe defaults for a bind-mounted workspace owned by a different host UID.
git config --global --add safe.directory "$PWD"
git config --global init.defaultBranch main
git config --global pull.rebase true
ok 'No host identity or credential helper is configured in here.'

step 'Installing dependencies'
npm install --no-audit --no-fund
ok 'Dependencies installed.'

step 'Ready'
cat <<BANNER
  ${BOLD}One-time setup for your second GitHub account:${RESET}

    ${BOLD}npm run account${RESET}      ${DIM}sign in with gh, set the commit identity, verify it${RESET}

  Then the usual commands:

    ${BOLD}npm run serve${RESET}        ${DIM}http://localhost:4173${RESET}
    ${BOLD}npm run sync${RESET}         ${DIM}pull the Google Sheet into data/items.json${RESET}
    ${BOLD}npm run deploy${RESET}       ${DIM}GitHub Pages preflight (read-only)${RESET}

  Guide: ${BOLD}docs/DEVCONTAINER.md${RESET}
BANNER
