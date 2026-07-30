#!/usr/bin/env node
/**
 * deploy.js
 * ---------------------------------------------------------------------------
 * Publishing helper for GitHub Pages.
 *
 * By default it changes nothing: it runs a preflight check over the repository
 * and prints exactly which commands to run next. Pushing and repository
 * creation are opt-in, because both are hard to undo.
 *
 * Usage:
 *   npm run deploy            Preflight check + printed instructions (safe)
 *   npm run deploy -- --push  Commit and push to the existing origin
 *   npm run deploy -- --create <name>
 *                             Create the GitHub repo with the gh CLI, push,
 *                             and enable Pages
 *
 * Full walkthrough: docs/DEPLOYMENT.md
 */

import { execFile } from 'node:child_process';
import { readFile, readdir, access, writeFile, rm } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* -------------------------------------------------------------------------- */
/* Output helpers                                                             */
/* -------------------------------------------------------------------------- */

const log = {
  title: (msg) => console.log(`\n\x1b[1m${msg}\x1b[0m`),
  ok: (msg) => console.log(`  \x1b[32m✔\x1b[0m ${msg}`),
  warn: (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`),
  fail: (msg) => console.log(`  \x1b[31m✖\x1b[0m ${msg}`),
  info: (msg) => console.log(`    ${msg}`),
  plain: (msg = '') => console.log(msg),
  cmd: (msg) => console.log(`    \x1b[36m${msg}\x1b[0m`),
};

/** Collected results, so the summary can count problems. */
const findings = { blockers: [], warnings: [] };

const blocker = (message, hint) => {
  log.fail(message);
  if (hint) log.info(hint);
  findings.blockers.push(message);
};

const warning = (message, hint) => {
  log.warn(message);
  if (hint) log.info(hint);
  findings.warnings.push(message);
};

/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Runs a command, returning trimmed stdout, or null when it fails.
 * @param {string} file
 * @param {string[]} args
 */
async function tryRun(file, args) {
  try {
    const { stdout } = await run(file, args, { cwd: ROOT });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Runs a command, streaming failures as an error. */
async function mustRun(file, args) {
  log.cmd(`${file} ${args.join(' ')}`);
  const { stdout, stderr } = await run(file, args, { cwd: ROOT });
  const output = `${stdout}${stderr}`.trim();
  if (output) log.info(output.split('\n').join('\n    '));
  return output;
}

const exists = async (relativePath) => {
  try {
    await access(path.join(ROOT, relativePath), FS.R_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Turns a git remote URL into `{ owner, repo }`.
 * Handles both `git@github.com:owner/repo.git` and HTTPS forms.
 */
function parseRemote(url) {
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url ?? '');
  return match ? { owner: match[1], repo: match[2] } : null;
}

/** The public URL a project site will be served from. */
const pagesUrl = ({ owner, repo }) =>
  repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? `https://${repo}/`
    : `https://${owner}.github.io/${repo}/`;

/* -------------------------------------------------------------------------- */
/* Preflight checks                                                           */
/* -------------------------------------------------------------------------- */

/** Node version against the pinned .nvmrc, so CI surprises surface early. */
async function checkToolchain() {
  log.title('Toolchain');

  const current = process.versions.node;
  log.ok(`Node ${current}.`);

  if (!(await exists('.nvmrc'))) {
    warning('.nvmrc is missing — CI reads it via node-version-file and would fail.');
    return;
  }

  const pinned = (await readFile(path.join(ROOT, '.nvmrc'), 'utf8')).trim().replace(/^v/, '');
  const sameMajor = current.split('.')[0] === pinned.split('.')[0];

  if (sameMajor) log.ok(`Matches .nvmrc (${pinned}).`);
  else warning(`.nvmrc pins Node ${pinned}, but this shell runs ${current}.`, 'Run: nvm use');
}

/** Git availability, repository state, branch and remote. */
async function checkGit() {
  log.title('Git');

  if (!(await tryRun('git', ['--version']))) {
    blocker('git is not installed.', 'Install it from https://git-scm.com/downloads');
    return {};
  }

  const insideRepo = (await tryRun('git', ['rev-parse', '--is-inside-work-tree'])) === 'true';
  if (!insideRepo) {
    blocker('This folder is not a git repository yet.', 'Fix it with the commands printed below.');
    return {};
  }
  log.ok('Inside a git repository.');

  const branch = await tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'main' || branch === 'master') {
    // Pages happily publishes either; the branch just has to match the setting.
    log.ok(`On branch ${branch} — select this branch in Settings ▸ Pages.`);
  } else if (branch) {
    warning(
      `The current branch is "${branch}".`,
      'Pages must be pointed at this exact branch, or publish from main/master instead.'
    );
  }

  const remoteUrl = await tryRun('git', ['remote', 'get-url', 'origin']);
  const remote = parseRemote(remoteUrl);

  if (!remoteUrl) {
    warning('No "origin" remote is configured yet.', 'Add one, or use --create to let gh do it.');
  } else if (!remote) {
    warning(`The origin remote is not a GitHub URL: ${remoteUrl}`);
  } else {
    log.ok(`Origin: ${remote.owner}/${remote.repo}`);
  }

  const status = await tryRun('git', ['status', '--porcelain']);
  const pending = status ? status.split('\n').filter(Boolean).length : 0;
  if (pending) log.ok(`${pending} file(s) to commit.`);
  else log.ok('Working tree is clean.');

  return { branch, remote, pending };
}

/** Configuration values that must not be shipped with placeholders. */
async function checkConfig() {
  log.title('Configuration');

  const config = await readFile(path.join(ROOT, 'js/config.js'), 'utf8');

  const number = /whatsappNumber:\s*'([^']*)'/.exec(config)?.[1] ?? '';
  if (!number) {
    warning('js/config.js: whatsappNumber is empty — contact and offer buttons stay hidden.');
  } else if (number === '27820000000') {
    warning('js/config.js: whatsappNumber is still the placeholder (27820000000).');
  } else {
    log.ok(`WhatsApp number set (${number}).`);
  }

  const siteName = /siteName:\s*'([^']*)'/.exec(config)?.[1] ?? '';
  log.ok(`Site name: "${siteName}".`);

  const sheet = JSON.parse(await readFile(path.join(ROOT, 'scripts/sheet.config.json'), 'utf8'));
  if (!sheet.csvUrl && (!sheet.sheetId || sheet.sheetId.startsWith('REPLACE_WITH'))) {
    warning(
      'scripts/sheet.config.json: no sheet configured.',
      'The site still works from the committed data/items.json, but the hourly sync will fail.'
    );
  } else {
    log.ok('Google Sheet configured for the sync workflow.');
  }
}

/** Catalogue data and the images it points at. */
async function checkContent() {
  log.title('Content');

  if (!(await exists('data/items.json'))) {
    blocker('data/items.json is missing.', 'Run: npm run sync');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readFile(path.join(ROOT, 'data/items.json'), 'utf8'));
  } catch (error) {
    blocker(`data/items.json is not valid JSON: ${error.message}`);
    return;
  }

  const items = Array.isArray(payload) ? payload : (payload.items ?? []);
  if (!items.length) {
    warning('The catalogue is empty — the site will show the "Nothing listed yet" panel.');
  } else {
    log.ok(`${items.length} item(s) in the catalogue.`);
  }

  const missing = [];
  for (const item of items) {
    for (const image of item.images ?? []) {
      if (!(await exists(image))) missing.push(`${item.id} → ${image}`);
    }
  }
  if (missing.length) {
    warning(`${missing.length} referenced image(s) are not committed:`);
    missing.slice(0, 10).forEach((entry) => log.info(`• ${entry}`));
    if (missing.length > 10) log.info(`…and ${missing.length - 10} more.`);
  } else {
    log.ok('Every referenced image is present.');
  }
}

/** Static-hosting gotchas that only bite once the site is live. */
async function checkHosting() {
  log.title('Hosting readiness');

  if (await exists('.nojekyll')) log.ok('.nojekyll present (Pages serves files verbatim).');
  else warning('.nojekyll is missing.', 'Create it with: touch .nojekyll');

  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const absolute = [...html.matchAll(/(?:href|src)="\/(?!\/)([^"]*)"/g)].map((m) => `/${m[1]}`);
  if (absolute.length) {
    blocker(
      `index.html uses ${absolute.length} root-absolute path(s), which 404 on a project site.`,
      `Make them relative: ${absolute.slice(0, 3).join(', ')}`
    );
  } else {
    log.ok('All asset paths are relative (works under /<repo>/).');
  }

  // GitHub Pages URLs are case-sensitive and spaces need escaping — both are
  // easy to get wrong when photos come off a phone.
  const awkward = [];
  const walk = async (dir) => {
    for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
      const relative = path.join(dir, entry.name);
      if (/[\s#?%]/.test(entry.name)) awkward.push(relative);
      if (entry.isDirectory()) await walk(relative);
    }
  };
  await walk('images');

  if (awkward.length) {
    warning(`${awkward.length} image path(s) contain spaces or URL-unsafe characters:`);
    awkward.slice(0, 10).forEach((entry) => log.info(`• ${entry}`));
    log.info('Rename them to lowercase-with-dashes to avoid broken links.');
  } else {
    log.ok('Image filenames are URL-safe.');
  }
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

/** Stages everything, commits if needed, and pushes to origin. */
async function pushToOrigin(context) {
  log.title('Pushing to origin');

  if (findings.blockers.length) {
    log.fail('Refusing to push while there are blockers above.');
    process.exitCode = 1;
    return;
  }

  if (!context.remote) {
    log.fail('No GitHub "origin" remote to push to.');
    log.info('Add one, or create the repository with: npm run deploy -- --create <repo-name>');
    process.exitCode = 1;
    return;
  }

  const branch = context.branch || 'main';

  if (context.pending) {
    await mustRun('git', ['add', '-A']);
    await mustRun('git', ['commit', '-m', 'chore: publish catalogue site']);
  } else {
    log.ok('Nothing new to commit.');
  }

  await mustRun('git', ['push', '-u', 'origin', branch]);

  log.plain();
  log.ok('Pushed.');
  if (context.remote) log.info(`The site will be live at ${pagesUrl(context.remote)}`);
  log.info(`First time? Enable Pages: Settings ▸ Pages ▸ Deploy from a branch ▸ ${branch} ▸ / (root)`);
}

/**
 * Creates the GitHub repository with the gh CLI, pushes, and turns Pages on.
 * @param {string} name  repository name, optionally `owner/name`
 */
async function createRepository(name) {
  log.title('Creating the GitHub repository');

  if (findings.blockers.length) {
    log.fail('Refusing to create a repository while there are blockers above.');
    process.exitCode = 1;
    return;
  }

  if (!(await tryRun('gh', ['--version']))) {
    log.fail('The GitHub CLI (gh) is not installed.');
    log.info('Install it from https://cli.github.com/, or follow docs/DEPLOYMENT.md by hand.');
    process.exitCode = 1;
    return;
  }

  if (!(await tryRun('gh', ['auth', 'status']))) {
    log.fail('gh is not signed in.');
    log.cmd('gh auth login');
    process.exitCode = 1;
    return;
  }

  if (!(await tryRun('git', ['rev-parse', '--is-inside-work-tree']))) {
    await mustRun('git', ['init']);
    await mustRun('git', ['branch', '-M', 'main']);
  }

  await mustRun('git', ['add', '-A']);
  // An empty commit attempt is harmless here; ignore its failure.
  await tryRun('git', ['commit', '-m', 'feat: household catalogue site']);

  await mustRun('gh', [
    'repo',
    'create',
    name,
    '--public',
    '--source=.',
    '--remote=origin',
    '--push',
  ]);

  const remote = parseRemote(await tryRun('git', ['remote', 'get-url', 'origin']));
  if (!remote) {
    log.warn('Repository created, but the origin remote could not be read back.');
    return;
  }

  log.title('Enabling GitHub Pages');
  const publishBranch = (await tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD'])) || 'main';
  const enabled = await enablePages(remote, publishBranch);

  if (!enabled) {
    log.warn('Could not enable Pages automatically (it may already be on).');
    log.info(
      `Turn it on once by hand: Settings ▸ Pages ▸ Deploy from a branch ▸ ${publishBranch} ▸ / (root)`
    );
  } else {
    log.ok(`Pages enabled for branch ${publishBranch}, folder / (root).`);
  }

  log.plain();
  log.ok(`Done. The site will be live at ${pagesUrl(remote)} in a minute or two.`);
}

/**
 * Turns Pages on for a repository through the REST API.
 * The payload is nested, so it goes via a temp file rather than repeated -f
 * flags (which gh only accepts for flat keys).
 *
 * @param {{owner: string, repo: string}} remote
 * @returns {Promise<boolean>} whether the call succeeded
 */
async function enablePages(remote, branch = 'main') {
  const payloadFile = path.join(os.tmpdir(), `pages-${process.pid}.json`);

  try {
    await writeFile(payloadFile, JSON.stringify({ source: { branch, path: '/' } }), 'utf8');
    const result = await tryRun('gh', [
      'api',
      '--method',
      'POST',
      `repos/${remote.owner}/${remote.repo}/pages`,
      '--input',
      payloadFile,
      '--silent',
    ]);
    return result !== null;
  } finally {
    await rm(payloadFile, { force: true });
  }
}

/** Prints the manual command sequence for the current repository state. */
function printInstructions(context) {
  log.title('Next steps');

  if (!context.remote) {
    log.info('1. Create an empty repository on github.com (no README, no .gitignore).');
    log.info('2. Then run, replacing <you>/<repo>:');
    log.plain();
    log.cmd('git init');
    log.cmd('git add -A');
    log.cmd('git commit -m "feat: household catalogue site"');
    log.cmd('git branch -M main');
    log.cmd('git remote add origin https://github.com/<you>/<repo>.git');
    log.cmd('git push -u origin main');
    log.plain();
    log.info('Or let the GitHub CLI do all of it:');
    log.cmd('npm run deploy -- --create <repo-name>');
  } else {
    log.info('Publish the current state:');
    log.plain();
    log.cmd('npm run deploy -- --push');
    log.plain();
    log.info(`Then open ${pagesUrl(context.remote)}`);
  }

  log.plain();
  const publishBranch = context.branch || 'main';
  log.info(
    `Enable Pages once: Settings ▸ Pages ▸ Source "Deploy from a branch" ▸ ${publishBranch} ▸ / (root)`
  );
  log.info('Full walkthrough with screenshots-worth-of-detail: docs/DEPLOYMENT.md');
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

async function main() {
  const args = process.argv.slice(2);
  const wantsPush = args.includes('--push');
  const createIndex = args.indexOf('--create');
  const repoName = createIndex === -1 ? null : args[createIndex + 1];

  if (createIndex !== -1 && !repoName) {
    log.fail('--create needs a repository name, e.g. --create household-shop');
    process.exitCode = 1;
    return;
  }

  console.log('\x1b[1m🚀 GitHub Pages preflight\x1b[0m');

  await checkToolchain();
  const context = await checkGit();
  await checkConfig();
  await checkContent();
  await checkHosting();

  log.title('Summary');
  if (findings.blockers.length) log.fail(`${findings.blockers.length} blocker(s).`);
  if (findings.warnings.length) log.warn(`${findings.warnings.length} warning(s) — safe to publish, but worth a look.`);
  if (!findings.blockers.length && !findings.warnings.length) log.ok('Everything looks ready to publish.');

  if (repoName) await createRepository(repoName);
  else if (wantsPush) await pushToOrigin(context);
  else printInstructions(context);

  console.log();
}

main().catch((error) => {
  log.plain();
  log.fail(error.message);
  if (process.env.DEBUG) console.error(error);
  process.exitCode = 1;
});
