/**
 * UK open category rules for consumer drones, as published by the CAA. This is
 * a summary encoded as data, not the regulation: every figure below is cited
 * to the CAA class marks page or the CAA Drone Code and should be re-checked
 * against them when the rules change. Dates make the transition provisions
 * explicit so the same code gives the right answer before and after them.
 */
import type { EuClass, UkClass } from './catalogue.js';

export const RULE_SOURCES = {
  classMarks: 'https://www.caa.co.uk/drones/getting-started-with-drones-and-model-aircraft/class-marks/',
  droneCode: 'https://register-drones.caa.co.uk/drone-code',
} as const;

export const RULE_DATES = {
  /** New models placed on the UK market need a UK class mark; registration threshold falls to 100 g; Remote ID for UK1 to UK3. */
  ukClassMarks: '2026-01-01',
  /** Last day an EU C-class label is treated as the matching UK class. */
  euClassRecognisedUntil: '2027-12-31',
  /** Remote ID for camera drones of 100 g or more without a UK1 to UK3 mark (UK0, legacy, privately built). */
  remoteIdLegacy: '2028-01-01',
} as const;

export const RULE_LIMITS = {
  /** Registration threshold before and after 1 January 2026. */
  registrationG: { before2026: 250, from2026: 100 },
  a1LegacyMaxG: 250,
  a2LegacyMaxG: 2000,
  openCategoryMaxG: 25_000,
  a2SeparationM: 30,
  a2LowSpeedSeparationM: 5,
  a2LegacySeparationM: 50,
  a3BuiltUpSeparationM: 150,
  maxHeightM: 120,
} as const;

export type Subcategory = 'A1' | 'A2' | 'A3';
export type EffectiveClass = UkClass | 'legacy';

export interface DroneRulesInput {
  weightG: number;
  euClass?: EuClass | null;
  ukClass?: UkClass | null;
  camera: boolean;
  /** Whether the pilot holds an A2 Certificate of Competency. */
  a2Certificate?: boolean;
  /** Whether the aircraft can broadcast Remote ID; unknown is treated as not. */
  remoteId?: 'broadcast' | 'none' | 'unknown';
}

export interface DroneRulesAssessment {
  asOf: string;
  effectiveClass: EffectiveClass;
  basis: 'uk_class' | 'eu_class_transition' | 'legacy';
  basisNote: string;
  subcategory: Subcategory;
  /** The better subcategory available with an A2 CofC, when the pilot does not hold one. */
  subcategoryWithA2Certificate: Subcategory | null;
  overflight: string;
  separation: string;
  registration: { flyerId: boolean; operatorId: boolean; note: string };
  remoteId: { required: boolean; from: string | null; note: string };
  always: string[];
  outsideOpenCategory: boolean;
}

const EU_TO_UK: Record<EuClass, UkClass> = { C0: 'UK0', C1: 'UK1', C2: 'UK2', C3: 'UK3', C4: 'UK4' };

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function assessDroneRules(input: DroneRulesInput, now: Date = new Date()): DroneRulesAssessment {
  const today = dateKey(now);
  const from2026 = today >= RULE_DATES.ukClassMarks;
  const w = input.weightG;

  let effectiveClass: EffectiveClass = 'legacy';
  let basis: DroneRulesAssessment['basis'] = 'legacy';
  let basisNote: string;
  if (input.ukClass) {
    effectiveClass = input.ukClass;
    basis = 'uk_class';
    basisNote = `Carries a ${input.ukClass} class mark.`;
  } else if (input.euClass && today <= RULE_DATES.euClassRecognisedUntil) {
    effectiveClass = EU_TO_UK[input.euClass];
    basis = 'eu_class_transition';
    basisNote = `Carries a ${input.euClass} label, which the CAA treats as ${effectiveClass} until ${RULE_DATES.euClassRecognisedUntil}; after that it becomes a legacy aircraft judged on weight.`;
  } else if (input.euClass) {
    basisNote = `Its ${input.euClass} label stopped counting as a UK class on ${RULE_DATES.euClassRecognisedUntil}; it is now a legacy aircraft judged on weight.`;
  } else {
    basisNote = 'No class mark, so it is a legacy aircraft judged on weight.';
  }

  const outsideOpenCategory = w >= RULE_LIMITS.openCategoryMaxG;
  let subcategory: Subcategory;
  let withCert: Subcategory | null = null;
  let overflight: string;
  let separation: string;
  const a2 = input.a2Certificate === true;
  const a2Text = `at least ${RULE_LIMITS.a2SeparationM} m horizontally from uninvolved people, or ${RULE_LIMITS.a2LowSpeedSeparationM} m with low-speed mode engaged`;
  const a3Text = `where no uninvolved people are expected in the area of flight, and at least ${RULE_LIMITS.a3BuiltUpSeparationM} m from residential, commercial, industrial and recreational areas`;

  if (effectiveClass === 'UK0' || (effectiveClass === 'legacy' && w < RULE_LIMITS.a1LegacyMaxG)) {
    subcategory = 'A1';
    overflight = 'You may fly over uninvolved people, but never over crowds or assemblies of people.';
    separation = 'No fixed separation distance in A1; keep well clear of people where you can.';
  } else if (effectiveClass === 'UK1') {
    subcategory = 'A1';
    overflight = 'Avoid flying over uninvolved people; if it happens unexpectedly, fly away as soon as possible. Never over crowds or assemblies.';
    separation = 'No fixed separation distance in A1; keep well clear of people where you can.';
  } else if (effectiveClass === 'UK2') {
    subcategory = a2 ? 'A2' : 'A3';
    withCert = a2 ? null : 'A2';
    overflight = 'Do not fly over uninvolved people.';
    separation = a2 ? `Fly ${a2Text}.` : `Without an A2 Certificate of Competency, fly A3: ${a3Text}. With the certificate you could fly A2, ${a2Text}.`;
  } else if (effectiveClass === 'legacy' && w < RULE_LIMITS.a2LegacyMaxG) {
    subcategory = a2 ? 'A2' : 'A3';
    withCert = a2 ? null : 'A2';
    overflight = 'Do not fly over uninvolved people.';
    separation = a2
      ? `Legacy aircraft under 2 kg: fly at least ${RULE_LIMITS.a2LegacySeparationM} m horizontally from uninvolved people.`
      : `Without an A2 Certificate of Competency, fly A3: ${a3Text}. With the certificate you could fly A2 at ${RULE_LIMITS.a2LegacySeparationM} m from uninvolved people.`;
  } else {
    subcategory = 'A3';
    overflight = 'Do not fly over or near uninvolved people.';
    separation = `Fly A3: ${a3Text}.`;
  }

  const threshold = from2026 ? RULE_LIMITS.registrationG.from2026 : RULE_LIMITS.registrationG.before2026;
  const flyerId = w >= threshold;
  const operatorId = w >= threshold || input.camera;
  const registration = {
    flyerId,
    operatorId,
    note: flyerId
      ? `Flyer ID (the free CAA test) and Operator ID are required: the aircraft is ${threshold} g or more.`
      : operatorId
        ? `Operator ID is required because the aircraft has a camera; a Flyer ID is not required under ${threshold} g.`
        : `No registration needed: under ${threshold} g and no camera.`,
  };

  let remoteId: DroneRulesAssessment['remoteId'];
  const overHundred = w >= RULE_LIMITS.registrationG.from2026;
  if (effectiveClass === 'UK1' || effectiveClass === 'UK2' || effectiveClass === 'UK3') {
    remoteId = { required: today >= RULE_DATES.ukClassMarks, from: RULE_DATES.ukClassMarks, note: `Remote ID broadcast is required for ${effectiveClass} aircraft from ${RULE_DATES.ukClassMarks}.` };
  } else if (input.camera && overHundred) {
    remoteId = { required: today >= RULE_DATES.remoteIdLegacy, from: RULE_DATES.remoteIdLegacy, note: `Remote ID broadcast is required from ${RULE_DATES.remoteIdLegacy} for camera aircraft of 100 g or more without a UK1 to UK3 mark.` };
  } else {
    remoteId = { required: false, from: null, note: 'No Remote ID requirement for this aircraft.' };
  }
  if (remoteId.from && input.remoteId === 'none') remoteId.note += ' This model cannot broadcast Remote ID itself, so an add-on module will be needed by then.';

  const always = [
    `Keep the aircraft within visual line of sight and below ${RULE_LIMITS.maxHeightM} m above the surface.`,
    'Stay out of flight restriction zones around aerodromes unless the aerodrome has given permission, and check NOTAMs.',
    'Follow the Drone Code and any landowner rules at the take-off site.',
  ];
  if (outsideOpenCategory) always.unshift('At 25 kg or more this aircraft is outside the open category; an operational authorisation is needed.');

  return { asOf: today, effectiveClass, basis, basisNote, subcategory, subcategoryWithA2Certificate: withCert, overflight, separation, registration, remoteId, always, outsideOpenCategory };
}
