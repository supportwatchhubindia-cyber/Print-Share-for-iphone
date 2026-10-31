import type { ApiErrorBody, DocumentDTO } from "./types";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function redirectToLogin() {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

async function toError(res: Response): Promise<ApiClientError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON error */
  }
  const fallback = res.status === 429 ? "Too many requests. Please slow down." : `Request failed (${res.status}).`;
  return new ApiClientError(res.status, body.error?.code ?? "HTTP_ERROR", body.error?.message ?? fallback, body.error?.details?.fields);
}

/** Same-origin JSON fetch. Throws ApiClientError with the server's message. */
export async function apiFetch<T>(path: string, init: Omit<RequestInit, "body"> & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      headers: { Accept: "application/json", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR", "Can't reach PrintShare. Check your connection and try again.");
  }
  if (res.status === 401 && !path.startsWith("/api/auth/login")) redirectToLogin();
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

export const fetcher = <T>(path: string) => apiFetch<T>(path);

/** Uploads one file with progress (fetch has no upload progress, so XHR is used). */
export function uploadDocument(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ document: DocumentDTO }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents/upload");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as ({ document: DocumentDTO } & Partial<ApiErrorBody>) | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.document) resolve({ document: body.document });
      else {
        if (xhr.status === 401) redirectToLogin();
        reject(new ApiClientError(xhr.status, body?.error?.code ?? "UPLOAD_FAILED", body?.error?.message ?? `Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new ApiClientError(0, "NETWORK_ERROR", "Upload interrupted. Check your connection and try again."));
    xhr.onabort = () => reject(new ApiClientError(0, "ABORTED", "Upload cancelled."));
    signal?.addEventListener("abort", () => xhr.abort());
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
