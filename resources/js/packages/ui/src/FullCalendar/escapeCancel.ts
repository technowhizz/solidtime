/**
 * Escape-to-cancel handler scoped to the lifetime of a pointer drag.
 *
 * `listen()` is called alongside the drag's `pointermove`/`pointerup`
 * listeners and `stop()` alongside their removal, so the handler only exists
 * while a drag is actually in flight — no `isDragging` guard is needed inside.
 *
 * Registered in the capture phase so an in-flight drag consumes Escape before
 * any other layer (e.g. Reka UI's DismissableLayer) can act on it, rather than
 * the outcome depending on listener registration order.
 */
export function createEscapeCancel(onCancel: () => void) {
    function onKeyDown(e: KeyboardEvent) {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onCancel();
    }

    return {
        listen: () => document.addEventListener('keydown', onKeyDown, true),
        stop: () => document.removeEventListener('keydown', onKeyDown, true),
    };
}
