export interface ValidateChecks {
  /** Is there an img/<name> icon set. Defaults to always true. */
  iconExists?: (name: string) => boolean;
  /** Lower-cased command names defined in ahk/commands; null or omitted skips that check. */
  ahkActions?: Set<string> | null;
  /** Lower-cased command names defined in powershell/commands; null or omitted skips that check. */
  psActions?: Set<string> | null;
}

/** Problems in a parsed config, as readable strings (empty when valid). */
export function validateConfig(config: unknown, checks?: ValidateChecks): string[];

/** Lower-cased names of the functions defined in a command file, in file order. */
export function functionNames(text: string, ext: '.ahk' | '.ps1'): string[];
