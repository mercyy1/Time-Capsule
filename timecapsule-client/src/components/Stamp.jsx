import { largestUnitLeft, timeLeft } from "../time";

// The stamp on a sealed capsule's envelope: its value is the time left, in the
// largest whole unit ("74 days"). Screen readers skip it: the page says when the
// capsule opens in words. `large` is for the capsule's own page (from tablet
// width up; phones keep the card size).
export default function Stamp({ until, now, large = false }) {
  const { value, unit } = largestUnitLeft(timeLeft(until, now));
  return (
    <div className="stamp shrink-0" aria-hidden="true">
      <div className="stamp-paper">
        <div className={`stamp-face ${large ? "sm:min-w-24 sm:px-3 sm:pt-3 sm:pb-2" : ""}`}>
          <span className={`display leading-none ${large ? "text-2xl sm:text-4xl" : "text-2xl"}`}>
            {value}
          </span>
          <span className="text-sm leading-tight font-semibold">{unit}</span>
        </div>
      </div>
    </div>
  );
}
