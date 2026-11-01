import { Link } from "react-router-dom";
import dayjs from "dayjs";

export default function CapsuleCard({ capsule }) {
  const now = dayjs();
  const unlockDate = dayjs(capsule.unlockDate);
  const isLocked = now.isBefore(unlockDate);

  return (
    <Link
      to={`/capsule/${capsule.id}`}
      className="block border border-gray-300 rounded p-4 mb-3 hover:shadow-md transition"
    >
      <div className="flex justify-between items-center mb-1">
        <h2 className="font-semibold text-lg truncate">{capsule.title}</h2>
        <span
          className={`px-2 py-0.5 rounded text-xs font-semibold ${
            capsule.isPublic ? "bg-green-200 text-green-800" : "bg-gray-200 text-gray-800"
          }`}
        >
          {capsule.isPublic ? "Public" : "Private"}
        </span>
      </div>
      <p className="text-sm text-gray-600 truncate">{capsule.message}</p>
      <p className="mt-1 text-xs text-gray-500">
        Unlocks on: {unlockDate.format("MMM D, YYYY h:mm A")} • {isLocked ? "Locked" : "Unlocked"}
      </p>
    </Link>
  );
}
