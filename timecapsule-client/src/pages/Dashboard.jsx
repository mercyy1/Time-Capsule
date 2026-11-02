import { useEffect, useState } from "react";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { useNavigate, Link } from "react-router-dom";

export default function Dashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [capsules, setCapsules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function fetchCapsules() {
      try {
        const res = await api.get("/capsules");
        setCapsules(res.data);
      } catch (err) {
        // 401: the session ended, and AuthProvider is taking the user to log in.
        if (err.response?.status !== 401) alert("Failed to load capsules");
      }
      setLoading(false);
    }
    fetchCapsules();
  }, []);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const filteredCapsules = capsules.filter((c) =>
    c.title?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Your Time Capsules</h1>
        <button onClick={handleLogout} className="btn btn-primary px-3 py-1" title="Logout">
          Logout
        </button>
      </div>

      <div className="mb-4 flex space-x-2">
        <input
          type="text"
          placeholder="Search capsules..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
        />
        <Link to="/create" className="btn btn-primary whitespace-nowrap">
          + New Capsule
        </Link>
      </div>

      {loading ? (
        <p>Loading capsules...</p>
      ) : filteredCapsules.length === 0 ? (
        <p>No capsules found.</p>
      ) : (
        filteredCapsules.map((c) => {
          const isUnlocked = new Date(c.unlockDate) <= new Date();

          return (
            <div
              key={c.id}
              className="border border-gray-200 rounded-sm p-4 mb-4 bg-white shadow-sm cursor-pointer hover:bg-gray-50"
              //   onClick={() => navigate(`/capsule/${c.slug || c.id}`)}
              onClick={() =>
                c.isPublic
                  ? window.open(`/public/${c.slug}`, "_blank")
                  : navigate(`/capsule/${c.slug}`)
              }
            >
              <h3 className="text-xl font-semibold mb-2">{c.title}</h3>

              <p className="text-sm text-gray-600 mb-2">
                Unlocks at: {new Date(c.unlockDate).toLocaleString()}
              </p>

              {c.recipientEmail && (
                <p className="text-sm text-gray-600 mb-2">
                  Emailed to {c.recipientEmail} when it opens
                </p>
              )}

              {isUnlocked ? (
                c.message ? (
                  <p className="mb-2">
                    {c.message.length > 100 ? c.message.slice(0, 100) + "..." : c.message}
                  </p>
                ) : (
                  <p className="italic text-gray-500 mb-2">No message found.</p>
                )
              ) : (
                <p className="italic text-gray-500 mb-2">This capsule is locked.</p>
              )}

              {c.isPublic && c.slug && (
                <p
                  className="text-blue-600 text-sm break-words"
                  onClick={(e) => e.stopPropagation()} // prevent card click
                >
                  Shareable Link:{" "}
                  <a
                    href={`/public/${c.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {window.location.origin}/public/{c.slug}
                  </a>
                </p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
