export type ApiKeyName = 'GEMINI_API_KEY' | 'ANTHROPIC_API_KEY';

type RuntimeGlobal = typeof globalThis & {
  process?: {
    env?: Partial<Record<ApiKeyName, string | undefined>>;
  };
};

const configuredKeys: Partial<Record<ApiKeyName, string>> = {};

export function configureApiKeys(
  keys: Partial<Record<ApiKeyName, string | undefined>>,
) {
  for (const [name, value] of Object.entries(keys) as Array<
    [ApiKeyName, string | undefined]
  >) {
    if (value == null || value.trim().length === 0) {
      delete configuredKeys[name];
    } else {
      configuredKeys[name] = value;
    }
  }
}

export function getConfiguredApiKey(name: ApiKeyName): string {
  const configured = configuredKeys[name];
  if (configured != null) {
    return configured;
  }

  const runtime = globalThis as RuntimeGlobal;
  return runtime.process?.env?.[name] ?? '';
}
