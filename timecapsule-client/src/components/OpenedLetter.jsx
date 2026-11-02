import { formatDateTime, formatDay } from "../time";

// An opened capsule: the letter, still showing where it was folded. `unfold`
// plays the one animation in the app, for a capsule that opens while you watch.
export default function OpenedLetter({ title, message, createdAt, unlockDate, unfold = false }) {
  return (
    <article aria-labelledby="capsule-title" className={unfold ? "unfold" : ""}>
      <div className="letter px-5 py-7 sm:px-14 sm:py-12">
        <p className="text-right text-sm text-slate">Written {formatDay(createdAt)}</p>
        <h1 id="capsule-title" className="mt-6 font-letter text-2xl wrap-anywhere sm:text-3xl">
          {title}
        </h1>
        <div className="mt-5 max-w-[65ch] font-letter text-lg/relaxed whitespace-pre-line wrap-anywhere">
          {message}
        </div>
      </div>
      <p className="mt-3 text-sm text-slate">
        Opened{" "}
        <time dateTime={new Date(unlockDate).toISOString()}>{formatDateTime(unlockDate)}</time>
      </p>
    </article>
  );
}
