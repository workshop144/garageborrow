import { useMutation } from "@tanstack/react-query";

import { api } from "../lib/api";
import { newIdempotencyKey } from "../lib/idempotency";

export type DataExportResponse = { status: "queued" | "sent" };

export function useDataExport() {
  return useMutation<DataExportResponse, Error, void>({
    mutationFn: () =>
      api.post<DataExportResponse>("/me/data-export", undefined, {
        idempotencyKey: newIdempotencyKey(),
      }),
  });
}
