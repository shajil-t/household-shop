/**
 * app.js
 * ---------------------------------------------------------------------------
 * Application entry point: loads the catalogue, wires the UI to the filter
 * state and keeps the two in sync. All heavy lifting lives in the other
 * modules — this file is deliberately just the wiring.
 */

import { CONFIG } from './config.js';
import { CatalogueError, collectCategories, countByStatus, fetchItems } from './api.js';
import { ICONS } from './icons.js';
import {
  applyFilters,
  countActiveFilters,
  FilterState,
  hasActiveFilters,
  stateFromUrl,
  stateToUrl,
} from './filters.js';
import { closeModal, initModal, itemIdFromUrl, openModal } from './modal.js';
import {
  hideEmptyState,
  renderActiveFilterChips,
  renderCategoryFilters,
  renderEmptyState,
  renderItems,
  renderResultCount,
  renderSkeletons,
  renderSortOptions,
  renderStatusFilters,
  resetCards,
  showSlide,
} from './render.js';
import {
  debounce,
  formatDate,
  getFocusable,
  hideAfterTransition,
  qs,
  qsa,
  scrollLock,
  trapFocus,
} from './utils.js';

/* -------------------------------------------------------------------------- */
/* Module state                                                               */
/* -------------------------------------------------------------------------- */

/** Every item in the catalogue, unfiltered. */
let allItems = [];

const state = new FilterState(stateFromUrl());

/** Cached element references. */
const dom = {};

/** Releases the drawer focus trap; null while the drawer is closed. */
let releaseDrawerFocus = null;

/** Whether the filter drawer is logically open (see toggleDrawer). */
let drawerOpen = false;

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

/** Resolves the elements the app talks to, once. */
function cacheDom() {
  Object.assign(dom, {
    grid: qs('#item-grid'),
    resultCount: qs('#result-count'),
    emptyState: qs('#empty-state'),
    search: qs('#search-input'),
    searchClear: qs('#search-clear'),
    sort: qs('#sort-select'),
    filterToggle: qs('#filter-toggle'),
    filterCount: qs('#filter-count'),
    drawer: qs('#filter-drawer'),
    drawerScrim: qs('#drawer-scrim'),
    statusFilters: qs('#status-filters'),
    categoryFilters: qs('#category-filters'),
    activeFilters: qs('#active-filters'),
    scrollTop: qs('#scroll-top'),
    lastUpdated: qs('#last-updated'),
    year: qs('#footer-year'),
    toolbar: qs('#toolbar'),
  });
}

/** Injects the static icons that live outside of dynamic templates. */
function paintStaticIcons() {
  qs('#search-icon').innerHTML = ICONS.search;
  qs('#search-clear').innerHTML = ICONS.close;
  qs('#filter-icon').innerHTML = ICONS.filter;
  qs('#sort-icon').innerHTML = ICONS.sort;
  qs('#drawer-close').innerHTML = ICONS.close;
  qs('#scroll-top').innerHTML = ICONS.arrowUp;
}

/** Starts the app: paint skeletons, load data, then render for real. */
async function init() {
  cacheDom();
  paintStaticIcons();
  initModal();
  bindEvents();

  // The configuration file is the single source of truth for the branding.
  document.title = `${CONFIG.siteName} — items for sale`;
  qs('#site-title').textContent = CONFIG.siteName;
  qs('#site-tagline').textContent = CONFIG.tagline;
  dom.year.textContent = String(new Date().getFullYear());
  renderSortOptions(dom.sort, state.value.sort);
  syncControls(state.value);
  renderSkeletons(dom.grid);

  try {
    const { items, generatedAt } = await fetchItems();
    allItems = items;
    const categories = collectCategories(items).map((name) => ({
      name,
      count: items.filter((item) => item.category === name).length,
    }));

    resetCards();
    renderStatusFilters(dom.statusFilters, countByStatus(items), state.value.status);
    renderCategoryFilters(dom.categoryFilters, categories, state.value.categories);

    if (generatedAt) {
      const formatted = formatDate(generatedAt);
      dom.lastUpdated.textContent = formatted ? `Catalogue updated ${formatted}` : '';
    }

    render(state.value);

    // A shared link such as ".../#item=fridge-001" opens straight onto the item.
    const deepLinkedId = itemIdFromUrl();
    if (deepLinkedId) openItemById(deepLinkedId);
  } catch (error) {
    showLoadError(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Single render path: filter, paint the grid, update every dependent control
 * and mirror the state into the URL.
 * @param {import('./filters.js').ViewState} viewState
 */
function render(viewState) {
  const visible = applyFilters(allItems, viewState);

  renderResultCount(dom.resultCount, visible.length, allItems.length);
  renderActiveFilterChips(dom.activeFilters, viewState);
  syncControls(viewState);
  stateToUrl(viewState);

  if (!visible.length) {
    dom.grid.replaceChildren();
    dom.grid.setAttribute('aria-busy', 'false');
    renderEmptyState(dom.emptyState, {
      title: allItems.length ? 'No items match your search' : 'Nothing listed yet',
      message: allItems.length
        ? 'Try a different spelling, clear a filter, or browse everything that is still available.'
        : 'The catalogue is empty for now — please check back soon.',
      showReset: allItems.length > 0 && hasActiveFilters(viewState),
    });
    return;
  }

  hideEmptyState(dom.emptyState);
  renderItems(dom.grid, visible);
}

/** Pushes state values back into the form controls (idempotent). */
function syncControls(viewState) {
  if (dom.search.value !== viewState.search) dom.search.value = viewState.search;
  dom.searchClear.hidden = viewState.search === '';
  if (dom.sort.value !== viewState.sort) dom.sort.value = viewState.sort;

  for (const radio of qsa('input[name="status"]', dom.statusFilters)) {
    radio.checked = radio.value === viewState.status;
  }

  const active = new Set(viewState.categories);
  for (const checkbox of qsa('input[name="category"]', dom.categoryFilters)) {
    checkbox.checked = active.has(checkbox.value);
  }

  const count = countActiveFilters(viewState);
  dom.filterCount.textContent = String(count);
  dom.filterCount.hidden = count === 0;
  dom.filterToggle.setAttribute('aria-label', count ? `Filters (${count} active)` : 'Filters');
}

/** Replaces the grid with a retryable error panel. */
function showLoadError(error) {
  console.error('[app] Failed to load the catalogue:', error);

  dom.grid.replaceChildren();
  dom.grid.setAttribute('aria-busy', 'false');
  renderResultCount(dom.resultCount, 0, 0);
  renderEmptyState(dom.emptyState, {
    title: 'We could not load the catalogue',
    message:
      error instanceof CatalogueError
        ? error.message
        : 'Something went wrong while loading the items. Please refresh the page.',
    showReset: false,
  });
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/** Wires every listener the page needs. */
function bindEvents() {
  // Re-render whenever the view state changes, from any source.
  state.subscribe(render);

  /* --- Search ------------------------------------------------------------ */

  const commitSearch = debounce((value) => state.update({ search: value }), CONFIG.searchDebounce);

  dom.search.addEventListener('input', (event) => {
    // Show/hide the clear button immediately; filtering waits for the debounce.
    dom.searchClear.hidden = event.target.value === '';
    commitSearch(event.target.value);
  });

  dom.search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitSearch.flush();
    } else if (event.key === 'Escape' && dom.search.value) {
      event.preventDefault();
      commitSearch.cancel();
      state.update({ search: '' });
    }
  });

  dom.searchClear.addEventListener('click', () => {
    commitSearch.cancel();
    state.update({ search: '' });
    dom.search.focus();
  });

  /* --- Sort -------------------------------------------------------------- */

  dom.sort.addEventListener('change', (event) => state.update({ sort: event.target.value }));

  /* --- Filter drawer ----------------------------------------------------- */

  dom.filterToggle.addEventListener('click', () => toggleDrawer(!drawerOpen));
  dom.drawerScrim.addEventListener('click', () => toggleDrawer(false));

  dom.drawer.addEventListener('click', (event) => {
    if (event.target.closest('[data-drawer-close]')) toggleDrawer(false);
  });

  dom.drawer.addEventListener('change', (event) => {
    const input = event.target;
    if (input.name === 'status') {
      state.update({ status: input.value });
    } else if (input.name === 'category') {
      state.toggleCategory(input.value, input.checked);
    }
  });

  dom.drawer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      toggleDrawer(false);
    }
  });

  /* --- Clear-filter chips (toolbar and empty state) ---------------------- */

  for (const container of [dom.activeFilters, dom.emptyState]) {
    container.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-clear]');
      if (trigger) clearFilter(trigger.dataset.clear);
    });
  }

  /* --- Grid: open details, carousel dots --------------------------------- */

  dom.grid.addEventListener('click', (event) => {
    const dot = event.target.closest('.carousel__dot');
    if (dot) {
      showSlide(dot.closest('[data-carousel-root]'), Number(dot.dataset.slide));
      return;
    }

    const card = event.target.closest('.card');
    if (!card || card.classList.contains('card--skeleton')) return;
    openItemById(card.dataset.id);
  });

  /* --- Scroll-to-top ---------------------------------------------------- */

  dom.scrollTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    dom.search.focus({ preventScroll: true });
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* --- Browser navigation ----------------------------------------------- */

  // Someone using Back/Forward (or an in-page link with a query string) should
  // land on the filters that URL describes.
  window.addEventListener('popstate', () => {
    const deepLinkedId = itemIdFromUrl();
    if (deepLinkedId) openItemById(deepLinkedId);
    else closeModal();
    state.update(stateFromUrl());
  });

  /* --- Global shortcuts ------------------------------------------------- */

  document.addEventListener('keydown', (event) => {
    // "/" focuses the search box, the way most catalogues behave.
    const typingElsewhere = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
    if (event.key === '/' && !typingElsewhere && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      dom.search.focus();
      dom.search.select();
    }
  });
}

/** Toggles the sticky-toolbar shadow and the scroll-to-top button. */
function onScroll() {
  const scrolled = window.scrollY;
  dom.toolbar.classList.toggle('is-stuck', scrolled > 8);
  dom.scrollTop.classList.toggle('is-visible', scrolled > 600);
}

/** Opens the detail modal for an item id. */
function openItemById(id) {
  const item = allItems.find((candidate) => candidate.id === id);
  if (item) openModal(item);
}

/**
 * Undoes one filter (or all of them).
 * @param {string} token 'all' | 'search' | 'status' | `category:<name>`
 */
function clearFilter(token) {
  if (token === 'all') {
    state.reset();
    dom.search.focus({ preventScroll: true });
    return;
  }
  if (token === 'search') {
    state.update({ search: '' });
    return;
  }
  if (token === 'status') {
    state.update({ status: 'all' });
    return;
  }
  if (token.startsWith('category:')) {
    state.toggleCategory(token.slice('category:'.length), false);
  }
}

/**
 * Opens or closes the filter drawer, managing focus and background scroll.
 * @param {boolean} open
 */
function toggleDrawer(open) {
  if (open === drawerOpen) return;

  drawerOpen = open;
  dom.filterToggle.setAttribute('aria-expanded', String(open));

  if (open) {
    dom.drawer.hidden = false;
    dom.drawerScrim.hidden = false;
    requestAnimationFrame(() => {
      dom.drawer.classList.add('is-open');
      dom.drawerScrim.classList.add('is-open');
    });
    scrollLock.lock();
    releaseDrawerFocus = trapFocus(dom.drawer);
    getFocusable(dom.drawer)[0]?.focus({ preventScroll: true });
  } else {
    dom.drawer.classList.remove('is-open');
    dom.drawerScrim.classList.remove('is-open');
    hideAfterTransition(dom.drawer);
    hideAfterTransition(dom.drawerScrim);
    scrollLock.unlock();
    releaseDrawerFocus?.();
    releaseDrawerFocus = null;
  }
}

/* -------------------------------------------------------------------------- */

// `defer` on the script tag guarantees the DOM is parsed, but guard anyway so
// the module is safe to import from anywhere.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
