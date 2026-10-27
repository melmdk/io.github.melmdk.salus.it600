import { diffProblems } from './parsers/common';

export interface DiagnosticsUpdate {
  alarm: boolean;
  text: string;
  /** Problems not present in the previous state; empty on the first update. */
  newProblems: string[];
}

/**
 * Derive alarm/text capability values and newly started problems.
 * `previous` is null before the first state has been seen, so problems that
 * already exist at app start do not fire the flow trigger.
 */
export function computeDiagnostics(previous: string[] | null, problems: string[]): DiagnosticsUpdate {
  return {
    alarm: problems.length > 0,
    text: problems.join(', '),
    newProblems: previous === null ? [] : diffProblems(previous, problems),
  };
}

/** The part of the Homey instance fireProblemTriggers uses (`this.homey` in a device). */
export interface ProblemTriggerHost {
  flow: {
    getTriggerCard(id: string): { trigger(tokens: Record<string, unknown>): Promise<unknown> };
  };
}

/**
 * Fire the `problem_started` flow trigger once per new problem, with the
 * device name and the problem as tokens. A failed trigger goes to `onError`
 * and does not stop the others. Shared by the thermostat and wiring-centre devices.
 */
export function fireProblemTriggers(
  homey: ProblemTriggerHost,
  deviceName: string,
  newProblems: string[],
  onError: (err: unknown) => void,
): void {
  if (newProblems.length === 0) return;
  const card = homey.flow.getTriggerCard('problem_started');
  for (const problem of newProblems) {
    card.trigger({ device: deviceName, problem }).catch(onError);
  }
}
