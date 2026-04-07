/**
 * Shared browser file download helpers.
 */

/** Trigger a download from a Blob */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Download a base64-encoded string as a file */
export function downloadBase64(base64: string, mimeType: string, filename: string) {
  const byteString = atob(base64)
  const bytes = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i)
  }
  downloadBlob(new Blob([bytes], { type: mimeType }), filename)
}

/** Fetch a URL and trigger a download from the response blob */
export async function downloadFromUrl(url: string, filename: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error("Download failed")
  const blob = await response.blob()
  downloadBlob(blob, filename)
}
