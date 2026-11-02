import { formatDateTime, formatDay } from "../time";
import Countdown from "./Countdown";
import Stamp from "./Stamp";

// A sealed capsule, full size: an airmail envelope with the time left on its
// stamp, addressed with its title. People who aren't its owner don't get the
// title while it's sealed, so theirs has none.
export default function SealedCapsule({ title, unlocksAt, createdAt, now, onDone, late }) {
  return (
    <section
      aria-labelledby="capsule-title"
      className="envelope envelope-lg px-5 py-6 sm:px-10 sm:py-9"
    >
      <div className="flex items-start justify-between gap-6">
        <p className="pt-1 text-sm text-slate">{createdAt && `Sealed ${formatDay(createdAt)}`}</p>
        <Stamp until={unlocksAt} now={now} large />
      </div>
      <div className="mt-8 sm:mt-12 sm:pl-[18%]">
        <h1
          id="capsule-title"
          className={`font-letter text-2xl wrap-anywhere sm:text-3xl ${title ? "" : "text-slate"}`}
        >
          {title ?? "A sealed capsule"}
        </h1>
        <p className="mt-4">
          Don't open before{" "}
          <time dateTime={new Date(unlocksAt).toISOString()} className="font-semibold">
            {formatDateTime(unlocksAt)}
          </time>
        </p>
        <Countdown
          until={unlocksAt}
          now={now}
          onDone={onDone}
          late={late}
          className="mt-1 text-slate"
        />
      </div>
    </section>
  );
}
