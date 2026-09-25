import type { Silhouette } from '../services/drones/catalogue.js';

/**
 * Original top-down drone outlines for the map marker and the key, drawn as
 * SVG inner markup in a 64 x 64 box and filled with currentColor. Product
 * photographs are the manufacturers' copyright, so families of similar shape
 * share one drawing instead.
 */
function quad(body: string, armWidth: number, rotorR: number, extra = ''): string {
  const rotors = [[13, 13], [51, 13], [13, 51], [51, 51]];
  const arms = rotors.map(([x, y]) => `<line x1="32" y1="32" x2="${x}" y2="${y}" stroke="currentColor" stroke-width="${armWidth}" stroke-linecap="round"/>`).join('');
  const props = rotors.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${rotorR}" fill="currentColor" fill-opacity=".35"/><circle cx="${x}" cy="${y}" r="2.2" fill="currentColor"/>`).join('');
  return arms + props + body + extra;
}

export const SILHOUETTES: Record<Silhouette, string> = {
  palm: '<rect x="8" y="8" width="48" height="48" rx="14" fill="none" stroke="currentColor" stroke-width="4"/>' +
    [[21, 21], [43, 21], [21, 43], [43, 43]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8" fill="currentColor" fill-opacity=".35"/><circle cx="${x}" cy="${y}" r="2" fill="currentColor"/>`).join('') +
    '<rect x="26" y="27" width="12" height="10" rx="3" fill="currentColor"/>',
  mini: quad('<rect x="21" y="25" width="22" height="13" rx="5" fill="currentColor"/>', 3, 9),
  air: quad('<rect x="19" y="24" width="26" height="15" rx="6" fill="currentColor"/>', 4, 10, '<circle cx="32" cy="24" r="3" fill="currentColor"/>'),
  mavic: quad('<rect x="17" y="23" width="30" height="17" rx="6" fill="currentColor"/>', 5, 11, '<circle cx="32" cy="22" r="3.5" fill="currentColor"/>'),
  fpv: '<rect x="18" y="24" width="28" height="15" rx="5" fill="currentColor"/>' +
    [[13, 13], [51, 13], [13, 51], [51, 51]].map(([x, y]) => `<line x1="32" y1="32" x2="${x}" y2="${y}" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="11" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="${x}" cy="${y}" r="7" fill="currentColor" fill-opacity=".35"/>`).join('') +
    '<path d="M27 24 L32 17 L37 24 Z" fill="currentColor"/>',
  phantom: quad('<circle cx="32" cy="32" r="11" fill="currentColor"/>', 5, 10, '<circle cx="32" cy="41" r="3.5" fill="currentColor"/>'),
};

export function silhouetteSvg(family: Silhouette, size: number, colour: string): string {
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" style="color:${colour}">${SILHOUETTES[family]}</svg>`;
}
