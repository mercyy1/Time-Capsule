import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../api";

export default function ViewCapsule() {
  const { slug } = useParams();
  const [capsule, setCapsule] = useState(null);
  const [status, setStatus] = useState("loading");
  const [countdown, setCountdown] = useState("");

  useEffect(() => {
    const fetchCapsule = async () => {
      setStatus("loading");
      try {
        const res = await api.get(`/capsules/${slug}`);
        if (res.data.status === "locked") {
          setCapsule({ unlocksAt: res.data.unlocksAt });
          setStatus("locked");
        } else if (res.data.status === "unlocked") {
          setCapsule(res.data.capsule);
          setStatus("unlocked");
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    };

    fetchCapsule();
    const interval = setInterval(fetchCapsule, 10000);
    return () => clearInterval(interval);
  }, [slug]);

  // Countdown for locked status
  useEffect(() => {
    if (status !== "locked" || !capsule?.unlocksAt) return;

    const target = new Date(capsule.unlocksAt).getTime();

    const tick = () => {
      const diff = target - Date.now();
      if (diff <= 0) {
        setCountdown("Unlocking…");
        clearInterval(interval); 
        return;
      }
      const hrs = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setCountdown(`${hrs > 0 ? hrs + "h " : ""}${mins}m ${secs}s`);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [capsule, status]);

  if (status === "loading") return <p className="p-6">Loading...</p>;
  if (status === "error") return <p className="p-6">Capsule not found or error occurred.</p>;

  return (
    <div className="max-w-xl mx-auto p-6 bg-white shadow-lg rounded mt-8">
      <h2 className="text-2xl font-bold mb-4">{capsule.title || "Time Capsule"}</h2>
      <p className="text-gray-600 mb-2">
        Unlocks at: {new Date(capsule.unlockDate || capsule.unlocksAt).toLocaleString()}
      </p>

      {status === "unlocked" ? (
        <p className="mt-4 whitespace-pre-line">{capsule.message}</p>
      ) : (
        <>
          <p className="italic text-gray-500 mb-2">🔒 This capsule is still locked.</p>
          <p className="text-blue-700 font-medium">⏳ Countdown: {countdown}</p>
        </>
      )}
    </div>
  );
}
