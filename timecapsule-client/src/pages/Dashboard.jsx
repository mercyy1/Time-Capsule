import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { errorMessage } from "../apiErrors";
import CopyLinkButton from "../components/CopyLinkButton";
import Notice from "../components/Notice";
import Stamp from "../components/Stamp";
import { capsulePath, shareUrl } from "../links";
import { formatDay, formatShortDateTime, timeLeft } from "../time";
import useFlashNotice from "../useFlashNotice";
import useNow from "../useNow";
import usePageTitle from "../usePageTitle";

// Each card is one link (its title) stretched over the whole card, so the card
// is a single stop for the keyboard and a single target for a click; its other
// controls sit above the stretched part. The card shows the link's focus.
const CARD =
  "relative flex flex-col has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-airmail-blue";
const CARD_LINK = "after:absolute after:inset-0 focus-visible:outline-none hover:underline";

export default function Dashboard() {
  usePageTitle("Your capsules");
  const notice = useFlashNotice();
  // The stamps count down in whole minutes.
  const now = useNow(60_000);
  const [state, setState] = useState({ phase: "loading" });
  const [search, setSearch] = useState("");
  const searchId = useId();

  // A 401 doesn't land here as an error: the session ended, and AuthProvider
  // sends the user to log in.
  const load = useCallback(
    () =>
      api.get("/capsules").then(
        (res) => setState({ phase: "ready", capsules: res.data }),
        (err) => setState({ phase: "failed", error: errorMessage(err) }),
      ),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const capsules = state.capsules ?? [];
  const query = search.trim().toLowerCase();
  const shown = capsules.filter((c) => c.title.toLowerCase().includes(query));
  // The API hides the message of a sealed capsule, and sends them soonest first.
  const sealed = shown.filter((c) => c.message === null);
  const opened = shown.filter((c) => c.message !== null).reverse();

  let content;
  if (state.phase === "loading") {
    content = (
      <p role="status" className="mt-10 text-slate">
        Loading your capsules…
      </p>
    );
  } else if (state.phase === "failed") {
    content = (
      <div className="mt-8">
        <Notice tone="error">Couldn't load your capsules. {state.error}</Notice>
        <button
          type="button"
          className="btn btn-secondary mt-4"
          onClick={() => {
            setState({ phase: "loading" });
            load();
          }}
        >
          Try again
        </button>
      </div>
    );
  } else if (capsules.length === 0) {
    content = <EmptyState />;
  } else if (shown.length === 0) {
    content = (
      <div className="mt-10" role="status">
        <p>No capsule titles match “{search.trim()}”.</p>
        <button type="button" className="link mt-2" onClick={() => setSearch("")}>
          Clear the search
        </button>
      </div>
    );
  } else {
    content = (
      <>
        {sealed.length > 0 && (
          <section aria-labelledby="sealed" className="mt-10">
            <h2 id="sealed" className="display text-xl">
              Sealed
            </h2>
            <ul className="mt-4 grid gap-6 md:grid-cols-2">
              {sealed.map((capsule) => (
                <EnvelopeCard key={capsule.id} capsule={capsule} now={now} />
              ))}
            </ul>
          </section>
        )}
        {opened.length > 0 && (
          <section aria-labelledby="opened" className="mt-12">
            <h2 id="opened" className="display text-xl">
              Opened
            </h2>
            <ul className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {opened.map((capsule) => (
                <LetterCard key={capsule.id} capsule={capsule} />
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <h1 className="display text-3xl sm:text-4xl">Your capsules</h1>
        {capsules.length > 0 && (
          <div className="w-full sm:w-72">
            <label htmlFor={searchId} className="mb-1.5 block text-sm font-semibold">
              Find a capsule by its title
            </label>
            <input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="field-input"
            />
          </div>
        )}
      </div>
      {notice && (
        <Notice tone="success" className="mt-6">
          {notice}
        </Notice>
      )}
      {content}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-10 rounded-[3px] border-2 border-dashed border-rule px-6 py-12 text-center sm:py-16">
      <h2 className="display text-xl">Nothing sealed yet</h2>
      <p className="mx-auto mt-2 max-w-md text-slate">
        Write a message for a day you choose: a birthday, a graduation, next New Year's Eve. It
        stays sealed until then.
      </p>
      <Link to="/create" className="btn btn-primary mt-6">
        Write your first capsule
      </Link>
    </div>
  );
}

// A sealed capsule: an envelope, its stamp showing the time left.
function EnvelopeCard({ capsule, now }) {
  const due = timeLeft(capsule.unlockDate, now).total === 0;
  return (
    <li className={`envelope ${CARD} min-h-56 p-5 sm:p-6`}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-slate">Sealed {formatDay(capsule.createdAt)}</p>
        <Stamp until={capsule.unlockDate} now={now} />
      </div>
      {/* The address: the same height on every envelope in a row. */}
      <div className="mt-5 sm:pl-[12%]">
        <h3 className="font-letter text-xl/snug wrap-anywhere">
          <Link to={capsulePath(capsule.slug)} className={CARD_LINK}>
            {capsule.title}
          </Link>
        </h3>
        <p className="mt-1 text-sm text-slate">
          {due ? "Ready to open" : `Don't open before ${formatShortDateTime(capsule.unlockDate)}`}
        </p>
      </div>
      <CardFooter capsule={capsule} className="mt-auto pt-5" />
    </li>
  );
}

// An opened capsule: a page of the letter, with the start of its message. (Its
// fold creases are left for the full letter: on a card they'd cross the text.)
function LetterCard({ capsule }) {
  return (
    <li className={`sheet ${CARD} p-5 sm:p-6`}>
      <p className="text-sm text-slate">Opened {formatDay(capsule.unlockDate)}</p>
      <h3 className="mt-3 font-letter text-xl/snug wrap-anywhere">
        <Link to={capsulePath(capsule.slug)} className={CARD_LINK}>
          {capsule.title}
        </Link>
      </h3>
      <p className="mt-2 line-clamp-3 font-letter text-slate wrap-anywhere">
        {capsule.message.slice(0, 400).replace(/\s+/g, " ")}
      </p>
      <CardFooter capsule={capsule} className="mt-auto pt-4" />
    </li>
  );
}

function CardFooter({ capsule, className }) {
  if (!capsule.isPublic && !capsule.recipientEmail) return null;
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-slate ${className}`}
    >
      <span className="wrap-anywhere">
        {capsule.recipientEmail && `Also emailed to ${capsule.recipientEmail}`}
      </span>
      {capsule.isPublic && (
        <CopyLinkButton
          url={shareUrl(capsule.slug)}
          keepWidth={false}
          className="link relative z-10 font-semibold"
        />
      )}
    </div>
  );
}
