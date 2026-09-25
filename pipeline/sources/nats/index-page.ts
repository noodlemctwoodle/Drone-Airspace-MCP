export interface NatsDatasetLink {
  date: string; // YYYYMMDD
  xmlUrl: string | null;
  kmlUrl: string | null;
}

const BASE = 'https://nats-uk.ead-it.com';

/** Scrape the digital-datasets index page for UAS dataset zip links, newest first. */
export function scrapeNatsIndex(html: string): NatsDatasetLink[] {
  const byDate = new Map<string, NatsDatasetLink>();
  const re = /(?:href=["']|\b)((?:https?:\/\/[^"'\s]+)?\/?[^"'\s]*EG_UAS_FR_DS_AREA1_FULL_(\d{8})_(XML|KML)\.zip)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = m[1].startsWith('http') ? m[1] : `${BASE}${m[1].startsWith('/') ? '' : '/'}${m[1]}`;
    const date = m[2];
    const entry = byDate.get(date) ?? { date, xmlUrl: null, kmlUrl: null };
    if (m[3].toUpperCase() === 'XML') entry.xmlUrl = url;
    else entry.kmlUrl = url;
    byDate.set(date, entry);
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}
