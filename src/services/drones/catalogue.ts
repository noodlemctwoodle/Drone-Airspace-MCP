/**
 * Curated catalogue of consumer drones sold in the UK, with take-off weight and
 * class mark. There is no machine-readable source for this: EASA and the CAA
 * publish lists as web pages and manufacturers as product pages, so the list is
 * maintained by hand like the byelaw seed. Add a model with its `verified`
 * date and a note on where the class mark was confirmed. When a class mark has
 * not been confirmed from the label or the manufacturer, leave it null and say
 * so in `notes`: the rules engine then treats the aircraft as legacy.
 */
export type EuClass = 'C0' | 'C1' | 'C2' | 'C3' | 'C4';
export type UkClass = 'UK0' | 'UK1' | 'UK2' | 'UK3' | 'UK4';
/** Drawn top-down outline used for the map marker; see map/silhouettes.ts. */
export type Silhouette = 'palm' | 'mini' | 'air' | 'mavic' | 'fpv' | 'phantom';

export interface DroneModel {
  id: string;
  make: string;
  model: string;
  aliases: string[];
  /** Maximum take-off weight in grams as sold, including battery and propellers. */
  weightG: number;
  euClass: EuClass | null;
  ukClass: UkClass | null;
  camera: boolean;
  /** Whether the aircraft can broadcast Remote ID (direct/broadcast RID). */
  remoteId: 'broadcast' | 'none' | 'unknown';
  silhouette: Silhouette;
  released: number;
  notes: string;
  /** Month the entry was last checked against the manufacturer's specification. */
  verified: string;
}

const DJI = 'DJI';
const V = '2026-09';

export const DRONE_CATALOGUE: DroneModel[] = [
  { id: 'dji-neo', make: DJI, model: 'Neo', aliases: [], weightG: 135, euClass: 'C0', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'palm', released: 2024, notes: 'Sold with a C0 label. Over 100 g, so Flyer and Operator IDs are needed from 2026.', verified: V },
  { id: 'dji-neo-2', make: DJI, model: 'Neo 2', aliases: [], weightG: 151, euClass: 'C0', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'palm', released: 2025, notes: 'Sold with a C0 label.', verified: V },
  { id: 'dji-flip', make: DJI, model: 'Flip', aliases: [], weightG: 249, euClass: 'C0', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'palm', released: 2025, notes: 'Sold with a C0 label.', verified: V },
  { id: 'dji-mini-5-pro', make: DJI, model: 'Mini 5 Pro', aliases: ['mini5pro'], weightG: 250, euClass: 'C0', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'mini', released: 2025, notes: 'Quoted at 249.9 g with the standard battery; the Plus battery takes it over 250 g and out of C0.', verified: V },
  { id: 'dji-mini-4-pro', make: DJI, model: 'Mini 4 Pro', aliases: ['mini4pro'], weightG: 249, euClass: 'C0', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'mini', released: 2023, notes: 'Sold with a C0 label. The Plus battery takes it over 250 g and out of C0.', verified: V },
  { id: 'dji-mini-4k', make: DJI, model: 'Mini 4K', aliases: ['mini4k'], weightG: 249, euClass: 'C0', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'mini', released: 2024, notes: 'Sold with a C0 label.', verified: V },
  { id: 'dji-mini-3-pro', make: DJI, model: 'Mini 3 Pro', aliases: ['mini3pro'], weightG: 249, euClass: 'C0', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'mini', released: 2022, notes: 'C0 label added by DJI in 2023; earlier units carry it after a firmware update. The Plus battery takes it over 250 g.', verified: V },
  { id: 'dji-mini-3', make: DJI, model: 'Mini 3', aliases: ['mini3'], weightG: 248, euClass: 'C0', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'mini', released: 2022, notes: 'Sold with a C0 label. The Plus battery takes it over 250 g.', verified: V },
  { id: 'dji-mini-2-se', make: DJI, model: 'Mini 2 SE', aliases: ['mini2se'], weightG: 246, euClass: 'C0', ukClass: null, camera: true, remoteId: 'none', silhouette: 'mini', released: 2023, notes: 'Sold with a C0 label in Europe.', verified: V },
  { id: 'dji-mini-2', make: DJI, model: 'Mini 2', aliases: ['mini2'], weightG: 249, euClass: null, ukClass: null, camera: true, remoteId: 'none', silhouette: 'mini', released: 2020, notes: 'No class mark: legacy aircraft under 250 g.', verified: V },
  { id: 'dji-mini-se', make: DJI, model: 'Mini SE', aliases: ['minise'], weightG: 249, euClass: null, ukClass: null, camera: true, remoteId: 'none', silhouette: 'mini', released: 2021, notes: 'No class mark: legacy aircraft under 250 g.', verified: V },
  { id: 'dji-mavic-mini', make: DJI, model: 'Mavic Mini', aliases: ['mini 1', 'mini'], weightG: 249, euClass: null, ukClass: null, camera: true, remoteId: 'none', silhouette: 'mini', released: 2019, notes: 'No class mark: legacy aircraft under 250 g.', verified: V },
  { id: 'dji-air-3s', make: DJI, model: 'Air 3S', aliases: ['air3s'], weightG: 724, euClass: 'C1', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'air', released: 2024, notes: 'Sold with a C1 label.', verified: V },
  { id: 'dji-air-3', make: DJI, model: 'Air 3', aliases: ['air3'], weightG: 720, euClass: 'C1', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'air', released: 2023, notes: 'Sold with a C1 label.', verified: V },
  { id: 'dji-air-2s', make: DJI, model: 'Air 2S', aliases: ['air2s', 'mavic air 2s'], weightG: 595, euClass: 'C1', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'air', released: 2021, notes: 'C1 label added by DJI in 2023 after a firmware update; units without the label are legacy.', verified: V },
  { id: 'dji-mavic-air-2', make: DJI, model: 'Mavic Air 2', aliases: ['air 2', 'air2'], weightG: 570, euClass: null, ukClass: null, camera: true, remoteId: 'none', silhouette: 'air', released: 2020, notes: 'No class mark: legacy aircraft under 2 kg.', verified: V },
  { id: 'dji-mavic-4-pro', make: DJI, model: 'Mavic 4 Pro', aliases: ['mavic4pro'], weightG: 1063, euClass: 'C2', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'mavic', released: 2025, notes: 'Sold with a C2 label.', verified: V },
  { id: 'dji-mavic-3-pro', make: DJI, model: 'Mavic 3 Pro', aliases: ['mavic3pro'], weightG: 958, euClass: 'C2', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'mavic', released: 2023, notes: 'Sold with a C2 label.', verified: V },
  { id: 'dji-mavic-3-classic', make: DJI, model: 'Mavic 3 Classic', aliases: ['mavic3classic'], weightG: 895, euClass: 'C1', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'mavic', released: 2022, notes: 'Sold with a C1 label.', verified: V },
  { id: 'dji-mavic-3', make: DJI, model: 'Mavic 3', aliases: ['mavic3'], weightG: 895, euClass: 'C1', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'mavic', released: 2021, notes: 'C1 label added by DJI in 2023 after a firmware update; units without the label are legacy.', verified: V },
  { id: 'dji-mavic-2-pro', make: DJI, model: 'Mavic 2 Pro', aliases: ['mavic2pro'], weightG: 907, euClass: null, ukClass: null, camera: true, remoteId: 'none', silhouette: 'mavic', released: 2018, notes: 'No class mark: legacy aircraft under 2 kg.', verified: V },
  { id: 'dji-mavic-2-zoom', make: DJI, model: 'Mavic 2 Zoom', aliases: ['mavic2zoom'], weightG: 905, euClass: null, ukClass: null, camera: true, remoteId: 'none', silhouette: 'mavic', released: 2018, notes: 'No class mark: legacy aircraft under 2 kg.', verified: V },
  { id: 'dji-phantom-4-pro-v2', make: DJI, model: 'Phantom 4 Pro V2.0', aliases: ['phantom 4 pro', 'phantom 4', 'p4p'], weightG: 1375, euClass: null, ukClass: null, camera: true, remoteId: 'none', silhouette: 'phantom', released: 2018, notes: 'No class mark: legacy aircraft under 2 kg.', verified: V },
  { id: 'dji-avata-2', make: DJI, model: 'Avata 2', aliases: ['avata2'], weightG: 377, euClass: 'C1', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'fpv', released: 2024, notes: 'Sold with a C1 label. FPV goggles need a competent observer to keep visual line of sight.', verified: V },
  { id: 'dji-avata', make: DJI, model: 'Avata', aliases: [], weightG: 410, euClass: 'C1', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'fpv', released: 2022, notes: 'C1 label added by DJI in 2023. FPV goggles need a competent observer to keep visual line of sight.', verified: V },
  { id: 'dji-fpv', make: DJI, model: 'FPV', aliases: ['dji fpv drone'], weightG: 795, euClass: null, ukClass: null, camera: true, remoteId: 'none', silhouette: 'fpv', released: 2021, notes: 'No class mark: legacy aircraft under 2 kg. FPV goggles need a competent observer.', verified: V },
  { id: 'potensic-atom-2', make: 'Potensic', model: 'Atom 2', aliases: ['atom2'], weightG: 249, euClass: 'C0', ukClass: null, camera: true, remoteId: 'broadcast', silhouette: 'mini', released: 2025, notes: 'Sold with a C0 label in Europe.', verified: V },
  { id: 'potensic-atom', make: 'Potensic', model: 'Atom', aliases: [], weightG: 249, euClass: null, ukClass: null, camera: true, remoteId: 'unknown', silhouette: 'mini', released: 2023, notes: 'Class label not confirmed; check the aircraft. Treated as legacy under 250 g.', verified: V },
  { id: 'autel-evo-lite-plus', make: 'Autel', model: 'EVO Lite+', aliases: ['evo lite plus', 'lite+'], weightG: 835, euClass: null, ukClass: null, camera: true, remoteId: 'unknown', silhouette: 'air', released: 2022, notes: 'Class label not confirmed; check the aircraft. Treated as legacy under 2 kg.', verified: V },
  { id: 'autel-evo-nano-plus', make: 'Autel', model: 'EVO Nano+', aliases: ['evo nano plus', 'nano+'], weightG: 249, euClass: null, ukClass: null, camera: true, remoteId: 'unknown', silhouette: 'mini', released: 2022, notes: 'Class label not confirmed; check the aircraft. Treated as legacy under 250 g.', verified: V },
  { id: 'hoverair-x1', make: 'HoverAir', model: 'X1', aliases: ['hover x1', 'hoverair x1'], weightG: 125, euClass: null, ukClass: null, camera: true, remoteId: 'unknown', silhouette: 'palm', released: 2024, notes: 'Class label not confirmed; check the aircraft. Over 100 g, so Flyer and Operator IDs are needed from 2026.', verified: V },
  { id: 'parrot-anafi', make: 'Parrot', model: 'Anafi', aliases: [], weightG: 320, euClass: null, ukClass: null, camera: true, remoteId: 'none', silhouette: 'mavic', released: 2018, notes: 'No class mark: legacy aircraft under 2 kg.', verified: V },
];

export type DroneLookup =
  | { status: 'found'; drone: DroneModel }
  | { status: 'ambiguous'; candidates: DroneModel[] }
  | { status: 'not_found' };

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[+]/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function names(d: DroneModel): string[] {
  return [`${d.make} ${d.model}`, d.model, ...d.aliases.map((a) => `${d.make} ${a}`), ...d.aliases];
}

/**
 * Match a free-text model name. Exact name or alias wins; otherwise every
 * query token must appear in the name, and the shortest such name wins if it
 * is unique ("mini 3" is the Mini 3, not the Mini 3 Pro; "mavic 3" is the
 * Mavic 3). Several equally good matches are reported as ambiguous.
 */
export function findDrone(query: string, catalogue: DroneModel[] = DRONE_CATALOGUE): DroneLookup {
  const q = tokens(query);
  if (q.length === 0) return { status: 'not_found' };
  const key = q.join(' ');
  const exact = catalogue.filter((d) => names(d).some((n) => tokens(n).join(' ') === key));
  if (exact.length === 1) return { status: 'found', drone: exact[0] };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact };
  const scored = catalogue
    .map((d) => {
      const best = Math.min(...names(d).map((n) => {
        const t = tokens(n);
        return q.every((w) => t.includes(w)) ? t.length : Infinity;
      }));
      return { d, best };
    })
    .filter((s) => Number.isFinite(s.best))
    .sort((a, b) => a.best - b.best);
  if (scored.length === 0) return { status: 'not_found' };
  const top = scored.filter((s) => s.best === scored[0].best);
  if (top.length === 1) return { status: 'found', drone: top[0].d };
  return { status: 'ambiguous', candidates: scored.slice(0, 6).map((s) => s.d) };
}
