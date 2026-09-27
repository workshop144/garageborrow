import { useMutation } from "@tanstack/react-query";

import { api } from "../lib/api";

// The API returns the caller's export as JSON; save it as a file in the browser.
export function useDataExport() {
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      const data = await api.get<unknown>("/me/data-export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "garageborrow-export.json";
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}
