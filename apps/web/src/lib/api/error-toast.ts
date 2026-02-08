"use client";

import { toast } from "sonner";
import {
  getErrorMessage,
  readApiErrorMessageFromResponse,
} from "@/lib/api/error-message";

export function toastApiError(error: unknown, fallbackMessage: string) {
  const message = getErrorMessage(error, fallbackMessage);
  toast.error(message);
  return message;
}

export async function toastApiResponseError(
  response: Response,
  fallbackMessage: string,
) {
  const message = await readApiErrorMessageFromResponse(
    response,
    fallbackMessage,
  );
  toast.error(message);
  return message;
}
