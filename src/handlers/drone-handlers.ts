import type { OutputFormat } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { brief, respond, textResponse } from './respond.js';
import { UserFacingError } from '../core/errors.js';
import { parseUserDate } from '../services/notam/validity.js';
import { assessDroneRules, findDrone, RULE_DATES, RULE_SOURCES, type DroneModel, type DroneRulesAssessment, type EuClass, type UkClass } from '../services/drones/index.js';
import { renderReport } from '../formatters/report.js';
import { attributionLines, attributionSentence, type SourceId } from '../formatters/attribution.js';
import { CAVEAT_DRONE_RULES, CAVEAT_NOT_BRIEFING } from './caveats.js';

export interface DroneArgs {
  model?: string;
  weight_g?: number;
  class_mark?: string;
  has_camera?: boolean;
  a2_certificate?: boolean;
  date?: string;
}

export interface ResolvedDrone {
  drone: DroneModel | null;
  weightG: number;
  euClass: EuClass | null;
  ukClass: UkClass | null;
  camera: boolean;
  remoteId: 'broadcast' | 'none' | 'unknown';
  label: string;
}

const EU = new Set(['C0', 'C1', 'C2', 'C3', 'C4']);
const UK = new Set(['UK0', 'UK1', 'UK2', 'UK3', 'UK4']);

/**
 * Turn the tool arguments into a concrete aircraft: a catalogue model when
 * `model` matches, otherwise the weight and class given directly. Explicit
 * arguments override catalogue values so a Plus battery or a re-labelled unit
 * can be described.
 */
export function resolveDrone(args: DroneArgs): { resolved: ResolvedDrone } | { error: string } | { ambiguous: DroneModel[] } {
  let drone: DroneModel | null = null;
  if (typeof args.model === 'string' && args.model.trim() !== '') {
    const found = findDrone(args.model);
    if (found.status === 'ambiguous') return { ambiguous: found.candidates };
    if (found.status === 'not_found') {
      if (typeof args.weight_g !== 'number') return { error: `"${args.model}" is not in the drone catalogue. Give weight_g (and class_mark if it has one) instead.` };
    } else drone = found.drone;
  }
  const weightG = typeof args.weight_g === 'number' ? args.weight_g : drone?.weightG;
  if (typeof weightG !== 'number') return { error: 'Give a model name, or weight_g in grams.' };
  const mark = typeof args.class_mark === 'string' ? args.class_mark.toUpperCase().replace(/\s+/g, '') : undefined;
  if (mark && mark !== 'NONE' && !EU.has(mark) && !UK.has(mark)) return { error: `Unknown class mark "${args.class_mark}". Use C0 to C4, UK0 to UK4, or none.` };
  const euClass = mark ? (EU.has(mark) ? (mark as EuClass) : null) : (drone?.euClass ?? null);
  const ukClass = mark ? (UK.has(mark) ? (mark as UkClass) : null) : (drone?.ukClass ?? null);
  const camera = typeof args.has_camera === 'boolean' ? args.has_camera : (drone?.camera ?? true);
  const label = drone ? `${drone.make} ${drone.model}` : `${weightG} g aircraft${ukClass ?? euClass ? ` with ${ukClass ?? euClass} mark` : ' without a class mark'}`;
  return { resolved: { drone, weightG, euClass, ukClass, camera, remoteId: drone?.remoteId ?? 'unknown', label } };
}

export function summariseDrone(r: ResolvedDrone, a: DroneRulesAssessment): string {
  const cls = a.effectiveClass === 'legacy' ? (r.euClass ? `${r.euClass} label no longer recognised, legacy` : 'legacy, no class mark') : a.basis === 'eu_class_transition' ? `${r.euClass}, flies as ${a.effectiveClass}` : a.effectiveClass;
  const sub = a.subcategoryWithA2Certificate ? `${a.subcategory} (${a.subcategoryWithA2Certificate} with an A2 CofC)` : a.subcategory;
  return `${r.label} (${r.weightG} g, ${cls}): open category ${sub}.`;
}

export function createCheckDroneRulesHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const outcome = resolveDrone(args as DroneArgs);
    if ('error' in outcome) throw new UserFacingError(outcome.error);
    if ('ambiguous' in outcome) {
      const names = outcome.ambiguous.map((d) => `${d.make} ${d.model}`);
      const data = { tool: 'check_drone_rules', status: 'ambiguous', query: args.model, candidates: outcome.ambiguous };
      return respond(format, data, () => `Several models match "${args.model}": ${names.join(', ')}. Say which one.`, () => brief(`Several models match ${args.model}: ${names.slice(0, 4).join(', ')}`, 'Which one do you have?'));
    }
    const r = outcome.resolved;
    let asOf: Date;
    try {
      asOf = parseUserDate(typeof args.date === 'string' ? args.date : undefined, deps.now);
    } catch (error) {
      throw new UserFacingError((error as Error).message);
    }
    const a = assessDroneRules({ weightG: r.weightG, euClass: r.euClass, ukClass: r.ukClass, camera: r.camera, a2Certificate: args.a2_certificate === true, remoteId: r.remoteId }, asOf);
    const used = new Set<SourceId>(['caa_rules']);
    const attribution = attributionLines(used, null);
    const caveats = [CAVEAT_DRONE_RULES, CAVEAT_NOT_BRIEFING];
    const headline = summariseDrone(r, a);
    const data = {
      tool: 'check_drone_rules',
      generatedAt: deps.now().toISOString(),
      drone: r.drone,
      aircraft: { label: r.label, weightG: r.weightG, euClass: r.euClass, ukClass: r.ukClass, camera: r.camera, remoteId: r.remoteId },
      a2Certificate: args.a2_certificate === true,
      assessment: a,
      sources: RULE_SOURCES,
      caveats,
      attribution,
    };
    return respond(
      format,
      data,
      () =>
        renderReport({
          headline,
          notes: [a.basisNote, r.drone?.notes ?? ''].filter(Boolean),
          sections: [
            { title: 'Flying near people', lines: [a.overflight, a.separation] },
            { title: 'Registration', lines: [a.registration.note] },
            { title: 'Remote ID', lines: [a.remoteId.note] },
            { title: 'Always', lines: a.always },
            { title: 'Transition dates', lines: [`EU C-class labels count as the matching UK class until ${RULE_DATES.euClassRecognisedUntil}.`, `Rules as of ${a.asOf}.`] },
          ],
          caveats,
          attribution,
        }),
      () =>
        brief(
          headline,
          a.overflight,
          a.separation.split('. ')[0],
          a.registration.flyerId ? 'You need a Flyer ID and an Operator ID' : a.registration.operatorId ? 'You need an Operator ID but not a Flyer ID' : 'No registration is needed',
          a.remoteId.required ? 'Remote ID must be broadcasting' : a.remoteId.from ? `Remote ID is needed from ${a.remoteId.from.slice(0, 4)}` : null,
          attributionSentence(used)
        )
    );
  };
}

/** Short section for other tools that accept a `drone` argument. */
export function droneSectionLines(model: string, a2Certificate: boolean, now: Date): { lines: string[]; assessment: DroneRulesAssessment | null; label: string | null; id: string | null } {
  const outcome = resolveDrone({ model, a2_certificate: a2Certificate });
  if ('error' in outcome) return { lines: [outcome.error], assessment: null, label: null, id: null };
  if ('ambiguous' in outcome) return { lines: [`Several models match "${model}": ${outcome.ambiguous.map((d) => `${d.make} ${d.model}`).join(', ')}.`], assessment: null, label: null, id: null };
  const a = assessDroneRules({ ...outcome.resolved, a2Certificate }, now);
  return { lines: [summariseDrone(outcome.resolved, a), a.overflight, a.separation], assessment: a, label: outcome.resolved.label, id: outcome.resolved.drone?.id ?? null };
}

export { textResponse };
