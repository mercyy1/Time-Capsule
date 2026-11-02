// A message about what just happened. Errors are announced at once by screen
// readers (role="alert"); other notices when they're free (role="status").
const TONES = {
  info: "border-airmail-blue/40 bg-airmail-blue/5",
  success: "border-airmail-blue/40 bg-airmail-blue/5",
  error: "border-airmail-red/50 bg-airmail-red/5 text-airmail-red",
};

export default function Notice({ tone = "info", children, className = "" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-[3px] border-l-4 px-4 py-3 ${TONES[tone]} ${className}`}
    >
      {children}
    </div>
  );
}
