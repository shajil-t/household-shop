/**
 * modal.js
 * ---------------------------------------------------------------------------
 * The item detail overlay and its full-screen lightbox.
 *
 * The markup lives in index.html (so it is styleable and accessible without
 * JavaScript having to invent structure); this module owns the behaviour:
 * gallery navigation, thumbnails, keyboard shortcuts, focus trapping and the
 * WhatsApp deep link.
 */

import { CONFIG } from './config.js';
import { ICONS } from './icons.js';
import {
  attachImageFallback,
  el,
  formatDate,
  formatPrice,
  hideAfterTransition,
  qs,
  replaceChildren,
  scrollLock,
  trapFocus,
  wrapIndex,
} from './utils.js';
import { setCarouselsPaused } from './render.js';
import { createZoomController } from './zoom.js';

const STATUS_LABELS = Object.freeze({
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
});

/** How long the "Link copied" confirmation stays on the share button. */
const SHARE_FEEDBACK_MS = 2200;

/** Cached element references, resolved once in {@link initModal}. */
let dom = null;

/** Timer id for resetting the share button label. */
let shareFeedbackTimer = null;

/** Everything about the currently open item. */
const session = {
  open: false,
  item: null,
  images: [],
  index: 0,
  releaseFocus: null,
  /** True while the "Make an Offer" form is expanded. */
  bidOpen: false,
};

/** Lightbox state (it can be open on top of the modal). */
const lightbox = {
  open: false,
  releaseFocus: null,
  /** Zoom/pan controller for the full-screen image; created in initModal. */
  zoom: null,
};

/* -------------------------------------------------------------------------- */
/* Initialisation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Caches DOM references and wires every modal/lightbox interaction.
 * Safe to call once, on page load.
 */
export function initModal() {
  dom = {
    modal: qs('#item-modal'),
    dialog: qs('#modal-dialog'),
    close: qs('#modal-close'),
    image: qs('#modal-image'),
    badge: qs('#modal-badge'),
    counter: qs('#modal-counter'),
    prev: qs('#modal-prev'),
    next: qs('#modal-next'),
    zoom: qs('#modal-zoom'),
    thumbs: qs('#modal-thumbs'),
    category: qs('#modal-category'),
    title: qs('#modal-title'),
    price: qs('#modal-price'),
    specs: qs('#modal-specs'),
    description: qs('#modal-description'),
    whatsapp: qs('#modal-whatsapp'),
    bid: qs('#modal-bid'),
    share: qs('#modal-share'),
    shareLabel: qs('#share-label'),
    bidPanel: qs('#bid-panel'),
    bidHint: qs('#bid-hint'),
    bidAmount: qs('#bid-amount'),
    bidError: qs('#bid-error'),
    bidCancel: qs('#bid-cancel'),
    lightbox: qs('#lightbox'),
    lightboxImage: qs('#lightbox-image'),
    lightboxCounter: qs('#lightbox-counter'),
    zoomIn: qs('#zoom-in'),
    zoomOut: qs('#zoom-out'),
    zoomReset: qs('#zoom-reset'),
    zoomLevel: qs('#zoom-level'),
  };

  attachImageFallback(dom.image);

  // Icon buttons get their glyphs from the shared icon set.
  qs('#modal-prev').innerHTML = ICONS.chevronLeft;
  qs('#modal-next').innerHTML = ICONS.chevronRight;
  qs('#modal-close').innerHTML = ICONS.close;
  qs('#modal-zoom').innerHTML = ICONS.expand;
  qs('#lightbox-prev').innerHTML = ICONS.chevronLeft;
  qs('#lightbox-next').innerHTML = ICONS.chevronRight;
  qs('#lightbox-close').innerHTML = ICONS.close;
  qs('#whatsapp-icon').innerHTML = ICONS.whatsapp;
  qs('#bid-icon').innerHTML = ICONS.offer;
  qs('#bid-submit-icon').innerHTML = ICONS.whatsapp;
  qs('#share-icon').innerHTML = ICONS.share;
  qs('#zoom-in').innerHTML = ICONS.zoomIn;
  qs('#zoom-out').innerHTML = ICONS.zoomOut;
  qs('#zoom-reset').innerHTML = ICONS.contract;

  /* --- Item modal -------------------------------------------------------- */

  // A single delegated handler covers the close button, the scrim and any
  // future [data-close] control.
  dom.modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) closeModal();
  });

  dom.prev.addEventListener('click', () => step(-1));
  dom.next.addEventListener('click', () => step(1));
  dom.zoom.addEventListener('click', () => openLightbox());
  dom.image.addEventListener('click', () => openLightbox());

  dom.thumbs.addEventListener('click', (event) => {
    const thumb = event.target.closest('[data-index]');
    if (thumb) showImage(Number(thumb.dataset.index));
  });

  /* --- Actions: offer & share -------------------------------------------- */

  dom.bid.addEventListener('click', () => toggleBidPanel(!session.bidOpen));
  dom.bidCancel.addEventListener('click', () => toggleBidPanel(false));
  dom.bidPanel.addEventListener('submit', onBidSubmit);
  // Clear a stale validation message as soon as the visitor edits the amount.
  dom.bidAmount.addEventListener('input', () => showBidError(''));
  dom.share.addEventListener('click', shareItem);

  /* --- Lightbox ---------------------------------------------------------- */

  dom.lightbox.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) {
      closeLightbox();
      return;
    }
    const nav = event.target.closest('[data-step]');
    if (nav) step(Number(nav.dataset.step));
  });

  attachImageFallback(dom.lightboxImage);

  /* --- Lightbox zoom ----------------------------------------------------- */

  lightbox.zoom = createZoomController({
    image: dom.lightboxImage,
    container: dom.lightbox,
    onChange: paintZoomLevel,
  });
  // A non-silent reset paints the readout and the button states once, up front.
  lightbox.zoom.reset();

  // "Scroll to zoom" is meaningless on a phone; describe the real gesture.
  if (window.matchMedia('(hover: none)').matches) {
    qs('#lightbox-hint').textContent = 'Pinch or double-tap to zoom · drag to move';
  }

  // One delegated handler for the three zoom buttons.
  dom.lightbox.addEventListener('click', (event) => {
    const action = event.target.closest('[data-zoom]')?.dataset.zoom;
    if (!action) return;
    if (action === 'in') lightbox.zoom.zoomIn();
    else if (action === 'out') lightbox.zoom.zoomOut();
    else lightbox.zoom.reset();
  });

  /* --- Keyboard ---------------------------------------------------------- */

  // One document-level listener handles both layers; the deepest open layer
  // wins, so ESC closes the lightbox before the modal.
  document.addEventListener('keydown', onKeydown);
}

/** Global key handling for the two overlay layers. */
function onKeydown(event) {
  if (!isOpen()) return;

  switch (event.key) {
    case 'Escape':
      event.preventDefault();
      if (lightbox.open) closeLightbox();
      else if (session.bidOpen) toggleBidPanel(false);
      else closeModal();
      break;
    case 'ArrowLeft':
      if (session.images.length > 1 && !session.bidOpen) {
        event.preventDefault();
        step(-1);
      }
      break;
    case 'ArrowRight':
      if (session.images.length > 1 && !session.bidOpen) {
        event.preventDefault();
        step(1);
      }
      break;
    // Zoom shortcuts only make sense while the full-screen viewer is up.
    case '+':
    case '=':
      if (lightbox.open) {
        event.preventDefault();
        lightbox.zoom.zoomIn();
      }
      break;
    case '-':
    case '_':
      if (lightbox.open) {
        event.preventDefault();
        lightbox.zoom.zoomOut();
      }
      break;
    case '0':
      if (lightbox.open) {
        event.preventDefault();
        lightbox.zoom.reset();
      }
      break;
    default:
      break;
  }
}

/* -------------------------------------------------------------------------- */
/* Open / close                                                               */
/* -------------------------------------------------------------------------- */

/**
 * True while the detail modal is logically open. Tracked explicitly rather
 * than read off `hidden`, because the element stays in the DOM for the length
 * of its closing transition.
 */
export const isOpen = () => session.open;

/**
 * Opens the detail modal for an item.
 * @param {object} item a normalised catalogue item
 */
export function openModal(item) {
  if (!dom || !item) return;

  session.open = true;
  session.item = item;
  session.images = item.images.length ? [...item.images] : [CONFIG.placeholderImage];
  session.index = 0;

  paintDetails(item);
  paintThumbs();
  showImage(0, { force: true });

  dom.modal.hidden = false;
  // Let the browser apply `hidden = false` before the entrance transition.
  requestAnimationFrame(() => dom.modal.classList.add('is-open'));

  scrollLock.lock();
  setCarouselsPaused(true);
  setItemHash(item.id);
  session.releaseFocus = trapFocus(dom.dialog);
  dom.close.focus({ preventScroll: true });
}

/** Closes the modal (and the lightbox, if it is open). */
export function closeModal() {
  if (!isOpen()) return;
  if (lightbox.open) closeLightbox();

  session.open = false;
  toggleBidPanel(false, { focus: false });
  dom.modal.classList.remove('is-open');
  hideAfterTransition(dom.modal);
  clearItemHash();

  scrollLock.unlock();
  setCarouselsPaused(false);

  session.releaseFocus?.();
  session.releaseFocus = null;
  session.item = null;
  session.images = [];
}

/* -------------------------------------------------------------------------- */
/* Deep linking                                                               */
/* -------------------------------------------------------------------------- */

/*
 * The open item lives in the URL fragment (`#item=fridge-001`) rather than the
 * query string, so it composes with the filter parameters that filters.js owns
 * — `stateToUrl()` preserves whatever fragment is present.
 *
 * `replaceState` is used deliberately: a shared link still works, but browsing
 * items does not fill the visitor's Back button with modal states.
 */

/** Records the open item in the URL fragment. */
function setItemHash(id) {
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', `${pathname}${search}#item=${encodeURIComponent(id)}`);
}

/** Removes an item fragment (leaving any other fragment untouched). */
function clearItemHash() {
  if (!itemIdFromUrl()) return;
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', `${pathname}${search}`);
}

/**
 * The item id named in a URL fragment, if any.
 * @param {string} [hash] defaults to the current `location.hash`
 * @returns {string|null}
 */
export function itemIdFromUrl(hash = window.location.hash) {
  const match = /^#item=(.+)$/.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null; // Malformed percent-encoding in a hand-edited URL.
  }
}

/* -------------------------------------------------------------------------- */
/* Painting                                                                   */
/* -------------------------------------------------------------------------- */

/** Writes the item's text content into the modal. */
function paintDetails(item) {
  dom.category.textContent = item.category;
  dom.title.textContent = item.title;
  dom.price.textContent = formatPrice(item.price);

  const statusLabel = STATUS_LABELS[item.status] ?? item.status;
  dom.badge.textContent = statusLabel;
  dom.badge.className = `badge badge--${item.status}`;
  dom.badge.hidden = item.status === 'available';

  dom.description.textContent = item.description || 'No further description was provided for this item.';

  renderSpecs(item, statusLabel);
  renderActions(item);
}

/** Fills the definition list of item attributes. */
function renderSpecs(item, statusLabel) {
  const rows = [
    ['Status', statusLabel],
    ['Condition', item.condition],
    ['Category', item.category],
    ['Collection area', item.location],
    ['Listed', formatDate(item.dateAdded)],
  ].filter(([, value]) => Boolean(value));

  replaceChildren(
    dom.specs,
    rows.flatMap(([label, value]) => [
      el('dt', { class: 'specs__label', text: label }),
      el('dd', { class: 'specs__value', text: value }),
    ])
  );
}

/* -------------------------------------------------------------------------- */
/* Actions: contact, offer, share                                             */
/* -------------------------------------------------------------------------- */

/** The seller's WhatsApp number, digits only ('' when not configured). */
const sellerNumber = () => (CONFIG.whatsappNumber || '').replace(/\D/g, '');

/** True when the item can still be enquired about. */
const isContactable = (item) => Boolean(sellerNumber()) && item.status !== 'sold';

/**
 * A shareable absolute link that reopens this item.
 * Filters are deliberately left out — the recipient should see the item, not
 * inherit the sender's search.
 * @param {object} item
 * @returns {string}
 */
function itemUrl(item) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = `item=${encodeURIComponent(item.id)}`;
  return url.toString();
}

/**
 * Builds a `wa.me` deep link with a pre-filled message.
 * @param {object} item
 * @param {number|null} [offer] an offer amount; omitted for a plain enquiry
 * @returns {string}
 */
function whatsappUrl(item, offer = null) {
  const asking = formatPrice(item.price);

  const message =
    offer === null
      ? `Hi! I'm interested in the "${item.title}" (${asking}) listed on ${CONFIG.siteName}. ` +
        `Is it still available?\n\n${itemUrl(item)}`
      : `Hi! I'd like to make an offer on the "${item.title}" listed on ${CONFIG.siteName}.\n\n` +
        `Asking price: ${asking}\nMy offer: ${formatPrice(offer)}\n\n` +
        `Would you accept that?\n\n${itemUrl(item)}`;

  return `https://wa.me/${sellerNumber()}?text=${encodeURIComponent(message)}`;
}

/**
 * Sets up the action row for an item: the contact link, the offer button and
 * the always-available share button.
 *
 * Contact and offer both need WhatsApp and an unsold item; share does not, so a
 * sold listing can still be passed on to someone else.
 */
function renderActions(item) {
  const contactable = isContactable(item);

  dom.whatsapp.hidden = !contactable;
  dom.bid.hidden = !contactable || !CONFIG.allowOffers;

  if (contactable) {
    dom.whatsapp.href = whatsappUrl(item);
    dom.whatsapp.setAttribute('aria-label', `Contact the seller on WhatsApp about ${item.title}`);
    dom.bid.setAttribute('aria-label', `Make an offer on ${item.title}`);
  }

  dom.share.setAttribute('aria-label', `Share ${item.title}`);
  resetShareLabel();

  // Every item starts with the offer form collapsed and empty.
  toggleBidPanel(false, { focus: false });
  dom.bidAmount.value = '';
  showBidError('');
  dom.bidHint.textContent =
    typeof item.price === 'number' && item.price > 0
      ? `Asking price ${formatPrice(item.price)}. Your offer is sent to the seller on WhatsApp — nothing is charged here.`
      : 'Your offer is sent to the seller on WhatsApp — nothing is charged here.';
}

/* --- Offer ---------------------------------------------------------------- */

/**
 * Expands or collapses the offer form.
 * @param {boolean} open
 * @param {{focus?: boolean}} [options] set `focus:false` during a repaint
 */
function toggleBidPanel(open, { focus = true } = {}) {
  session.bidOpen = open;
  dom.bid.setAttribute('aria-expanded', String(open));

  if (open) {
    dom.bidPanel.hidden = false;
    if (focus) dom.bidAmount.focus({ preventScroll: false });
    return;
  }

  dom.bidPanel.hidden = true;
  showBidError('');
  // Returning focus to the trigger keeps keyboard users oriented.
  if (focus && !dom.bid.hidden) dom.bid.focus({ preventScroll: true });
}

/** Shows (or clears, with an empty string) the offer validation message. */
function showBidError(message) {
  dom.bidError.textContent = message;
  dom.bidError.hidden = !message;
  dom.bidAmount.setAttribute('aria-invalid', message ? 'true' : 'false');
}

/**
 * Validates the typed offer and opens WhatsApp with it.
 * Runs on form submit, so Enter in the field works as well as the button.
 */
function onBidSubmit(event) {
  event.preventDefault();
  if (!session.item) return;

  const amount = Number.parseFloat(dom.bidAmount.value.replace(/[\s,]/g, ''));

  if (!Number.isFinite(amount)) {
    showBidError('Enter the amount you would like to offer.');
    dom.bidAmount.focus();
    return;
  }
  if (amount <= 0) {
    showBidError('Your offer must be more than R0.');
    dom.bidAmount.focus();
    return;
  }
  if (amount > 10_000_000) {
    showBidError('That offer looks too large — please check the amount.');
    dom.bidAmount.focus();
    return;
  }

  // Round to cents so "1234.567" cannot reach the seller.
  const offer = Math.round(amount * 100) / 100;
  window.open(whatsappUrl(session.item, offer), '_blank', 'noopener,noreferrer');
  toggleBidPanel(false);
}

/* --- Share ---------------------------------------------------------------- */

/** Restores the share button to its idle label. */
function resetShareLabel() {
  clearTimeout(shareFeedbackTimer);
  shareFeedbackTimer = null;
  dom.shareLabel.textContent = 'Share';
  dom.share.classList.remove('is-success');
}

/** Briefly confirms the outcome of a share on the button itself. */
function flashShareLabel(text, { success = true } = {}) {
  clearTimeout(shareFeedbackTimer);
  dom.shareLabel.textContent = text;
  dom.share.classList.toggle('is-success', success);
  shareFeedbackTimer = setTimeout(resetShareLabel, SHARE_FEEDBACK_MS);
}

/**
 * Shares the item through the native share sheet where it exists (which is how
 * a phone offers WhatsApp, Messages, email and so on), and falls back to
 * copying the link on desktop browsers.
 */
async function shareItem() {
  const item = session.item;
  if (!item) return;

  const url = itemUrl(item);
  const title = `${item.title} — ${formatPrice(item.price)}`;
  const text = `${title}\n${CONFIG.siteName}`;

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (error) {
      // A cancelled share sheet is not a failure — say nothing and stop.
      if (error?.name === 'AbortError') return;
      console.warn('[modal] Native share failed, copying the link instead.', error);
    }
  }

  const copied = await copyToClipboard(url);
  flashShareLabel(copied ? 'Link copied' : 'Copy failed', { success: copied });
}

/**
 * Copies text to the clipboard, falling back to a hidden textarea for browsers
 * without the async Clipboard API (or on insecure origins).
 * @param {string} value
 * @returns {Promise<boolean>} whether the copy succeeded
 */
async function copyToClipboard(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (error) {
    console.warn('[modal] Clipboard API refused, trying the legacy path.', error);
  }

  try {
    const field = el('textarea', {
      value,
      attrs: { readonly: true, 'aria-hidden': 'true', tabindex: '-1' },
    });
    field.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch (error) {
    console.warn('[modal] Could not copy the link.', error);
    return false;
  }
}

/** Renders the thumbnail strip (hidden for single-image items). */
function paintThumbs() {
  const multiple = session.images.length > 1;

  dom.thumbs.hidden = !multiple;
  dom.prev.hidden = !multiple;
  dom.next.hidden = !multiple;
  dom.counter.hidden = !multiple;

  if (!multiple) {
    replaceChildren(dom.thumbs, []);
    return;
  }

  replaceChildren(
    dom.thumbs,
    session.images.map((src, index) => {
      const image = el('img', {
        src,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
      });
      attachImageFallback(image);

      return el(
        'button',
        {
          class: 'thumb',
          type: 'button',
          dataset: { index: String(index) },
          attrs: {
            'aria-label': `Show photo ${index + 1} of ${session.images.length}`,
            'aria-current': index === 0 ? 'true' : 'false',
          },
        },
        [image]
      );
    })
  );
}

/**
 * Shows image `index` in the gallery (and the lightbox when it is open).
 * @param {number} index wrapped into range
 * @param {{force?: boolean}} [options]
 */
function showImage(index, { force = false } = {}) {
  const next = wrapIndex(index, session.images.length);
  if (!force && next === session.index) return;

  session.index = next;
  const src = session.images[next];

  // Fade the swap: drop the class, set the source, restore it on load.
  dom.image.classList.remove('is-loaded', 'is-placeholder');
  dom.image.src = src;
  dom.image.alt = `${session.item?.title ?? 'Item'} — photo ${next + 1} of ${session.images.length}`;
  if (dom.image.complete) dom.image.classList.add('is-loaded');
  else dom.image.addEventListener('load', () => dom.image.classList.add('is-loaded'), { once: true });

  dom.counter.textContent = `${next + 1} / ${session.images.length}`;

  for (const thumb of dom.thumbs.children) {
    const isActive = Number(thumb.dataset.index) === next;
    thumb.setAttribute('aria-current', isActive ? 'true' : 'false');
    if (isActive) thumb.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  if (lightbox.open) {
    // A new photo always starts fit-to-screen.
    lightbox.zoom.reset();
    dom.lightboxImage.classList.remove('is-placeholder');
    dom.lightboxImage.src = src;
    dom.lightboxImage.alt = dom.image.alt;
    dom.lightboxCounter.textContent = dom.counter.textContent;
  }
}

/** Moves the gallery by `delta` images. */
function step(delta) {
  if (session.images.length > 1) showImage(session.index + delta);
}

/* -------------------------------------------------------------------------- */
/* Lightbox                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Reflects the zoom level in the toolbar.
 *
 * Limits are shown with `aria-disabled` rather than `disabled`, so a button the
 * visitor is currently focused on never drops out of the focus trap when it
 * reaches a limit. Out-of-range calls are no-ops in the controller anyway.
 *
 * @param {{scale: number, min: number, max: number}} state
 */
function paintZoomLevel({ scale, min, max }) {
  dom.zoomLevel.value = `${Math.round(scale * 100)}%`;

  const atMin = scale <= min + 0.001;
  const atMax = scale >= max - 0.001;

  dom.zoomOut.setAttribute('aria-disabled', String(atMin));
  dom.zoomReset.setAttribute('aria-disabled', String(atMin));
  dom.zoomIn.setAttribute('aria-disabled', String(atMax));
}

/** Opens the full-screen viewer on the current image. */
function openLightbox() {
  if (!isOpen() || lightbox.open) return;

  lightbox.zoom.reset();
  dom.lightboxImage.classList.remove('is-placeholder');
  dom.lightboxImage.src = session.images[session.index];
  dom.lightboxImage.alt = dom.image.alt;
  dom.lightboxCounter.textContent = `${session.index + 1} / ${session.images.length}`;
  dom.lightboxCounter.hidden = session.images.length < 2;

  dom.lightbox.hidden = false;
  requestAnimationFrame(() => dom.lightbox.classList.add('is-open'));

  lightbox.open = true;
  scrollLock.lock();
  lightbox.releaseFocus = trapFocus(dom.lightbox);
  qs('#lightbox-close').focus({ preventScroll: true });
}

/** Closes the full-screen viewer, returning focus to the modal. */
function closeLightbox() {
  if (!lightbox.open) return;

  dom.lightbox.classList.remove('is-open');
  hideAfterTransition(dom.lightbox);
  lightbox.open = false;
  lightbox.zoom.reset({ silent: true });

  scrollLock.unlock();
  lightbox.releaseFocus?.();
  lightbox.releaseFocus = null;
}
