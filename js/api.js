/**
 * api.js
 * ---------------------------------------------------------------------------
 * The only module that knows how catalogue data reaches the browser.
 * Today that is a static JSON file generated from Google Sheets by
 * `scripts/sheet-to-json.js`; swapping in a live endpoint later means editing
 * this file alone.
 */

import { CONFIG } from './config.js';

const REQUEST_TIMEOUT_MS = 15_000;

/** Fields every item is guaranteed to have once it leaves this module. */
const ITEM_DEFAULTS = Object.freeze({
  id: '',
  title: 'Untitled item',
  price: null,
  description: '',
  status: 'available',
  category: 'Other',
  condition: '',
  location: '',
  images: [],
  dateAdded: null,
  featured: false,
  order: 0,
});

const VALID_STATUSES = new Set(CONFIG.statuses.map((status) => status.value));

/** Error type thrown by {@link fetchItems} so callers can show a friendly message. */
export class CatalogueError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'CatalogueError';
    if (cause) this.cause = cause;
  }
}

/**
 * Coerces one raw record into a safe, fully populated item.
 * Defensive on purpose: the data comes from a spreadsheet a human edits.
 *
 * @param {Record<string, unknown>} raw
 * @param {number} index position in the source file, used as a sort fallback
 * @returns {object|null} null when the record has no id or title
 */
function normaliseItem(raw, index) {
  if (!raw || typeof raw !== 'object') return null;

  const id = String(raw.id ?? '').trim();
  const title = String(raw.title ?? '').trim();
  if (!id || !title) return null;

  const price = Number(raw.price);
  const status = String(raw.status ?? '').toLowerCase().trim();

  return {
    ...ITEM_DEFAULTS,
    id,
    title,
    price: Number.isFinite(price) && raw.price !== null && raw.price !== '' ? price : null,
    description: String(raw.description ?? '').trim(),
    status: VALID_STATUSES.has(status) ? status : 'available',
    category: String(raw.category ?? '').trim() || 'Other',
    condition: String(raw.condition ?? '').trim(),
    location: String(raw.location ?? '').trim(),
    images: Array.isArray(raw.images) ? raw.images.filter((src) => typeof src === 'string' && src) : [],
    dateAdded: raw.dateAdded ? String(raw.dateAdded) : null,
    featured: Boolean(raw.featured),
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
  };
}

/**
 * Loads the catalogue.
 *
 * Accepts either shape written by the sync script:
 *   `{ generatedAt, count, items: [...] }`  or a bare `[...]`.
 *
 * @param {string} [url] override for tests or a secondary data source
 * @returns {Promise<{items: object[], generatedAt: string|null}>}
 * @throws {CatalogueError} on network, HTTP, parse or shape failures
 */
export async function fetchItems(url = CONFIG.dataUrl) {
  let response;

  try {
    response = await fetch(url, {
      // The GitHub Action rewrites this file hourly; always revalidate.
      cache: 'no-cache',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new CatalogueError(
      error.name === 'TimeoutError'
        ? 'The catalogue took too long to load. Please check your connection and try again.'
        : 'We could not reach the catalogue. Please check your connection and try again.',
      { cause: error }
    );
  }

  if (!response.ok) {
    throw new CatalogueError(
      `The catalogue could not be loaded (HTTP ${response.status}).`,
      { cause: new Error(response.statusText) }
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new CatalogueError('The catalogue file is not valid JSON.', { cause: error });
  }

  const rawItems = Array.isArray(payload) ? payload : payload?.items;
  if (!Array.isArray(rawItems)) {
    throw new CatalogueError('The catalogue file does not contain an "items" array.');
  }

  const items = rawItems.map(normaliseItem).filter(Boolean);

  const skipped = rawItems.length - items.length;
  if (skipped > 0) {
    console.warn(`[api] Ignored ${skipped} catalogue row(s) missing an id or title.`);
  }

  return {
    items,
    generatedAt: Array.isArray(payload) ? null : (payload?.generatedAt ?? null),
  };
}

/**
 * Unique category names present in the catalogue, alphabetically sorted.
 * @param {object[]} items
 * @returns {string[]}
 */
export function collectCategories(items) {
  return [...new Set(items.map((item) => item.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, CONFIG.currency.locale)
  );
}

/**
 * How many items carry each status, used for the filter counters.
 * @param {object[]} items
 * @returns {Record<string, number>}
 */
export function countByStatus(items) {
  return items.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, {});
}
