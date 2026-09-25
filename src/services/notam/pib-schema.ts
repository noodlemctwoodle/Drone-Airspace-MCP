/**
 * Element names in the NATS contingency PIB XML (https://pibs.nats.co.uk/operational/pibs/PIB.xml).
 * Captured from the live file on 2026-09-25. The feed has no declared schema and
 * "may change with minimal notification": if it does, this is the only file to edit.
 *
 * Shape:
 *   Pib > AreaPIBHeader > Validity > ValidFrom / ValidTo
 *   Pib > FIRSection[] > (ADSection[] | Warnings | En) > NotamList > Notam[]
 *   Notam: NOF, Series, Number, Year, Type (N|R|C), Referred{Series,Number,Year}?,
 *          QLine { FIR, Code23, Code45, Traffic, Purpose, Scope, Lower, Upper },
 *          Coordinates (DDMM[NS]DDDMM[EW]), Radius (NM), ItemA (repeatable),
 *          StartValidity / EndValidity (YYMMDDHHMM | PERM), Estimation (EST)?,
 *          ItemD?, ItemE, ItemF?, ItemG?, Marker, NotamStoreDate
 */
export const PIB_EL = {
  ROOT: 'Pib',
  HEADER: 'AreaPIBHeader',
  VALIDITY: 'Validity',
  VALID_FROM: 'ValidFrom',
  VALID_TO: 'ValidTo',
  ISSUED: 'Issued',
  NOTAM_LIST: 'NotamList',
  NOTAM: 'Notam',
  NOF: 'NOF',
  SERIES: 'Series',
  NUMBER: 'Number',
  YEAR: 'Year',
  TYPE: 'Type',
  QLINE: 'QLine',
  FIR: 'FIR',
  CODE23: 'Code23',
  CODE45: 'Code45',
  TRAFFIC: 'Traffic',
  PURPOSE: 'Purpose',
  SCOPE: 'Scope',
  LOWER: 'Lower',
  UPPER: 'Upper',
  COORDINATES: 'Coordinates',
  RADIUS: 'Radius',
  ITEM_A: 'ItemA',
  START: 'StartValidity',
  END: 'EndValidity',
  ESTIMATION: 'Estimation',
  ITEM_D: 'ItemD',
  ITEM_E: 'ItemE',
  ITEM_F: 'ItemF',
  ITEM_G: 'ItemG',
} as const;

/** Elements that must always be parsed as arrays even when a single child is present. */
export const PIB_ARRAY_ELEMENTS: ReadonlySet<string> = new Set([
  PIB_EL.NOTAM,
  PIB_EL.ITEM_A,
  'FIRSection',
  'ADSection',
  PIB_EL.NOTAM_LIST,
]);
