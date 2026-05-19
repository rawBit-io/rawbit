// src/components/introDropCursor.ts
// Shared geometry for the intro-drop fake cursor.

/**
 * Screen offset of the pointer's sharp tip relative to the cursor wrapper's
 * top-left origin. The SVG path apex is (4,3) in a 24-unit viewBox rendered
 * at 22px, i.e. ~(3.7, 2.8). Offsetting a cursor target by this amount lands
 * the tip (and the connection-wire end) exactly on a handle centre.
 */
export const CURSOR_TIP_OFFSET = { x: 4, y: 3 };
