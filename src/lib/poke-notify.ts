const POKE_API_MESSAGE_URL =
  "https://poke.com/api/v1/inbound/api-message";

/**
 * Sends a message to Poke when POKE_API_KEY is set (V2 key from Kitchen).
 * Never throws; failures are logged so launch flow is unaffected.
 */
export async function notifyPokeOnLaunch(params: {
  message: string;
}): Promise<void> {
  const key = process.env.POKE_API_KEY?.trim();
  if (!key) return;

  try {
    const res = await fetch(POKE_API_MESSAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: params.message }),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[poke-notify] HTTP ${res.status}: ${text.slice(0, 200)}`
      );
      return;
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      return;
    }
    const success =
      typeof parsed === "object" &&
      parsed !== null &&
      "success" in parsed &&
      (parsed as { success?: unknown }).success === true;
    if (!success) {
      console.warn("[poke-notify] Response did not indicate success:", parsed);
    }
  } catch (e) {
    console.warn("[poke-notify] Request failed:", e);
  }
}

export function extractLaunchInstanceIds(body: unknown): string[] {
  const ids = (body as { data?: { instance_ids?: unknown } })?.data
    ?.instance_ids;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string");
}
