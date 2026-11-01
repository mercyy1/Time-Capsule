import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function Create() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [unlockDate, setUnlockDate] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      const res = await axios.post("http://localhost:5000/capsules", {
        title,
        message,
        unlockDate,
        isPublic,
      });
      navigate(`/capsule/${res.data.id}`);
    } catch (error) {
      alert("Failed to create capsule");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto p-4 space-y-4">
      <input
        type="text"
        placeholder="Title"
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        placeholder="Write your message"
        className="input h-32"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
      />
      <input
        type="datetime-local"
        className="input"
        value={unlockDate}
        onChange={(e) => setUnlockDate(e.target.value)}
        required
      />
      <label className="flex items-center space-x-2">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
        />
        <span>Make capsule public</span>
      </label>
      <button
        type="submit"
        className="btn bg-blue-600 text-white px-4 py-2 rounded"
      >
        Create Capsule
      </button>
    </form>
  );
}
