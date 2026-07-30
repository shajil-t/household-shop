/**
 * zoom.js
 * ---------------------------------------------------------------------------
 * Zoom-and-pan behaviour for a single image inside a container.
 *
 * Self-contained on purpose: it knows nothing about the catalogue, so the same
 * controller could drive any image viewer. `modal.js` owns the lightbox chrome
 * and just calls into the API returned by {@link createZoomController}.
 *
 * Supported gestures
 *   • Wheel / trackpad scroll  — zoom towards the pointer
 *   • Double click or tap      — toggle between fit and 2.5×
 *   • Drag                     — pan, once zoomed in
 *   • Two-finger pinch         — zoom towards the midpoint
 *   • Buttons / keys           — handled by the caller via zoomIn/zoomOut/reset
 *
 * The transform is `translate(x, y) scale(s)` where x/y are screen pixels, so
 * "keep the point under the cursor still" is simple arithmetic (see zoomTo).
 */

import { clamp } from './utils.js';

/** Movement in pixels before a pointer gesture counts as a drag, not a click. */
const DRAG_THRESHOLD = 5;

/**
 * Attaches zoom + pan handling to an image.
 *
 * @param {object} options
 * @param {HTMLImageElement} options.image      the element that gets transformed
 * @param {HTMLElement} options.container       bounds used for centring and clamping
 * @param {number} [options.min]                minimum scale (1 = fit to screen)
 * @param {number} [options.max]                maximum scale
 * @param {number} [options.step]               increment for the +/- controls
 * @param {number} [options.doubleTapScale]     scale a double click jumps to
 * @param {(state: {scale: number, min: number, max: number, zoomed: boolean}) => void} [options.onChange]
 * @returns {{
 *   zoomIn: () => void,
 *   zoomOut: () => void,
 *   reset: (options?: {silent?: boolean}) => void,
 *   isZoomed: () => boolean,
 *   getScale: () => number,
 *   destroy: () => void,
 * }}
 */
export function createZoomController({
  image,
  container,
  min = 1,
  max = 5,
  step = 0.5,
  doubleTapScale = 2.5,
  onChange = () => {},
}) {
  /** Current transform. `x`/`y` are screen-pixel offsets from the centred position. */
  const state = { scale: min, x: 0, y: 0 };

  /** Active pointers, so pan and pinch can share one set of listeners. */
  const pointers = new Map();

  /** Single-pointer pan bookkeeping. */
  let panFrom = null;

  /** Two-pointer pinch bookkeeping. */
  let pinchFrom = null;

  /** True once a gesture has moved far enough to be a drag, not a click. */
  let dragged = false;

  /** Where the current gesture started, for the drag/click decision. */
  let gestureStart = null;

  /* ------------------------------------------------------------------------ */
  /* Transform plumbing                                                       */
  /* ------------------------------------------------------------------------ */

  /** Half the distance the image can travel before its edge enters the frame. */
  function panBounds(scale = state.scale) {
    const frame = container.getBoundingClientRect();
    // offsetWidth/Height are layout sizes, unaffected by the CSS transform.
    const overflowX = image.offsetWidth * scale - frame.width;
    const overflowY = image.offsetHeight * scale - frame.height;
    return {
      x: Math.max(0, overflowX / 2),
      y: Math.max(0, overflowY / 2),
    };
  }

  /** Keeps the image from being dragged away from the frame. */
  function clampOffsets() {
    const bounds = panBounds();
    state.x = clamp(state.x, -bounds.x, bounds.x);
    state.y = clamp(state.y, -bounds.y, bounds.y);
  }

  /** Writes the current state to the DOM. */
  function apply({ silent = false } = {}) {
    clampOffsets();
    image.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;

    const zoomed = state.scale > min + 0.001;
    image.classList.toggle('is-zoomed', zoomed);

    if (!silent) onChange({ scale: state.scale, min, max, zoomed });
  }

  /**
   * Zooms to `nextScale`, keeping the point at (`clientX`, `clientY`) still.
   *
   * With `translate(T) scale(s)` about the element's centre C, a local point p
   * lands at `C + T + s·p`. Solving for the T that keeps p under the cursor:
   *   d  = cursor − C
   *   T₁ = d − (s₁/s₀)·(d − T₀)
   */
  function zoomTo(nextScale, clientX, clientY) {
    const target = clamp(nextScale, min, max);
    if (Math.abs(target - state.scale) < 0.0001) return;

    const frame = container.getBoundingClientRect();
    const centreX = frame.left + frame.width / 2;
    const centreY = frame.top + frame.height / 2;

    const ratio = target / state.scale;
    const dx = (clientX ?? centreX) - centreX;
    const dy = (clientY ?? centreY) - centreY;

    state.x = dx - ratio * (dx - state.x);
    state.y = dy - ratio * (dy - state.y);
    state.scale = target;

    // Returning to fit recentres, so no stale offset survives.
    if (state.scale <= min + 0.001) {
      state.x = 0;
      state.y = 0;
    }

    apply();
  }

  /* ------------------------------------------------------------------------ */
  /* Gestures                                                                 */
  /* ------------------------------------------------------------------------ */

  function onWheel(event) {
    // Both plain wheel and the ctrl+wheel a trackpad pinch produces.
    event.preventDefault();

    // deltaMode 1 = lines, 2 = pages; normalise everything to rough pixels.
    const perLine = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    const delta = event.deltaY * perLine;
    const factor = Math.exp(-delta * 0.0022);

    zoomTo(state.scale * factor, event.clientX, event.clientY);
  }

  function onDoubleClick(event) {
    event.preventDefault();
    const zoomed = state.scale > min + 0.001;
    if (zoomed) reset();
    else zoomTo(doubleTapScale, event.clientX, event.clientY);
  }

  function onPointerDown(event) {
    // Ignore secondary mouse buttons; they open context menus.
    if (event.button !== 0 && event.pointerType === 'mouse') return;

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragged = false;
    gestureStart = { x: event.clientX, y: event.clientY };

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchFrom = { distance: distanceBetween(a, b), scale: state.scale };
      panFrom = null;
      return;
    }

    if (pointers.size === 1 && state.scale > min + 0.001) {
      panFrom = { x: event.clientX - state.x, y: event.clientY - state.y };
      // Capture so the pointer keeps reporting to the image even when the
      // cursor leaves it — and so the trailing click lands here, not on the
      // scrim (which would close the viewer mid-pan).
      image.setPointerCapture(event.pointerId);
      image.classList.add('is-panning');
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (!dragged && gestureStart) {
      const travelled = Math.hypot(event.clientX - gestureStart.x, event.clientY - gestureStart.y);
      dragged = travelled > DRAG_THRESHOLD;
    }

    if (pointers.size >= 2 && pinchFrom) {
      const [a, b] = [...pointers.values()];
      const distance = distanceBetween(a, b);
      if (distance > 0) {
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        zoomTo(pinchFrom.scale * (distance / pinchFrom.distance), midX, midY);
      }
      return;
    }

    if (panFrom) {
      state.x = event.clientX - panFrom.x;
      state.y = event.clientY - panFrom.y;
      apply({ silent: true });
    }
  }

  function onPointerUp(event) {
    pointers.delete(event.pointerId);

    if (image.hasPointerCapture?.(event.pointerId)) {
      image.releasePointerCapture(event.pointerId);
    }

    if (pointers.size < 2) pinchFrom = null;
    if (pointers.size === 0) {
      panFrom = null;
      gestureStart = null;
      image.classList.remove('is-panning');
    } else if (pointers.size === 1 && state.scale > min + 0.001) {
      // A finger lifted mid-pinch: continue as a pan from where it is now.
      const [remaining] = [...pointers.values()];
      panFrom = { x: remaining.x - state.x, y: remaining.y - state.y };
    }
  }

  /**
   * Swallows the click that ends a drag, so panning never counts as a click on
   * the scrim (which closes the viewer).
   */
  function onClickCapture(event) {
    if (!dragged) return;
    event.stopPropagation();
    event.preventDefault();
    dragged = false;
  }

  const distanceBetween = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /* ------------------------------------------------------------------------ */
  /* Public API                                                               */
  /* ------------------------------------------------------------------------ */

  const zoomIn = () => zoomTo(state.scale + step);
  const zoomOut = () => zoomTo(state.scale - step);

  /** Returns to fit-to-screen and clears any pan. */
  function reset({ silent = false } = {}) {
    state.scale = min;
    state.x = 0;
    state.y = 0;
    pointers.clear();
    panFrom = null;
    pinchFrom = null;
    gestureStart = null;
    dragged = false;
    image.classList.remove('is-panning');
    apply({ silent });
  }

  /* --- Wiring ------------------------------------------------------------- */

  // `passive: false` because zooming must cancel the page scroll.
  container.addEventListener('wheel', onWheel, { passive: false });
  image.addEventListener('dblclick', onDoubleClick);
  image.addEventListener('pointerdown', onPointerDown);
  image.addEventListener('pointermove', onPointerMove);
  image.addEventListener('pointerup', onPointerUp);
  image.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('click', onClickCapture, { capture: true });
  // The browser's own image drag would fight with panning.
  image.addEventListener('dragstart', (event) => event.preventDefault());

  apply({ silent: true });

  return {
    zoomIn,
    zoomOut,
    reset,
    isZoomed: () => state.scale > min + 0.001,
    getScale: () => state.scale,
    destroy() {
      container.removeEventListener('wheel', onWheel);
      image.removeEventListener('dblclick', onDoubleClick);
      image.removeEventListener('pointerdown', onPointerDown);
      image.removeEventListener('pointermove', onPointerMove);
      image.removeEventListener('pointerup', onPointerUp);
      image.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('click', onClickCapture, { capture: true });
      image.style.transform = '';
      image.classList.remove('is-zoomed', 'is-panning');
    },
  };
}

export default createZoomController;
