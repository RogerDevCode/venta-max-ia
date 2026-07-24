import { TelegramApiError, telegramRequest } from "@/lib/telegram/client";

export type TelegramIntegrationCredentials = {
  token: string;
  status: string;
};

export type TelegramTransportError = Error & {
  code: "timeout" | "network" | "rate_limited" | "server" | "unauthorized" | "terminal";
  retryable: boolean;
  deliveryUnknown: boolean;
};

export function classifyTelegramError(error: unknown): TelegramTransportError {
  const source = error instanceof Error ? error : new Error(String(error));
  let code: TelegramTransportError["code"] = "terminal";
  let retryable = false;
  let deliveryUnknown = false;
  const details = error instanceof TelegramApiError ? error.details : error;
  const aborted = source.name === "AbortError" || source.name === "TimeoutError" ||
    (details instanceof Error && (details.name === "AbortError" || details.name === "TimeoutError"));
  if (aborted) {
    code = "timeout";
    retryable = true;
    deliveryUnknown = true;
  } else if (error instanceof TelegramApiError && (error.status === 401 || error.isAuthError)) {
    code = "unauthorized";
  } else if (error instanceof TelegramApiError && error.status === 429) {
    code = "rate_limited";
    retryable = true;
  } else if (error instanceof TelegramApiError && error.status >= 500) {
    code = "server";
    retryable = true;
  } else if (error instanceof TelegramApiError && error.status === 0) {
    code = "network";
    retryable = true;
    deliveryUnknown = true;
  }
  const result = new Error(source.message, { cause: source }) as Error & { code: string; retryable: boolean; deliveryUnknown: boolean };
  result.stack = source.stack;
  result.code = code;
  result.retryable = retryable;
  result.deliveryUnknown = deliveryUnknown;
  return result as TelegramTransportError;
}

export async function telegramCall<T>(
  integration: TelegramIntegrationCredentials,
  method: string,
  body: unknown,
  options: { timeoutMs?: number; isTest?: boolean } = {}
): Promise<T> {
  if (options.isTest) throw Object.assign(new Error("sandbox_violation"), {
    code: "terminal", retryable: false, deliveryUnknown: false,
  });
  if (!integration.token) throw Object.assign(new Error("missing_tenant_token"), {
    code: "unauthorized", retryable: false, deliveryUnknown: false,
  });
  try {
    return await telegramRequest<T>(method, {
      token: integration.token,
      body,
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    throw classifyTelegramError(error);
  }
}
