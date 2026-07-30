/**
 * icons.js
 * ---------------------------------------------------------------------------
 * Inline SVG icon set. Keeping the markup here means no icon font, no sprite
 * request and no third-party dependency — and every icon inherits `currentColor`.
 *
 * Icons are decorative by default (`aria-hidden`); label the control instead.
 */

/** Wraps path markup in a consistently sized, accessible-by-default <svg>. */
const svg = (paths, { viewBox = '0 0 24 24', fill = 'none' } = {}) =>
  `<svg class="icon" viewBox="${viewBox}" fill="${fill}" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

export const ICONS = Object.freeze({
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),

  filter: svg('<path d="M3 6h18M6 12h12M10 18h4"/>'),

  sort: svg('<path d="M4 7h10M4 12h7M4 17h4M17 4v16M17 20l3-3M17 20l-3-3"/>'),

  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),

  chevronLeft: svg('<path d="M15 5l-7 7 7 7"/>'),

  chevronRight: svg('<path d="M9 5l7 7-7 7"/>'),

  arrowUp: svg('<path d="M12 20V4M5 11l7-7 7 7"/>'),

  pin: svg('<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>'),

  tag: svg('<path d="M20.5 13.5 13 21a2 2 0 0 1-2.8 0L3 13.8V4h9.8l7.7 7.7a2 2 0 0 1 0 1.8Z"/><circle cx="8" cy="8.5" r="1.4"/>'),

  sparkle: svg('<path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z"/>'),

  expand: svg('<path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5"/>'),

  /* Fit-to-screen: arrows pointing inwards. */
  contract: svg('<path d="M4 9h5V4M20 9h-5V4M20 15h-5v5M4 15h5v5"/>'),

  zoomIn: svg('<circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M20 20l-3.5-3.5"/>'),

  zoomOut: svg('<circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-3.5-3.5"/>'),

  check: svg('<path d="M5 13l4 4L19 7"/>'),

  share: svg(
    '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/>' +
      '<path d="m8.4 10.7 7.2-4.2M8.4 13.3l7.2 4.2"/>'
  ),

  /* Stack of coins — used for "Make an Offer". */
  offer: svg(
    '<ellipse cx="12" cy="6.5" rx="7" ry="3"/>' +
      '<path d="M5 6.5v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5"/>' +
      '<path d="M5 11.5v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5"/>'
  ),

  /* Brand glyph — filled, so it opts out of the shared stroke treatment. */
  whatsapp: `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.16-1.35a9.9 9.9 0 0 0 4.88 1.27h.01c5.5 0 9.96-4.46 9.96-9.96S17.54 2 12.04 2Zm0 18.16h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.1.81.83-3.02-.2-.31a8.18 8.18 0 0 1-1.25-4.35 8.28 8.28 0 0 1 14.13-5.85 8.2 8.2 0 0 1 2.42 5.86c0 4.56-3.72 8.19-8.34 8.19Zm4.5-6.13c-.25-.13-1.5-.74-1.73-.82-.23-.09-.4-.13-.57.13-.17.25-.66.82-.81 1-.15.16-.3.19-.55.06a6.7 6.7 0 0 1-1.97-1.22 7.4 7.4 0 0 1-1.37-1.7c-.14-.25-.02-.39.11-.51.11-.12.25-.31.37-.47.12-.16.16-.27.25-.44.08-.17.04-.32-.02-.45-.06-.13-.56-1.38-.77-1.88-.2-.5-.4-.43-.56-.44h-.48c-.16 0-.42.06-.64.31-.22.25-.84.82-.84 2 0 1.19.86 2.33.98 2.49.12.17 1.7 2.6 4.1 3.55.57.25 1.02.4 1.37.5.58.19 1.1.16 1.52.1.46-.07 1.42-.58 1.62-1.15.2-.56.2-1.05.14-1.15-.06-.1-.22-.16-.47-.29Z"/>
    </svg>`,

  /* Empty-state illustration: a stack of packed-up boxes. */
  emptyBoxes: `<svg class="empty-state__art" viewBox="0 0 220 160" role="img"
      aria-label="An empty stack of moving boxes" fill="none" stroke="currentColor"
      stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M40 74h64v58H40zM116 88h64v44h-64z" />
      <path d="M40 74l10-16h44l10 16M116 88l8-12h48l8 12" />
      <path d="M72 74v58M148 88v44" stroke-dasharray="6 8" />
      <circle cx="164" cy="44" r="16" />
      <path d="m176 56 12 12" />
    </svg>`,
});

export default ICONS;
