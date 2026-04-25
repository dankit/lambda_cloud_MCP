export function buildAuthHeaders(apiKeyOverride: string): HeadersInit {
  const t = apiKeyOverride.trim();
  if (!t) return {};
  return { "X-Lambda-Api-Key": t };
}

export function buildPemHeaders(pemOverride: string): HeadersInit {
  const t = pemOverride.trim();
  if (!t) return {};
  return { "X-Lambda-Ssh-Pem-Path": t };
}
