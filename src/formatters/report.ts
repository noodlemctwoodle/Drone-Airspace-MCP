export interface ReportSection {
  title: string;
  lines: string[];
}

export interface Report {
  headline: string;
  notes?: string[];
  location?: string;
  sections: ReportSection[];
  caveats?: string[];
  attribution: string[];
}

/**
 * Plain text, no markdown headings, no emoji. Indentation carries hierarchy so it
 * reads well inside Claude Desktop and in a terminal.
 */
export function renderReport(report: Report): string {
  const out: string[] = [report.headline];
  for (const note of report.notes ?? []) out.push(`Note: ${note}`);
  if (report.location) {
    out.push('');
    out.push(`Location: ${report.location}`);
  }
  for (const section of report.sections) {
    if (section.lines.length === 0) continue;
    out.push('');
    out.push(section.title);
    for (const line of section.lines) out.push(`  ${line}`);
  }
  if (report.caveats && report.caveats.length > 0) {
    out.push('');
    out.push('Caveats');
    for (const c of report.caveats) out.push(`  - ${c}`);
  }
  out.push('');
  out.push(`Attribution: ${report.attribution.length > 0 ? report.attribution.join('; ') : 'none'}`);
  return out.join('\n');
}
