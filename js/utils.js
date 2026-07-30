/**
 * utils.js
 * ---------------------------------------------------------------------------
 * Small, dependency-free helpers shared by every other module.
 * Nothing in here touches application state.
 */

import { CONFIG } from './config.js';

/* -------------------------------------------------------------------------- */
/* DOM                                                                        */
/* -------------------------------------------------------------------------- */

/** Shorthand for `document.querySelector`. */
export const qs = (selector, scope = document) => scope.querySelector(selector);

/** Shorthand for `document.querySelectorAll`, returned as a real array. */
export const qsa = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/**
 * Creates an element in one expression.
 *
 * @param {string} tag
 * @param {Object} [props] - `class`, `text`, `html`, `dataset`, `attrs` and any
 *   other key is assigned directly onto the element (e.g. `onclick`, `src`).
 * @param {Array<Node|string>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  const { class: className, text, html, dataset, attrs, ...rest } = props;

  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  if (html != null) node.innerHTML = html;
  if (dataset) Object.assign(node.dataset, dataset);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === false || value == null) continue;
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  Object.assign(node, rest);

  for (const child of [children].flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replaces all children of `parent` with `children` in a single reflow. */
export function replaceChildren(parent, children) {
  const fragment = document.createDocumentFragment();
  fragment.append(...[children].flat().filter(Boolean));
  parent.replaceChildren(fragment);
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/*
 * Grouping uses the `en-US` number format (comma thousands, dot decimal) and
 * the symbol is prefixed manually. Intl's own `en-ZA` currency output is
 * "R 6 000,00" with narrow no-break spaces — correct, but not the "R6,000"
 * house style this catalogue uses.
 */
const wholeNumberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const centsFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats a price as South African Rand, e.g. `6000 -> "R6,000"`.
 * Cents are only shown when the amount actually has them.
 *
 * @param {number|null|undefined} value
 * @returns {string} "Price on request" when there is no usable amount
 */
export function formatPrice(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Price on request';
  if (value === 0) return 'Free';

  const formatter = Number.isInteger(value) ? wholeNumberFormatter : centsFormatter;
  const sign = value < 0 ? '-' : '';
  return `${sign}${CONFIG.currency.symbol}${formatter.format(Math.abs(value))}`;
}

/** Truncates text on a word boundary and appends an ellipsis. */
export function truncate(text, maxLength = 120) {
  const value = (text || '').trim();
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Formats an ISO-ish date string for display; returns '' when unparseable. */
export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(CONFIG.currency.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Lowercase, accent-insensitive string used for searching. */
export function normaliseText(value) {
  return (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Functions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Returns a debounced version of `fn` that runs `delay` ms after the last call.
 * The returned function exposes `.cancel()` and `.flush()`.
 *
 * @template {(...args: any[]) => void} T
 * @param {T} fn
 * @param {number} delay
 */
export function debounce(fn, delay = 300) {
  let timer = null;
  let lastArgs = null;

  const debounced = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...lastArgs);
    }, delay);
  };

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  debounced.flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    fn(...lastArgs);
  };

  return debounced;
}

/** Clamps `value` into the inclusive range [min, max]. */
export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Wraps `index` around `length` so -1 becomes the last item. */
export const wrapIndex = (index, length) => (length ? ((index % length) + length) % length : 0);

/** True when the visitor asked the OS to reduce motion. */
const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -------------------------------------------------------------------------- */
/* Accessibility                                                              */
/* -------------------------------------------------------------------------- */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Visible, focusable descendants of `container`, in DOM order. */
export function getFocusable(container) {
  return qsa(FOCUSABLE, container).filter(
    (node) => !node.hasAttribute('hidden') && node.offsetParent !== null
  );
}

/**
 * Keeps Tab focus inside `container` until the returned function is called.
 * Restores focus to the previously active element on release.
 *
 * @param {HTMLElement} container
 * @returns {() => void} release
 */
export function trapFocus(container) {
  const previouslyFocused = document.activeElement;

  const onKeydown = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = getFocusable(container);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', onKeydown);

  return () => {
    container.removeEventListener('keydown', onKeydown);
    if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
      previouslyFocused.focus();
    }
  };
}

/** Prevents/restores background scrolling while an overlay is open. */
export const scrollLock = {
  count: 0,
  lock() {
    if (this.count === 0) document.body.classList.add('is-scroll-locked');
    this.count += 1;
  },
  unlock() {
    this.count = Math.max(0, this.count - 1);
    if (this.count === 0) document.body.classList.remove('is-scroll-locked');
  },
};

/**
 * Sets `hidden` on `node` only after its closing CSS transition has finished,
 * so the exit animation is visible while the element still leaves the
 * accessibility tree and the tab order afterwards.
 *
 * Re-opening the element before the transition ends cancels the hide, which is
 * why the `is-open` class is re-checked at the last moment.
 *
 * @param {HTMLElement} node
 * @param {number} [fallbackMs] safety net if no transitionend fires
 */
export function hideAfterTransition(node, fallbackMs = 260) {
  if (prefersReducedMotion()) {
    node.hidden = true;
    return;
  }

  let settled = false;

  const finish = () => {
    if (settled) return;
    settled = true;
    node.removeEventListener('transitionend', onTransitionEnd);
    if (!node.classList.contains('is-open')) node.hidden = true;
  };

  const onTransitionEnd = (event) => {
    if (event.target === node) finish();
  };

  node.addEventListener('transitionend', onTransitionEnd);
  setTimeout(finish, fallbackMs);
}

/* -------------------------------------------------------------------------- */
/* Images                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Swaps in the configured placeholder when an image fails to load.
 *
 * The listener stays attached because elements such as the modal gallery reuse
 * a single <img> for every photo; the guard on the current source is what stops
 * a failing placeholder from looping.
 *
 * @param {HTMLImageElement} image
 */
export function attachImageFallback(image) {
  image.addEventListener('error', () => {
    if (image.getAttribute('src') === CONFIG.placeholderImage) return;
    image.src = CONFIG.placeholderImage;
    image.classList.add('is-placeholder');
  });
}

/**
 * Creates an IntersectionObserver that turns `data-src` into `src` shortly
 * before an element scrolls into view, then stops watching it.
 * Falls back to eager loading where the API is unavailable.
 *
 * @param {string} [rootMargin]
 * @returns {{observe: (el: Element) => void, disconnect: () => void}}
 */
export function createLazyLoader(rootMargin = '300px 0px') {
  if (typeof IntersectionObserver === 'undefined') {
    return {
      observe: (node) => hydrateLazyImages(node),
      disconnect: () => {},
    };
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        hydrateLazyImages(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin }
  );

  return {
    observe: (node) => observer.observe(node),
    disconnect: () => observer.disconnect(),
  };
}

/** Promotes every `data-src` inside (and on) `node` to a real `src`. */
function hydrateLazyImages(node) {
  const images = node.matches?.('img[data-src]') ? [node] : qsa('img[data-src]', node);
  for (const image of images) {
    image.src = image.dataset.src;
    delete image.dataset.src;
  }
}
