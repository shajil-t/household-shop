/**
 * config.js
 * ---------------------------------------------------------------------------
 * The single place to configure the front end of the catalogue.
 * Edit the values below, commit, and the site updates.
 *
 * NOTE: the Google Sheet URL used by the sync script lives separately in
 * `scripts/sheet.config.json` (it is a build-time concern, not a browser one).
 */

export const CONFIG = Object.freeze({
  /** Shown in the header, the page title and the WhatsApp message. */
  siteName: 'Household Clearance Sale',

  /** Short tagline under the site title. */
  tagline: 'Everything must go — collection from the seller, cash on pickup.',

  /**
   * Seller WhatsApp number in international format, digits only.
   * South Africa: drop the leading 0 and prefix 27 (e.g. 082 123 4567 -> 27821234567).
   * Set to an empty string to hide the "Contact Seller" button entirely.
   */
  whatsappNumber: '27820000000',

  /**
   * Show the "Make an Offer" button in the item modal. Offers are sent as a
   * WhatsApp message, so this has no effect when `whatsappNumber` is empty.
   */
  allowOffers: true,

  /** Path to the generated catalogue data (relative to index.html). */
  dataUrl: 'data/items.json',

  /** Milliseconds each carousel slide stays visible on a card. */
  carouselInterval: 4000,

  /** Debounce delay (ms) applied to the search input. */
  searchDebounce: 300,

  /** Fallback image used when an item has no images, or an image 404s. */
  placeholderImage: 'images/placeholder.svg',

  /** Currency formatting. */
  currency: Object.freeze({
    locale: 'en-ZA',
    code: 'ZAR',
    /** Symbol used for the compact "R6,000" style output. */
    symbol: 'R',
  }),

  /** Sort options rendered into the sort dropdown, in order. */
  sortOptions: Object.freeze([
    { value: 'newest', label: 'Newest first' },
    { value: 'price-asc', label: 'Price: low to high' },
    { value: 'price-desc', label: 'Price: high to low' },
    { value: 'alpha', label: 'Alphabetical (A–Z)' },
  ]),

  /** Default sort applied on first load. */
  defaultSort: 'newest',

  /** Status values understood by the UI, in the order shown in the filters. */
  statuses: Object.freeze([
    { value: 'available', label: 'Available' },
    { value: 'reserved', label: 'Reserved' },
    { value: 'sold', label: 'Sold' },
  ]),
});

export default CONFIG;
