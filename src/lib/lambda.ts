export const LAMBDA_API_BASE = "https://cloud.lambda.ai/api/v1";

export type LambdaErrorBody = {
  error?: { code?: string; message?: string; suggestion?: string };
};

export async function lambdaFetch<T = unknown>(
  apiPath: string,
  init: {
    method?: "GET" | "POST";
    body?: unknown;
    apiKey: string;
  }
): Promise<{ ok: boolean; status: number; body: T | LambdaErrorBody | null }> {
  const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const url = `${LAMBDA_API_BASE}${path}`;
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${init.apiKey}`,
    },
    body:
      init.method === "POST" && init.body !== undefined
        ? JSON.stringify(init.body)
        : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let body: T | LambdaErrorBody | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = { error: { code: "invalid-json", message: text.slice(0, 200) } };
    }
  }
  return { ok: res.ok, status: res.status, body };
}
