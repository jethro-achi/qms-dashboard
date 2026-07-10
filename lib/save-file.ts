// lib/save-file.ts — client helper: save a Blob, letting the user choose the
// location + filename (Chromium showSaveFilePicker) with a download fallback.
interface SaveFilePickerWindow {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }>;
}

export async function saveBlob(
  blob: Blob,
  filename: string,
  accept?: Record<string, string[]>,
): Promise<"saved" | "cancelled"> {
  const w = window as unknown as SaveFilePickerWindow;
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: accept ? [{ description: "File", accept }] : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return "saved";
}
