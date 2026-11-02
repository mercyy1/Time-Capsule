// CreateCapsule.jsx
import { useForm } from "react-hook-form";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

export default function CreateCapsule() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const localISOTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const onSubmit = async (data) => {
    setError(null);
    setLoading(true);

    const payload = {
      title: data.title.trim(),
      message: data.message.trim(),
      unlockDate: new Date(data.unlockDate).toISOString(),
      isPublic: Boolean(data.isPublic),
      recipientEmail: data.recipientEmail.trim() || null,
    };

    try {
      await api.post("/capsules", payload);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create capsule");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-12 p-6 bg-white rounded-2xl shadow-lg">
      <h2 className="text-3xl font-bold mb-6 text-center">Create a Time Capsule</h2>

      {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-sm">{error}</div>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div>
          <label className="block font-medium mb-1">Title</label>
          <input
            type="text"
            {...register("title", { required: "Title is required" })}
            className="w-full input"
            placeholder="e.g. Dear Future Me"
          />
          {errors.title && <p className="text-red-600 text-sm mt-1">{errors.title.message}</p>}
        </div>

        <div>
          <label className="block font-medium mb-1">Message</label>
          <textarea
            rows={5}
            {...register("message", { required: "Message is required" })}
            className="w-full input"
            placeholder="Write something to your future self..."
          />
          {errors.message && <p className="text-red-600 text-sm mt-1">{errors.message.message}</p>}
        </div>

        <div>
          <label className="block font-medium mb-1">Unlock Date & Time</label>
          <input
            type="datetime-local"
            {...register("unlockDate", { required: "Unlock date is required" })}
            className="w-full input"
            min={localISOTime}
          />
          {errors.unlockDate && (
            <p className="text-red-600 text-sm mt-1">{errors.unlockDate.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="recipientEmail" className="block font-medium mb-1">
            Email it to someone when it opens (optional)
          </label>
          <input
            id="recipientEmail"
            type="email"
            {...register("recipientEmail")}
            className="w-full input"
            placeholder="friend@example.com"
            aria-describedby="recipientEmailHelp"
          />
          <p id="recipientEmailHelp" className="text-sm text-gray-600 mt-1">
            They'll get the title and the message, and your email address so they can reply. You'll
            get an email when it opens either way.
          </p>
        </div>

        <div className="flex items-center">
          <input type="checkbox" {...register("isPublic")} className="mr-2" />
          <label>Make this capsule public</label>
        </div>

        <button type="submit" className="btn btn-primary w-full" disabled={loading}>
          {loading ? "Creating..." : "Create Capsule"}
        </button>
      </form>
    </div>
  );
}
