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

export function getClipboardImageFile(
  data: DataTransfer | null
): File | null {
  if (!data?.items?.length) return null;
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
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
