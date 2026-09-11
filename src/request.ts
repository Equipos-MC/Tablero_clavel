export async function requestJson<T>(url: string, options?: RequestInit, retryRead = false): Promise<T> {
  const attempts = retryRead ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let message = "No se pudo conectar con el almacenamiento. Revisa tu conexión e inténtalo de nuevo.";
    let retryable = true;
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload !== null) return payload as T;
      retryable = [408, 429, 500, 502, 503, 504].includes(response.status) || (response.ok && payload === null);
      message = typeof payload?.error === "string" ? payload.error
        : retryable ? "El almacenamiento tardó demasiado o no está disponible temporalmente. Pulsa Reintentar."
        : "No se pudo consultar el almacenamiento. Inténtalo de nuevo.";
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        message = "El almacenamiento tardó demasiado en responder. Pulsa Reintentar.";
      }
    }
    if (!retryable || attempt === attempts - 1) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
  }
  throw new Error("No se pudo consultar el almacenamiento.");
}
