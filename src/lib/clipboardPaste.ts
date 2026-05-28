/** True when the event target is a text-editing control. */
export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const el = target.closest("input, textarea, select, [contenteditable='true']");
  if (!el) return false;
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    if (t === "button" || t === "submit" || t === "checkbox" || t === "radio") {
      return false;
    }
  }
  return true;
}

/** Finder / Safari often omit MIME type until drop — use extension fallback. */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name);
}

/** First image file from a drop or paste DataTransfer (macOS-safe). */
export function getDataTransferImageFile(
  data: DataTransfer | null
): File | null {
  if (!data) return null;

  if (data.items?.length) {
    for (const item of data.items) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && isImageFile(file)) return file;
    }
  }

  if (data.files?.length) {
    for (const file of data.files) {
      if (isImageFile(file)) return file;
    }
  }

  return null;
}

export function getClipboardImageFile(
  data: DataTransfer | null
): File | null {
  return getDataTransferImageFile(data);
}

/** True while dragging files over the zone (Files type = Finder on Mac). */
export function dragEventHasImage(data: DataTransfer | null): boolean {
  if (!data) return false;

  const types = data.types;
  if (types.includes("Files")) {
    if (data.items?.length) {
      for (const item of data.items) {
        if (item.kind === "file") {
          if (!item.type || item.type.startsWith("image/")) return true;
        }
      }
      return false;
    }
    return true;
  }

  if (data.items?.length) {
    for (const item of data.items) {
      if (item.kind === "file" && item.type.startsWith("image/")) return true;
    }
  }

  return false;
}

export function clipboardHasTextOnly(data: DataTransfer | null): boolean {
  if (!data?.items?.length) return false;
  let hasText = false;
  let hasImage = false;
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      hasImage = true;
    }
    if (item.kind === "string" && item.type === "text/plain") {
      hasText = true;
    }
  }
  return hasText && !hasImage;
}
