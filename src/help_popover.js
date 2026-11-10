// ============================================================================
// Help popover
// One non-modal help panel per trigger. Native Popover API when available,
// with a DOM fallback for the test harness and older engines.
// ============================================================================

const openPopovers = new Set();

export function createHelpPopover({ document: doc, trigger, panel } = {}) {
  if (!doc || !trigger || !panel) return null;

  const native = typeof panel.showPopover === "function" && typeof panel.hidePopover === "function";
  let open = false;
  let destroyed = false;

  const closeSelf = () => close({ focus: false });

  function setOpen(next, { focus = true } = {}) {
    if (destroyed || open === next) return;
    open = next;
    trigger.setAttribute("aria-expanded", String(open));
    panel.classList.toggle("is-open", open);
    if (open) {
      openPopovers.add(closeSelf);
      if (focus) panel.focus?.();
    } else {
      openPopovers.delete(closeSelf);
      if (focus) trigger.focus?.();
    }
  }

  function openPanel() {
    if (open || destroyed) return;
    for (const closePeer of openPopovers) closePeer();
    if (native) {
      panel.showPopover();
      if (!open) setOpen(true);
    } else {
      panel.hidden = false;
      setOpen(true);
    }
  }

  function close({ focus = true } = {}) {
    if (!open || destroyed) return;
    if (native) {
      panel.hidePopover();
      if (open) setOpen(false, { focus });
    } else {
      panel.hidden = true;
      setOpen(false, { focus });
    }
  }

  function toggle() {
    if (open) close();
    else openPanel();
  }

  function onToggle(event) {
    setOpen(event.newState === "open");
  }

  function onPointerDown(event) {
    if (!open) return;
    const target = event.target;
    if (panel.contains?.(target) || trigger.contains?.(target)) return;
    close({ focus: false });
  }

  function onKeyDown(event) {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    close();
  }

  function onTriggerClick(event) {
    event.preventDefault();
    toggle();
  }

  trigger.setAttribute("aria-expanded", String(open));
  panel.classList.toggle("is-open", open);

  if (native) {
    panel.addEventListener("toggle", onToggle);
  } else {
    panel.hidden = true;
    trigger.addEventListener("click", onTriggerClick);
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
  }

  return {
    open: openPanel,
    close,
    toggle,
    isOpen: () => open,
    destroy() {
      if (destroyed) return;
      close({ focus: false });
      destroyed = true;
      openPopovers.delete(closeSelf);
      if (native) panel.removeEventListener("toggle", onToggle);
      else {
        trigger.removeEventListener("click", onTriggerClick);
        doc.removeEventListener("pointerdown", onPointerDown, true);
        doc.removeEventListener("keydown", onKeyDown, true);
      }
    },
  };
}
