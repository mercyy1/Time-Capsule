import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import CapsuleMissing from "../components/CapsuleMissing";
import Notice from "../components/Notice";
import OpenedLetter from "../components/OpenedLetter";
import SealedCapsule from "../components/SealedCapsule";
import { useAuth } from "../context/AuthContext";
import useCapsuleView from "../useCapsuleView";
import useNow from "../useNow";
import usePageTitle from "../usePageTitle";

// A shared capsule's public page (/public/:slug), for anyone with the link: when
// it opens, then the letter itself. Nothing else about it is shown.
export default function PublicCapsule() {
  const { slug } = useParams();
  const { user } = useAuth();
  const { phase, view, error, late, retry, open } = useCapsuleView(`/capsules/public/${slug}`);
  const sealed = view?.status === "locked";
  const now = useNow(sealed ? 1000 : 3_600_000);
  const [openedHere, setOpenedHere] = useState(false);
  usePageTitle(
    phase === "missing"
      ? "Capsule not found"
      : (view?.capsule?.title ?? (sealed ? "A sealed capsule" : "")),
  );

  if (phase === "missing") return <CapsuleMissing />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      {phase === "loading" && (
        <p role="status" className="text-slate">
          Loading the capsule…
        </p>
      )}
      {phase === "failed" && (
        <>
          <Notice tone="error">Couldn't load this capsule. {error}</Notice>
          <button type="button" className="btn btn-secondary mt-4" onClick={retry}>
            Try again
          </button>
        </>
      )}
      {phase === "ready" && (
        <>
          {sealed ? (
            <SealedCapsule
              unlocksAt={view.unlocksAt}
              now={now}
              late={late}
              onDone={() => {
                setOpenedHere(true);
                open();
              }}
            />
          ) : (
            <OpenedLetter {...view.capsule} unfold={openedHere} />
          )}
          <p className="mt-10 text-slate">
            TimeCapsule keeps a message sealed until the day you choose.{" "}
            <Link to={user ? "/create" : "/signup"} className="link">
              Write your own
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
