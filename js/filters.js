/**
 * filters.js
 * ---------------------------------------------------------------------------
 * Owns the "view state" of the catalogue — search text, status filter,
 * category filter and sort order — plus the pure functions that turn a list of
 * items into the list the grid should show.
 *
 * The state is mirrored into the URL query string so any view can be shared:
 *   ?q=fridge&status=available&category=Kitchen,Lounge&sort=price-asc
 */

import { CONFIG } from './config.js';
import { normaliseText } from './utils.js';

const SORT_VALUES = new Set(CONFIG.sortOptions.map((option) => option.value));
const STATUS_VALUES = new Set(CONFIG.statuses.map((status) => status.value));

/** @typedef {{search: string, status: string, categories: string[], sort: string}} ViewState */

/** The state that shows everything, in the default order. */
export const DEFAULT_STATE = Object.freeze({
  search: '',
  status: 'all',
  categories: [],
  sort: CONFIG.defaultSort,
});

/* -------------------------------------------------------------------------- */
/* State container                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A tiny observable store. `subscribe` returns an unsubscribe function.
 * Listeners only fire when something actually changed, which keeps the grid
 * from re-rendering on no-op input events.
 */
export class FilterState {
  #state;
  #listeners = new Set();

  /** @param {Partial<ViewState>} [initial] */
  constructor(initial = {}) {
    this.#state = sanitiseState({ ...DEFAULT_STATE, ...initial });
  }

  /** @returns {ViewState} a frozen snapshot */
  get value() {
    return Object.freeze({ ...this.#state, categories: [...this.#state.categories] });
  }

  /**
   * Merges a partial update into the state.
   * @param {Partial<ViewState>} patch
   * @returns {boolean} true when the state changed (and listeners ran)
   */
  update(patch) {
    const next = sanitiseState({ ...this.#state, ...patch });
    if (isSameState(this.#state, next)) return false;

    this.#state = next;
    for (const listener of this.#listeners) listener(this.value);
    return true;
  }

  /** Resets every filter, keeping the current sort order. */
  reset() {
    return this.update({ ...DEFAULT_STATE, sort: this.#state.sort });
  }

  /** Toggles a single category on or off. */
  toggleCategory(category, force) {
    const set = new Set(this.#state.categories);
    const shouldAdd = force ?? !set.has(category);
    if (shouldAdd) set.add(category);
    else set.delete(category);
    return this.update({ categories: [...set] });
  }

  /** @param {(state: ViewState) => void} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** Coerces arbitrary input into a valid state object. */
function sanitiseState(state) {
  return {
    search: String(state.search ?? '').slice(0, 200),
    status: STATUS_VALUES.has(state.status) ? state.status : 'all',
    categories: [...new Set((state.categories ?? []).map((value) => String(value).trim()).filter(Boolean))].sort(),
    sort: SORT_VALUES.has(state.sort) ? state.sort : CONFIG.defaultSort,
  };
}

/** Shallow-compares two states, treating `categories` as a set. */
function isSameState(a, b) {
  return (
    a.search === b.search &&
    a.status === b.status &&
    a.sort === b.sort &&
    a.categories.length === b.categories.length &&
    a.categories.every((category, index) => category === b.categories[index])
  );
}

/** True when any filter (not sort) is narrowing the list. */
export function hasActiveFilters(state) {
  return Boolean(state.search) || state.status !== 'all' || state.categories.length > 0;
}

/** Number of active filters, for the badge on the Filters button. */
export function countActiveFilters(state) {
  return (state.search ? 1 : 0) + (state.status !== 'all' ? 1 : 0) + state.categories.length;
}

/* -------------------------------------------------------------------------- */
/* URL synchronisation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Reads a view state out of a query string (defaults fill in the gaps).
 * @param {string} [search] defaults to `location.search`
 * @returns {ViewState}
 */
export function stateFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  return sanitiseState({
    search: params.get('q') ?? '',
    status: (params.get('status') ?? 'all').toLowerCase(),
    categories: (params.get('category') ?? '').split(',').map((value) => value.trim()).filter(Boolean),
    sort: params.get('sort') ?? CONFIG.defaultSort,
  });
}

/**
 * Writes the state into the address bar without adding history entries for
 * every keystroke (`replaceState`), so Back still leaves the site.
 * @param {ViewState} state
 */
export function stateToUrl(state) {
  const params = new URLSearchParams();
  if (state.search) params.set('q', state.search);
  if (state.status !== 'all') params.set('status', state.status);
  if (state.categories.length) params.set('category', state.categories.join(','));
  if (state.sort !== CONFIG.defaultSort) params.set('sort', state.sort);

  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}

/* -------------------------------------------------------------------------- */
/* Filtering & sorting                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Builds the haystack searched for a given item. Cached on the item under a
 * non-enumerable key so repeated keystrokes do not rebuild the same string.
 * @param {object} item
 * @returns {string}
 */
function searchIndexFor(item) {
  if (!item.__searchIndex) {
    Object.defineProperty(item, '__searchIndex', {
      value: normaliseText(
        [item.title, item.category, item.description, item.condition, item.location].join(' ')
      ),
      enumerable: false,
    });
  }
  return item.__searchIndex;
}

/**
 * Matches an item against the search box. Every whitespace-separated term must
 * appear somewhere in the item, so "fridge midrand" narrows rather than widens.
 * @param {object} item
 * @param {string[]} terms
 */
function matchesSearch(item, terms) {
  if (!terms.length) return true;
  const haystack = searchIndexFor(item);
  return terms.every((term) => haystack.includes(term));
}

/** Comparators for each sort option. */
const COMPARATORS = {
  'price-asc': (a, b) => comparePrice(a, b, 1),
  'price-desc': (a, b) => comparePrice(a, b, -1),
  alpha: (a, b) => a.title.localeCompare(b.title, CONFIG.currency.locale, { sensitivity: 'base' }),
  newest: (a, b) => {
    const dateA = a.dateAdded ? Date.parse(a.dateAdded) : NaN;
    const dateB = b.dateAdded ? Date.parse(b.dateAdded) : NaN;
    if (Number.isFinite(dateA) && Number.isFinite(dateB) && dateA !== dateB) return dateB - dateA;
    // No usable dates: later sheet rows are treated as the newer additions.
    return b.order - a.order;
  },
};

/** Items without a price always sort last, whichever direction is chosen. */
function comparePrice(a, b, direction) {
  const priceA = typeof a.price === 'number' ? a.price : null;
  const priceB = typeof b.price === 'number' ? b.price : null;
  if (priceA === null && priceB === null) return 0;
  if (priceA === null) return 1;
  if (priceB === null) return -1;
  return (priceA - priceB) * direction;
}

/**
 * Applies search, filters and sorting.
 * Pure: never mutates the input array.
 *
 * @param {object[]} items
 * @param {ViewState} state
 * @returns {object[]}
 */
export function applyFilters(items, state) {
  const terms = normaliseText(state.search).split(/\s+/).filter(Boolean);
  const categories = new Set(state.categories);

  const filtered = items.filter((item) => {
    if (state.status !== 'all' && item.status !== state.status) return false;
    if (categories.size && !categories.has(item.category)) return false;
    return matchesSearch(item, terms);
  });

  const comparator = COMPARATORS[state.sort] ?? COMPARATORS[CONFIG.defaultSort];

  // Sold items sink to the bottom of every sort — nobody wants to scroll past
  // things they cannot buy.
  return filtered.sort((a, b) => {
    const soldA = a.status === 'sold' ? 1 : 0;
    const soldB = b.status === 'sold' ? 1 : 0;
    return soldA !== soldB ? soldA - soldB : comparator(a, b);
  });
}
