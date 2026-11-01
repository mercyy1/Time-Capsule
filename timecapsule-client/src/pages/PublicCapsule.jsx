import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../api";

export default function PublicCapsule() {
  const { slug } = useParams();
  const [capsule, setCapsule] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const fetchCapsule = async () => {
      try {
        const res = await api.get(`/capsules/public/${slug}`);
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
  }, [slug]);

  if (status === "loading") return <p>Loading...</p>;
  if (status === "error") return <p>Capsule not found.</p>;

  return (
    <div className="max-w-xl mx-auto mt-10 bg-white p-6 rounded shadow">
      {status === "locked" ? (
        <>
          <h2 className="text-xl font-semibold">🔒 Capsule Locked</h2>
          <p>Unlocks at: {new Date(capsule.unlocksAt).toLocaleString()}</p>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-bold mb-2">{capsule.title}</h2>
          <p className="text-gray-700 whitespace-pre-line">{capsule.message}</p>
          <p className="mt-4 text-sm text-gray-500">
            Unlocked at: {new Date(capsule.unlockDate).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}
