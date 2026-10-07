/** Copy from an explicit click. The fallback supports preview iframes that deny Clipboard API access. */
export async function copyText(text: string): Promise<void> {
  if (typeof document === 'undefined') throw new Error('Copy is only available in the browser')
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // Permissions policies can deny the async API inside an embedded preview.
  }
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = document.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : []
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;'
  document.body.appendChild(field)
  try {
    field.select()
    if (!document.execCommand('copy')) throw new Error('Copy was blocked. Please select and copy the text manually.')
  } catch {
    throw new Error('Copy was blocked. Please select and copy the text manually.')
  } finally {
    field.remove()
    active?.focus({ preventScroll: true })
    selection?.removeAllRanges()
    for (const range of ranges) selection?.addRange(range)
  }
}
