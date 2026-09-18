/**
 * One rule about when a keystroke belongs to the editor and when it belongs to
 * whatever the user is typing into.
 *
 * The markup editor sits nine single-letter tool shortcuts next to a text field
 * for a mark's note, and the canvas adds four more for zoom and pan. Without a
 * guard, writing "box" in a note switches the tool three times and a space bar
 * between two words starts panning the picture.
 *
 * It lives here, in its own module, because TWO components need it — the editor
 * owns the tool keys, the surface owns the zoom keys — and a second copy is a
 * second thing to remember when a new kind of input is added to the dialog.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}
