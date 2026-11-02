import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api";
import { errorMessage } from "../apiErrors";
import CapsuleMissing from "../components/CapsuleMissing";
import ConfirmDialog from "../components/ConfirmDialog";
import Notice from "../components/Notice";
import OpenedLetter from "../components/OpenedLetter";
import SealedCapsule from "../components/SealedCapsule";
import ShareLink from "../components/ShareLink";
import useCapsuleView from "../useCapsuleView";
import useFlashNotice from "../useFlashNotice";
import useNow from "../useNow";
import usePageTitle from "../usePageTitle";

// A capsule, for a signed-in user: their own (with what only its owner can do),
// or someone else's shared one. Linked from the dashboard and from the email
// sent when it opens.
export default function ViewCapsule() {
  const { slug } = useParams();
  const { phase, view, error, late, retry, open } = useCapsuleView(`/capsules/slug/${slug}`);
  const notice = useFlashNotice();
  const sealed = view?.status === "locked";
  // Ticks every second while the countdown is showing.
  const now = useNow(sealed ? 1000 : 3_600_000);
  // Whether the capsule opened while this page was showing it.
  const [openedHere, setOpenedHere] = useState(false);
  const capsule = view?.capsule;
  usePageTitle(
    phase === "missing"
      ? "Capsule not found"
      : (capsule?.title ?? (sealed ? "A sealed capsule" : "")),
  );

  if (phase === "missing") return <CapsuleMissing />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <Link to="/" className="link text-sm">
        Back to your capsules
      </Link>
      {notice && (
        <Notice tone="success" className="mt-4">
          {notice}
        </Notice>
      )}
      <div className="mt-6">
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
        {phase === "ready" &&
          (sealed ? (
            <SealedCapsule
              title={capsule?.title}
              unlocksAt={view.unlocksAt}
              createdAt={capsule?.createdAt}
              now={now}
              late={late}
              onDone={() => {
                setOpenedHere(true);
                open();
              }}
            />
          ) : (
            <OpenedLetter {...capsule} unfold={openedHere} />
          ))}
      </div>
      {phase === "ready" &&
        (view.isOwner ? (
          <OwnerPanel capsule={capsule} sealed={sealed} />
        ) : (
          <p className="mt-10 text-slate">
            Want to send a message to the future yourself?{" "}
            <Link to="/create" className="link">
              Write your own
            </Link>
          </p>
        ))}
    </div>
  );
}

// What only the owner sees: who else gets it, its share link, and Delete.
function OwnerPanel({ capsule, sealed }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState(null);

  async function remove() {
    setDeleting(true);
    setProblem(null);
    try {
      await api.delete(`/capsules/${capsule.id}`);
      navigate("/", { replace: true, state: { notice: `Deleted “${capsule.title}”.` } });
    } catch (err) {
      // Already deleted (say, in another tab): the result is the same.
      if (err.response?.status === 404) {
        navigate("/", { replace: true, state: { notice: `Deleted “${capsule.title}”.` } });
        return;
      }
      setProblem(errorMessage(err));
      setDeleting(false);
    }
  }

  return (
    <section aria-label="Your capsule" className="mt-10 space-y-7 border-t border-rule pt-8">
      {capsule.recipientEmail && (
        <p className="wrap-anywhere">
          {capsule.recipientEmail} also gets it by email{sealed && " when it opens"}.
        </p>
      )}
      {capsule.isPublic ? (
        <ShareLink slug={capsule.slug} sealed={sealed} />
      ) : (
        <p className="text-slate">It isn't shared: only you can open it.</p>
      )}
      <div>
        <button
          type="button"
          className="btn btn-danger-outline"
          onClick={() => {
            setProblem(null);
            setConfirming(true);
          }}
        >
          Delete capsule
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete this capsule?"
        confirmLabel="Delete capsule"
        busyLabel="Deleting…"
        cancelLabel="Keep it"
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      >
        <p className="wrap-anywhere">
          “{capsule.title}” will be gone for good
          {capsule.isPublic && ", and its link will stop working"}. This can't be undone.
        </p>
        {problem && (
          <Notice tone="error" className="mt-4">
            {problem}
          </Notice>
        )}
      </ConfirmDialog>
    </section>
  );
}
