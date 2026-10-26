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
