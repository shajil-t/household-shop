#!/usr/bin/env node
/**
 * sheet-to-json.js
 * ---------------------------------------------------------------------------
 * Downloads the Google Sheet that acts as the CMS for this catalogue, parses
 * the CSV export, normalises every row and writes `data/items.json`.
 *
 * Usage:
 *   npm run sync
 *
 * Configuration (highest precedence first):
 *   1. Environment variables  SHEET_CSV_URL | SHEET_ID + SHEET_GID
 *   2. scripts/sheet.config.json
 *
 * The sheet must be shared as "Anyone with the link -> Viewer" (or published
 * to the web) so that the CSV endpoint is readable without credentials.
 *
 * Expected columns (header row, case/spacing insensitive):
 *   id | title | price | description | status | category | condition |
 *   location | images        (optional: date_added, featured)
 *
 * Photos can be listed either as `images` ("1.jpg, 2.jpg") or as an
 * `imageFolder` + `imageCount` pair pointing at images/<folder>/<n>.<ext>.
 */

import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(__dirname, 'sheet.config.json');

const REQUEST_TIMEOUT_MS = 30_000;
const VALID_STATUSES = new Set(['available', 'reserved', 'sold']);

/** Canonical field name for every header spelling we are willing to accept. */
const HEADER_ALIASES = {
  id: 'id',
  title: 'title',
  name: 'title',
  price: 'price',
  description: 'description',
  desc: 'description',
  status: 'status',
  category: 'category',
  condition: 'condition',
  location: 'location',
  images: 'images',
  image: 'images',
  photos: 'images',
  imagefolder: 'imageFolder',
  folder: 'imageFolder',
  imagecount: 'imageCount',
  dateadded: 'dateAdded',
  date: 'dateAdded',
  added: 'dateAdded',
  featured: 'featured',
};

/* -------------------------------------------------------------------------- */
/* Logging helpers                                                            */
/* -------------------------------------------------------------------------- */

const log = {
  info: (msg) => console.log(`  ${msg}`),
  step: (msg) => console.log(`\n▶ ${msg}`),
  ok: (msg) => console.log(`✅ ${msg}`),
  warn: (msg) => console.warn(`⚠️  ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
};

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Loads sheet.config.json, tolerating a missing file so that the script can
 * run purely from environment variables (as it does in CI).
 * @returns {Promise<Record<string, string>>}
 */
async function loadFileConfig() {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      log.warn(`No ${path.relative(ROOT, CONFIG_FILE)} found — relying on environment variables.`);
      return {};
    }
    throw new Error(`Could not read ${CONFIG_FILE}: ${error.message}`);
  }
}

/**
 * Resolves the effective configuration and the CSV URL to download.
 * @returns {Promise<{csvUrl: string, outputFile: string, imagesDir: string}>}
 */
async function resolveConfig() {
  const file = await loadFileConfig();

  const csvUrl = (process.env.SHEET_CSV_URL || file.csvUrl || '').trim();
  const sheetId = (process.env.SHEET_ID || file.sheetId || '').trim();
  const gid = (process.env.SHEET_GID || file.gid || '0').trim();

  const outputFile = path.resolve(ROOT, file.outputFile || 'data/items.json');
  const imagesDir = (file.imagesDir || 'images').replace(/\/+$/, '');

  if (csvUrl) {
    return { csvUrl, outputFile, imagesDir };
  }

  if (!sheetId || sheetId.startsWith('REPLACE_WITH')) {
    throw new Error(
      'Google Sheet is not configured.\n' +
        '  Set "sheetId" in scripts/sheet.config.json, or export SHEET_ID / SHEET_CSV_URL.\n' +
        '  The sheet id is the long token in the sheet URL:\n' +
        '  https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit#gid=<GID>'
    );
  }

  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
    sheetId
  )}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;

  return { csvUrl: url, outputFile, imagesDir };
}

/* -------------------------------------------------------------------------- */
/* Download                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Downloads the sheet as CSV text.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function downloadCsv(url) {
  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'household-shop-sync/1.0' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? `timed out after ${REQUEST_TIMEOUT_MS} ms` : error.message;
    throw new Error(`Network request to Google Sheets failed: ${reason}`);
  }

  if (!response.ok) {
    const hint =
      response.status === 404 || response.status === 400
        ? ' Check the sheet id and gid.'
        : response.status === 401 || response.status === 403
          ? ' Share the sheet as "Anyone with the link -> Viewer".'
          : '';
    throw new Error(`Google Sheets responded ${response.status} ${response.statusText}.${hint}`);
  }

  const text = await response.text();

  // A sign-in redirect returns HTML rather than CSV — fail loudly instead of
  // silently writing an empty catalogue.
  if (/^\s*</.test(text)) {
    throw new Error(
      'Google Sheets returned HTML instead of CSV. The sheet is most likely private — ' +
        'share it as "Anyone with the link -> Viewer".'
    );
  }

  if (!text.trim()) {
    throw new Error('Google Sheets returned an empty document.');
  }

  return text;
}

/* -------------------------------------------------------------------------- */
/* CSV parsing                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Minimal RFC 4180 CSV parser: handles quoted fields, escaped quotes (""),
 * embedded commas and newlines, and both LF and CRLF line endings.
 * @param {string} text
 * @returns {string[][]} rows of raw cell strings
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  // Strip a UTF-8 BOM so the first header does not become "﻿id".
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      if (input[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += char;
    }
  }

  // Flush the trailing field/row unless the file ended with a newline.
  if (field !== '' || row.length > 0) endRow();

  // Drop completely blank lines.
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

/**
 * Turns raw CSV rows into objects keyed by canonical field names.
 * @param {string[][]} rows
 * @returns {Array<Record<string, string>>}
 */
function rowsToRecords(rows) {
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) throw new Error('The sheet has no header row.');

  const headers = headerRow.map((header) => {
    const key = header.trim().toLowerCase().replace(/[\s_-]+/g, '');
    return HEADER_ALIASES[key] || null;
  });

  const recognised = headers.filter(Boolean);
  if (!recognised.includes('id') || !recognised.includes('title')) {
    throw new Error(
      `The sheet must contain at least "id" and "title" columns. Found: ${headerRow.join(', ') || '(none)'}`
    );
  }

  const unknown = headerRow.filter((header, index) => header.trim() && !headers[index]);
  if (unknown.length) log.warn(`Ignoring unrecognised column(s): ${unknown.join(', ')}`);

  return dataRows.map((cells) => {
    const record = {};
    headers.forEach((field, index) => {
      if (field) record[field] = (cells[index] ?? '').trim();
    });
    return record;
  });
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Parses a price cell such as "R6 000,00", "6000" or "6,000.50".
 * @param {string} raw
 * @returns {number|null} null when the cell is empty or unparseable
 */
function parsePrice(raw) {
  if (!raw) return null;

  let cleaned = raw.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > lastDot) {
    // Comma is the decimal separator (e.g. "6 000,50").
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Dot is the decimal separator, commas are thousand separators.
    cleaned = cleaned.replace(/,/g, '');
  }

  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

/** Default extension used when a folder's files are not on disk yet. */
const DEFAULT_IMAGE_EXT = 'jpeg';

/** Sorts "1.jpeg, 2.jpeg, 10.jpeg" numerically rather than lexicographically. */
function byLeadingNumber(a, b) {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
  return na - nb;
}

/**
 * Lists the image files that are actually committed, keyed by folder name, so
 * that folder-based rows can pick up the real filenames/extensions.
 * @param {string} imagesDir
 * @returns {Promise<Map<string, string[]>>}
 */
async function scanImageFolders(imagesDir) {
  const root = path.resolve(ROOT, imagesDir);
  const folders = new Map();

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return folders;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const files = (await readdir(path.join(root, entry.name)))
          .filter((file) => !file.startsWith('.'))
          .sort(byLeadingNumber);
        folders.set(entry.name, files);
      })
  );

  return folders;
}

/**
 * Resolves an item's image paths. Two sheet layouts are supported:
 *   1. `images`      — an explicit list ("1.jpg, 2.jpg" or a full path)
 *   2. `imageFolder` + `imageCount` — a folder of numbered photos
 * Folder rows prefer the filenames found on disk (so extensions are correct)
 * and fall back to synthesised "<n>.jpeg" names when nothing is committed yet.
 * @param {Record<string, string>} record
 * @param {string} id
 * @param {string} imagesDir
 * @param {Map<string, string[]>} folders
 * @returns {string[]}
 */
function buildImagePaths(record, id, imagesDir, folders) {
  const raw = record.images;

  if (raw) {
    return raw
      .split(',')
      .map((name) => name.trim().replace(/^\/+/, ''))
      .filter(Boolean)
      // Allow a full path in the sheet as an escape hatch for shared images.
      .map((name) => (name.includes('/') ? name : `${imagesDir}/${id}/${name}`));
  }

  const folder = (record.imageFolder || '').trim().replace(/^\/+|\/+$/g, '') || (folders.has(id) ? id : '');
  if (!folder) return [];

  const count = Number.parseInt(record.imageCount || '', 10);
  const onDisk = folders.get(folder);

  if (onDisk?.length) {
    const files = Number.isFinite(count) && count > 0 ? onDisk.slice(0, count) : onDisk;
    if (Number.isFinite(count) && count > onDisk.length) {
      log.warn(`Row "${id}": imageCount is ${count} but only ${onDisk.length} file(s) exist in ${imagesDir}/${folder}.`);
    }
    return files.map((file) => `${imagesDir}/${folder}/${file}`);
  }

  if (!Number.isFinite(count) || count <= 0) {
    log.warn(`Row "${id}": folder "${folder}" is empty/missing and no usable imageCount was given.`);
    return [];
  }

  return Array.from({ length: count }, (_, i) => `${imagesDir}/${folder}/${i + 1}.${DEFAULT_IMAGE_EXT}`);
}

/** Normalises the status cell, defaulting to "available". */
function normaliseStatus(raw, id) {
  const status = (raw || 'available').toLowerCase().trim();
  if (VALID_STATUSES.has(status)) return status;

  log.warn(`Row "${id}": unknown status "${raw}" — treating it as "available".`);
  return 'available';
}

/** Converts an id into a safe folder/slug value. */
function normaliseId(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Maps a raw sheet record onto the item shape consumed by the front end.
 * Returns null when the row is unusable.
 * @param {Record<string, string>} record
 * @param {number} rowNumber 1-based sheet row (including the header)
 * @param {string} imagesDir
 * @param {Map<string, string[]>} folders
 */
function toItem(record, rowNumber, imagesDir, folders) {
  const id = normaliseId(record.id || '');
  const title = (record.title || '').trim();

  if (!id) {
    log.warn(`Sheet row ${rowNumber}: skipped — the "id" column is empty.`);
    return null;
  }
  if (!title) {
    log.warn(`Sheet row ${rowNumber} ("${id}"): skipped — the "title" column is empty.`);
    return null;
  }

  return {
    id,
    title,
    price: parsePrice(record.price),
    description: (record.description || '').trim(),
    status: normaliseStatus(record.status, id),
    category: (record.category || 'Other').trim() || 'Other',
    condition: (record.condition || '').trim(),
    location: (record.location || '').trim(),
    images: buildImagePaths(record, id, imagesDir, folders),
    dateAdded: (record.dateAdded || '').trim() || null,
    featured: /^(true|yes|y|1)$/i.test(record.featured || ''),
    /** Sheet order; the front end uses it as the "newest" tie-breaker. */
    order: rowNumber,
  };
}

/**
 * Drops duplicate ids (last one wins would silently hide edits, so we keep the
 * first occurrence and warn about the rest).
 * @param {Array<object>} items
 */
function dedupeById(items) {
  const seen = new Map();
  for (const item of items) {
    if (seen.has(item.id)) {
      log.warn(`Duplicate id "${item.id}" (sheet row ${item.order}) — keeping the first occurrence.`);
      continue;
    }
    seen.set(item.id, item);
  }
  return [...seen.values()];
}

/**
 * Reports images referenced in the sheet that are not committed to the repo.
 * Purely informational — missing files fall back to the placeholder at runtime.
 * @param {Array<object>} items
 */
async function reportMissingImages(items) {
  const missing = [];

  await Promise.all(
    items.flatMap((item) =>
      item.images.map(async (relativePath) => {
        try {
          await access(path.resolve(ROOT, relativePath), FS.R_OK);
        } catch {
          missing.push(relativePath);
        }
      })
    )
  );

  const withoutImages = items.filter((item) => item.images.length === 0);
  if (withoutImages.length) {
    log.warn(`${withoutImages.length} item(s) have no images: ${withoutImages.map((i) => i.id).join(', ')}`);
  }
  if (missing.length) {
    log.warn(`${missing.length} referenced image file(s) are not in the repo yet:`);
    missing.sort().forEach((file) => log.info(`• ${file}`));
  }
}

/* -------------------------------------------------------------------------- */
/* Output                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Writes the catalogue file, skipping the write when only the timestamp would
 * change so that CI does not create noisy empty commits.
 * @param {string} outputFile
 * @param {Array<object>} items
 * @returns {Promise<boolean>} true when the file changed on disk
 */
async function writeItems(outputFile, items) {
  const payload = {
    generatedAt: new Date().toISOString(),
    count: items.length,
    items,
  };

  const nextJson = `${JSON.stringify(payload, null, 2)}\n`;

  try {
    const previous = JSON.parse(await readFile(outputFile, 'utf8'));
    if (JSON.stringify(previous.items ?? previous) === JSON.stringify(items)) {
      log.info('Catalogue is unchanged — leaving the existing file untouched.');
      return false;
    }
  } catch {
    // No readable previous file: fall through and write a fresh one.
  }

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, nextJson, 'utf8');
  return true;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log('🛠  Syncing Google Sheet → data/items.json');

  const { csvUrl, outputFile, imagesDir } = await resolveConfig();

  log.step('Downloading sheet');
  log.info(csvUrl.replace(/([?&](?:key|token)=)[^&]+/gi, '$1***'));
  const csv = await downloadCsv(csvUrl);
  log.ok(`Downloaded ${csv.length.toLocaleString('en-ZA')} characters of CSV.`);

  log.step('Parsing CSV');
  const rows = parseCsv(csv);
  const records = rowsToRecords(rows);
  log.ok(`Parsed ${records.length} data row(s).`);

  log.step('Normalising items');
  const folders = await scanImageFolders(imagesDir);
  // rowNumber: +2 because index 0 is the first data row and row 1 is the header.
  const items = dedupeById(
    records.map((record, index) => toItem(record, index + 2, imagesDir, folders)).filter(Boolean)
  );

  const byStatus = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  log.ok(
    `${items.length} item(s) ready ` +
      `(${Object.entries(byStatus).map(([status, n]) => `${n} ${status}`).join(', ') || 'none'}).`
  );

  await reportMissingImages(items);

  log.step('Writing output');
  const changed = await writeItems(outputFile, items);
  log.ok(`${changed ? 'Wrote' : 'Verified'} ${path.relative(ROOT, outputFile)}.`);

  console.log('\n🎉 Sync complete.\n');
}

// Only run when executed directly, so the helpers above stay importable/testable.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    log.error(error.message);
    if (process.env.DEBUG) console.error(error);
    process.exitCode = 1;
  });
}
