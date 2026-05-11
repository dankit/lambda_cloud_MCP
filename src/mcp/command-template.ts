/**
 * Apply {{key}} placeholders and optional env exports for remote training commands.
 * Keys in parameters must match /^[a-zA-Z_][a-zA-Z0-9_]*$/ to avoid shell metacharacters in names.
 */

const PLACEHOLDER = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

export function isSafeParameterKey(key: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
}

/** Bourne-shell single-quote escaping for use inside '...' */
export function shellSingleQuoteValue(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

/**
 * Prefix: export A='b' && export C='d' && (rest)
 * Only includes keys present in env with safe names.
 */
export function buildExportPrefix(env: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(env)) {
    if (!isSafeParameterKey(key)) continue;
    parts.push(`export ${key}=${shellSingleQuoteValue(raw)}`);
  }
  if (parts.length === 0) return "";
  return parts.join(" && ") + " && ";
}

/**
 * Replace {{key}} with values from parameters. Unknown placeholders are left unchanged
 * unless strictMissing is true (then throws).
 */
export function applyParameterPlaceholders(
  command: string,
  parameters: Record<string, string>,
  strictMissing: boolean
): string {
  return command.replace(PLACEHOLDER, (_full, name: string) => {
    if (typeof name !== "string" || !isSafeParameterKey(name)) {
      if (strictMissing) {
        throw new Error(`Invalid placeholder name in command template: ${String(name)}`);
      }
      return "{{" + name + "}}";
    }
    if (Object.prototype.hasOwnProperty.call(parameters, name)) {
      return parameters[name];
    }
    if (strictMissing) {
      throw new Error(`Missing parameter for placeholder {{${name}}}`);
    }
    return "{{" + name + "}}";
  });
}

export function buildTemplatedCommand(
  baseCommand: string,
  options: {
    parameters?: Record<string, string>;
    env?: Record<string, string>;
    strictPlaceholders?: boolean;
  }
): string {
  const parameters = options.parameters ?? {};
  for (const key of Object.keys(parameters)) {
    if (!isSafeParameterKey(key)) {
      throw new Error(`Invalid parameter key (use letters, numbers, underscore): ${key}`);
    }
  }
  const env = options.env ?? {};
  for (const key of Object.keys(env)) {
    if (!isSafeParameterKey(key)) {
      throw new Error(`Invalid env key (use letters, numbers, underscore): ${key}`);
    }
  }
  const strict = options.strictPlaceholders === true;
  const expanded = applyParameterPlaceholders(baseCommand, parameters, strict);
  return buildExportPrefix(env) + expanded;
}
