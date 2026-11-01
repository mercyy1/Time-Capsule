// ViewCapsule.jsx
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../api";

export default function ViewCapsule() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [capsule, setCapsule] = useState(null);
  const [status, setStatus] = useState("loading");
  const [countdown, setCountdown] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const fetchCapsule = async () => {
      try {
        const res = await api.get(`/capsules/slug/${slug}`);
        if (res.data.status === "locked") {
          setStatus("locked");
          setCapsule(res.data);
        } else {
          setStatus("unlocked");
          setCapsule(res.data.capsule);
        }
      } catch {
        setStatus("error");
      }
    };

    fetchCapsule();
    const interval = setInterval(fetchCapsule, 10000);
    return () => clearInterval(interval);
  }, [slug]);

  // Countdown effect
  useEffect(() => {
    if (!capsule?.unlocksAt || status !== "locked") return;

    const targetTime = new Date(capsule.unlocksAt);

    const updateCountdown = () => {
      const now = new Date();
      const diff = targetTime - now;

      if (diff <= 0) {
        setCountdown("Unlocking...");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setCountdown(
        `${hours > 0 ? hours + "h " : ""}${minutes}m ${seconds}s`
      );
    };

    updateCountdown();
    const countdownInterval = setInterval(updateCountdown, 1000);
    return () => clearInterval(countdownInterval);
  }, [capsule, status]);

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this capsule?")) return;
    try {
      setDeleting(true);
      await api.delete(`/capsules/${capsule.id}`);
      alert("Capsule deleted successfully.");
      navigate("/");
    } catch {
      alert("Failed to delete capsule.");
    } finally {
      setDeleting(false);
    }
  };

  if (status === "loading") return <p className="p-6">Loading...</p>;
  if (status === "error") return <p className="p-6">Capsule not found or error occurred.</p>;

  const isUnlocked = new Date(capsule.unlockDate) <= new Date();

  return (
    <div className="max-w-xl mx-auto p-6 bg-white shadow-lg rounded mt-8">
      <h2 className="text-2xl font-bold mb-4">{capsule.title}</h2>
      <p className="text-gray-600 mb-2">
        Unlocks at: {new Date(capsule.unlockDate).toLocaleString()}
      </p>

      {status === "locked" ? (
        <p className="italic text-gray-500">⏳ Countdown: {countdown}</p>
      ) : (
        <p className="mt-4 whitespace-pre-line">{capsule.message}</p>
      )}

      <button
        className="mt-6 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
        onClick={handleDelete}
        disabled={deleting}
      >
        {deleting ? "Deleting..." : "Delete Capsule"}
      </button>
    </div>
  );
}