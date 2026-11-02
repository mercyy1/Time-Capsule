import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// A capsule link that leads nowhere: deleted, mistyped, or (the API won't say
// which) a capsule that isn't shared.
export default function CapsuleMissing() {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:py-24">
      <h1 className="display text-2xl sm:text-3xl">We can't find this capsule</h1>
      <p className="mt-3 text-slate">
        Its owner may have deleted it, or the link may be incomplete. Check that you copied all of
        it.
      </p>
      <Link to={user ? "/" : "/signup"} className="btn btn-primary mt-7">
        {user ? "Go to your capsules" : "Write a capsule of your own"}
      </Link>
    </div>
  );
}
