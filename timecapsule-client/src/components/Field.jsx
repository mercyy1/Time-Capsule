import { useId } from "react";

// A labelled form field: its label, the control, an optional hint and an error,
// tied together so screen readers read the hint and the error with the field.
// `children` is a function given the props the control needs:
//   <Field label="Email">{(props) => <input {...props} className="field-input" />}</Field>
export default function Field({ label, hint, error, children, className = "" }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block font-semibold">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error && (
        <p id={errorId} className="mt-1.5 text-sm font-medium text-airmail-red">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="mt-1.5 text-sm text-slate">
          {hint}
        </p>
      )}
    </div>
  );
}
