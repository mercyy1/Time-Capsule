// The API answers errors as { error, code, details? } (see the README): `error`
// is a sentence for people, and `details` lists each invalid field.

// What to tell the user about a failed request.
export function errorMessage(err, fallback = "Something went wrong. Please try again.") {
  if (!err?.response) return "Can't reach TimeCapsule. Check your connection and try again.";
  return err.response.data?.error || fallback;
}

// The API's problems with each field, as { field: message }.
function fieldErrors(err) {
  const details = err?.response?.data?.details;
  if (!Array.isArray(details)) return {};
  return Object.fromEntries(details.map(({ field, message }) => [field, message]));
}

// Shows a failed request on a form: the API's problems with the form's `fields`
// go under those fields (react-hook-form's setError). Returns the message to show
// above the form, or null when the fields already say everything.
export function showApiError(err, setError, fields, fallback) {
  const problems = Object.entries(fieldErrors(err));
  const onFields = problems.filter(([field]) => fields.includes(field));
  for (const [field, message] of onFields) setError(field, { type: "server", message });
  return problems.length > 0 && onFields.length === problems.length
    ? null
    : errorMessage(err, fallback);
}
