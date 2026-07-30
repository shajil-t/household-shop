/**
 * render.js
 * ---------------------------------------------------------------------------
 * Every piece of DOM the catalogue page paints: skeletons, item cards, the
 * card image carousels, the filter controls and the empty state.
 *
 * Nothing here reads or writes application state — callers pass data in and
 * wire behaviour up through event delegation, which keeps rendering cheap and
 * predictable.
 */

import { CONFIG } from './config.js';
import { ICONS } from './icons.js';
import {
  attachImageFallback,
  createLazyLoader,
  el,
  formatPrice,
  qsa,
  replaceChildren,
  truncate,
  wrapIndex,
} from './utils.js';

/** Human-readable label + modifier class per status. */
const STATUS_META = Object.freeze({
  available: { label: 'Available', badge: null },
  reserved: { label: 'Reserved', badge: 'badge--reserved' },
  sold: { label: 'Sold', badge: 'badge--sold' },
});

const SKELETON_COUNT = 8;

/* ========================================================================== */
/* Card cache                                                                 */
/* ========================================================================== */

/**
 * Rendered cards keyed by item id. Re-sorting the grid then only reorders
 * existing nodes instead of rebuilding them, which keeps images loaded and
 * carousels running.
 * @type {Map<string, HTMLElement>}
 */
const cardCache = new Map();

/** Signature of the data a cached card was built from, to detect real changes. */
const cardSignatures = new Map();

/** Drops every cached card. Call after the catalogue data itself is replaced. */
export function resetCards() {
  cardCache.clear();
  cardSignatures.clear();
  carousels.clear();
}

/** Cheap content fingerprint used to decide whether a card must be rebuilt. */
const signatureOf = (item) =>
  [item.title, item.price, item.status, item.condition, item.location, item.description, item.images.join('|')].join('§');

/* ========================================================================== */
/* Carousel engine                                                            */
/* ========================================================================== */

/**
 * One shared ticker advances every on-screen carousel, rather than each card
 * owning a timer. Cards that are off-screen, hovered or focused are skipped.
 * @type {Map<HTMLElement, {slides: HTMLElement[], dots: HTMLElement[], index: number, visible: boolean}>}
 */
const carousels = new Map();

let tickerId = null;
let carouselsPaused = false;

const visibilityObserver =
  typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const carousel = carousels.get(entry.target);
            if (carousel) carousel.visible = entry.isIntersecting;
          }
        },
        { rootMargin: '0px', threshold: 0.25 }
      );

/** Registers a card's carousel with the shared ticker. */
function registerCarousel(root) {
  const slides = qsa('.carousel__slide', root);
  if (slides.length < 2) return;

  carousels.set(root, {
    slides,
    dots: qsa('.carousel__dot', root),
    index: 0,
    visible: true,
  });
  visibilityObserver?.observe(root);
  startTicker();
}

/** Shows slide `index` of a carousel, updating dots and ARIA state. */
export function showSlide(root, index) {
  const carousel = carousels.get(root);
  if (!carousel) return;

  const next = wrapIndex(index, carousel.slides.length);
  if (next === carousel.index) return;

  carousel.slides[carousel.index]?.classList.remove('is-active');
  carousel.dots[carousel.index]?.setAttribute('aria-current', 'false');

  const slide = carousel.slides[next];
  // Neighbouring slides are lazy: promote the source the moment it is needed.
  if (slide?.dataset.src) {
    slide.src = slide.dataset.src;
    delete slide.dataset.src;
  }
  slide?.classList.add('is-active');
  carousel.dots[next]?.setAttribute('aria-current', 'true');
  carousel.index = next;
}

/** Globally pauses rotation, e.g. while the detail modal is open. */
export function setCarouselsPaused(paused) {
  carouselsPaused = paused;
}

/** Starts the shared interval (idempotent). */
function startTicker() {
  if (tickerId !== null) return;
  tickerId = window.setInterval(tick, CONFIG.carouselInterval);
}

/** Advances every eligible carousel once. */
function tick() {
  if (carouselsPaused || document.hidden || carousels.size === 0) return;

  for (const [root, carousel] of carousels) {
    // A card that is filtered out is detached, not destroyed: it comes back
    // from the cache, so skip it rather than unregistering it.
    if (!root.isConnected || !carousel.visible) continue;
    // Pausing on hover/focus is a CSS-state question, so ask the DOM directly
    // instead of tracking pointer events per card.
    if (root.closest('.card')?.matches(':hover, :focus-within')) continue;
    showSlide(root, carousel.index + 1);
  }
}

// Stop burning timers while the tab is in the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    window.clearInterval(tickerId);
    tickerId = null;
  } else if (carousels.size) {
    startTicker();
  }
});

/* ========================================================================== */
/* Lazy loading                                                               */
/* ========================================================================== */

const lazyLoader = createLazyLoader();

/* ========================================================================== */
/* Card building                                                              */
/* ========================================================================== */

/** Builds the image carousel (or a single static image) for a card. */
function buildMedia(item) {
  const images = item.images.length ? item.images : [CONFIG.placeholderImage];
  const status = STATUS_META[item.status] ?? STATUS_META.available;

  const slides = images.map((src, index) => {
    const image = el('img', {
      class: `carousel__slide${index === 0 ? ' is-active' : ''}`,
      alt: index === 0 ? item.title : `${item.title} — photo ${index + 1}`,
      loading: 'lazy',
      decoding: 'async',
      // Only the first frame loads with the card; the rest wait for the
      // carousel to reach them (or for the card to enter the viewport).
      ...(index === 0 ? { src } : { dataset: { src } }),
    });
    attachImageFallback(image);
    return image;
  });

  const carousel = el('div', { class: 'carousel' }, slides);

  const children = [carousel];

  if (status.badge) {
    children.push(el('span', { class: `badge ${status.badge}`, text: status.label }));
  }

  if (images.length > 1) {
    const dots = images.map((_, index) =>
      el('button', {
        class: 'carousel__dot',
        type: 'button',
        dataset: { slide: String(index) },
        attrs: {
          'aria-label': `Show photo ${index + 1} of ${images.length}`,
          'aria-current': index === 0 ? 'true' : 'false',
        },
      })
    );
    children.push(el('div', { class: 'carousel__dots' }, dots));
  }

  const media = el('div', { class: 'card__media' }, children);
  // The media wrapper is the carousel "root": it contains both the slides and
  // the dots, so a single element identifies the whole widget for delegation.
  media.dataset.carouselRoot = 'true';
  return { media, hasCarousel: images.length > 1 };
}

/** Builds the condition / location meta row. */
function buildMeta(item) {
  const chips = [];

  if (item.condition) {
    chips.push(
      el('span', { class: 'chip', attrs: { title: 'Condition' } }, [
        el('span', { class: 'chip__icon', html: ICONS.sparkle }),
        el('span', { text: item.condition }),
      ])
    );
  }

  if (item.location) {
    chips.push(
      el('span', { class: 'chip', attrs: { title: 'Collection area' } }, [
        el('span', { class: 'chip__icon', html: ICONS.pin }),
        el('span', { text: item.location }),
      ])
    );
  }

  return chips.length ? el('div', { class: 'card__meta' }, chips) : null;
}

/**
 * Creates a full item card. The whole card is clickable via delegation in
 * app.js; the "View details" button is the keyboard-reachable equivalent.
 * @param {object} item
 * @returns {HTMLElement}
 */
function createCard(item) {
  const { media, hasCarousel } = buildMedia(item);
  const status = STATUS_META[item.status] ?? STATUS_META.available;

  const card = el(
    'article',
    {
      class: `card${item.status === 'sold' ? ' card--sold' : ''}`,
      dataset: { id: item.id, status: item.status },
      attrs: { 'aria-label': `${item.title}, ${formatPrice(item.price)}, ${status.label}` },
    },
    [
      media,
      el('div', { class: 'card__body' }, [
        el('p', { class: 'card__category', text: item.category }),
        el('h3', { class: 'card__title', text: item.title }),
        el('p', { class: 'card__price', text: formatPrice(item.price) }),
        item.description
          ? el('p', { class: 'card__description', text: truncate(item.description, 110) })
          : null,
        buildMeta(item),
      ]),
      el('div', { class: 'card__footer' }, [
        el('button', {
          class: 'btn btn--primary card__cta',
          type: 'button',
          dataset: { open: item.id },
          attrs: { 'aria-label': `View details for ${item.title}` },
          text: 'View Details',
        }),
      ]),
    ]
  );

  if (hasCarousel) registerCarousel(media);
  lazyLoader.observe(card);

  return card;
}

/* ========================================================================== */
/* Grid rendering                                                             */
/* ========================================================================== */

/** Paints placeholder cards while the catalogue JSON is in flight. */
export function renderSkeletons(grid, count = SKELETON_COUNT) {
  const skeletons = Array.from({ length: count }, () =>
    el('div', { class: 'card card--skeleton', attrs: { 'aria-hidden': 'true' } }, [
      el('div', { class: 'skeleton skeleton--media' }),
      el('div', { class: 'card__body' }, [
        el('div', { class: 'skeleton skeleton--line skeleton--short' }),
        el('div', { class: 'skeleton skeleton--line skeleton--title' }),
        el('div', { class: 'skeleton skeleton--line skeleton--price' }),
        el('div', { class: 'skeleton skeleton--line' }),
        el('div', { class: 'skeleton skeleton--line skeleton--short' }),
      ]),
    ])
  );

  grid.setAttribute('aria-busy', 'true');
  replaceChildren(grid, skeletons);
}

/**
 * Renders `items` into the grid, reusing previously built cards.
 * Only the child order changes when the same items are re-sorted.
 *
 * @param {HTMLElement} grid
 * @param {object[]} items
 */
export function renderItems(grid, items) {
  const fragment = document.createDocumentFragment();

  for (const item of items) {
    const signature = signatureOf(item);
    let card = cardCache.get(item.id);

    if (!card || cardSignatures.get(item.id) !== signature) {
      card = createCard(item);
      cardCache.set(item.id, card);
      cardSignatures.set(item.id, signature);
    }
    fragment.append(card);
  }

  grid.setAttribute('aria-busy', 'false');
  grid.replaceChildren(fragment);
}

/**
 * Updates the "N items" line above the grid.
 * @param {HTMLElement} node
 * @param {number} shown
 * @param {number} total
 */
export function renderResultCount(node, shown, total) {
  const label =
    shown === total
      ? `${total} ${total === 1 ? 'item' : 'items'}`
      : `${shown} of ${total} ${total === 1 ? 'item' : 'items'}`;
  if (node.textContent !== label) node.textContent = label;
}

/* ========================================================================== */
/* Filter controls                                                            */
/* ========================================================================== */

/** Fills the sort <select> from CONFIG. */
export function renderSortOptions(select, activeValue) {
  replaceChildren(
    select,
    CONFIG.sortOptions.map((option) =>
      el('option', { value: option.value, text: option.label, selected: option.value === activeValue })
    )
  );
}

/**
 * Renders the status radio group.
 * @param {HTMLElement} container
 * @param {Record<string, number>} counts items per status
 * @param {string} activeStatus
 */
export function renderStatusFilters(container, counts, activeStatus) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const options = [{ value: 'all', label: 'All items', count: total }, ...CONFIG.statuses.map((status) => ({
    ...status,
    count: counts[status.value] || 0,
  }))];

  replaceChildren(
    container,
    options.map((option) =>
      el('label', { class: 'option' }, [
        el('input', {
          type: 'radio',
          name: 'status',
          value: option.value,
          checked: option.value === activeStatus,
          class: 'option__input',
        }),
        el('span', { class: 'option__label', text: option.label }),
        el('span', { class: 'option__count', text: String(option.count) }),
      ])
    )
  );
}

/**
 * Renders the category checkbox list.
 * @param {HTMLElement} container
 * @param {Array<{name: string, count: number}>} categories
 * @param {string[]} activeCategories
 */
export function renderCategoryFilters(container, categories, activeCategories) {
  if (!categories.length) {
    replaceChildren(container, [el('p', { class: 'drawer__hint', text: 'No categories yet.' })]);
    return;
  }

  const active = new Set(activeCategories);

  replaceChildren(
    container,
    categories.map((category) =>
      el('label', { class: 'option' }, [
        el('input', {
          type: 'checkbox',
          name: 'category',
          value: category.name,
          checked: active.has(category.name),
          class: 'option__input',
        }),
        el('span', { class: 'option__label', text: category.name }),
        el('span', { class: 'option__count', text: String(category.count) }),
      ])
    )
  );
}

/**
 * Renders removable chips describing the active filters.
 * Each chip carries `data-clear` so app.js can undo it via delegation.
 *
 * @param {HTMLElement} container
 * @param {{search: string, status: string, categories: string[]}} state
 */
export function renderActiveFilterChips(container, state) {
  const chips = [];

  if (state.search) {
    chips.push(buildClearChip(`“${truncate(state.search, 24)}”`, 'search'));
  }
  if (state.status !== 'all') {
    const label = (STATUS_META[state.status] ?? {}).label ?? state.status;
    chips.push(buildClearChip(label, 'status'));
  }
  for (const category of state.categories) {
    chips.push(buildClearChip(category, `category:${category}`));
  }

  if (chips.length > 1) {
    chips.push(
      el('button', {
        class: 'chip chip--clear-all',
        type: 'button',
        dataset: { clear: 'all' },
        text: 'Clear all',
      })
    );
  }

  container.hidden = chips.length === 0;
  replaceChildren(container, chips);
}

/** A single "remove this filter" chip. */
function buildClearChip(label, clearValue) {
  return el(
    'button',
    {
      class: 'chip chip--removable',
      type: 'button',
      dataset: { clear: clearValue },
      attrs: { 'aria-label': `Remove filter: ${label}` },
    },
    [el('span', { text: label }), el('span', { class: 'chip__icon', html: ICONS.close })]
  );
}

/* ========================================================================== */
/* States                                                                     */
/* ========================================================================== */

/**
 * Shows the "nothing matched" panel, or an error variant.
 * @param {HTMLElement} container
 * @param {{title: string, message: string, showReset?: boolean}} options
 */
export function renderEmptyState(container, { title, message, showReset = true }) {
  replaceChildren(container, [
    el('div', { class: 'empty-state__illustration', html: ICONS.emptyBoxes }),
    el('h2', { class: 'empty-state__title', text: title }),
    el('p', { class: 'empty-state__message', text: message }),
    showReset
      ? el('button', {
          class: 'btn btn--primary',
          type: 'button',
          dataset: { clear: 'all' },
          text: 'Clear filters',
        })
      : null,
  ]);
  container.hidden = false;
}

/** Hides the empty state. */
export function hideEmptyState(container) {
  container.hidden = true;
}
