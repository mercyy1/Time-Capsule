import { useEffect, useId, useRef } from "react";

// A question to answer before going on ("Delete this capsule?"), in the
// browser's own modal dialog: the rest of the page can't be reached while it's
// open, Esc cancels, and the focus returns to the button that opened it. The
// focus starts on the safe choice, which comes first.
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  busyLabel = confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const dialog = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      // Esc, or the dialog closing any other way, counts as "cancel".
      onClose={onCancel}
      className="sheet m-auto w-[min(30rem,calc(100%-2rem))] p-6 text-ink backdrop:bg-ink/45 sm:p-8"
    >
      <h2 id={titleId} className="display text-xl">
        {title}
      </h2>
      <div className="mt-3 text-slate">{children}</div>
      <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
