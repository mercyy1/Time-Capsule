import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import api from "../api";

// "Forgot your password?": emails a link to choose a new one.
export default function ForgotPassword() {
  const { register, handleSubmit } = useForm();
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  const onSubmit = async ({ email }) => {
    setError(null);
    setSending(true);
    try {
      const res = await api.post("/forgot-password", { email });
      setSent(res.data.message);
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 mt-10 bg-white rounded-sm shadow-sm">
      <h2 className="text-2xl mb-6 font-semibold">Reset your password</h2>
      {sent ? (
        <p className="mb-4 text-green-700">{sent}</p>
      ) : (
        <>
          <p className="mb-4">
            Enter your email address and we'll email you a link to choose a new password.
          </p>
          {error && <p className="mb-4 text-red-600">{error}</p>}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <input
              {...register("email", { required: true })}
              type="email"
              placeholder="Email"
              className="input"
              required
            />
            <button type="submit" className="btn btn-primary w-full" disabled={sending}>
              {sending ? "Sending…" : "Email me a link"}
            </button>
          </form>
        </>
      )}
      <p className="mt-4 text-center">
        <Link to="/login" className="text-blue-600 hover:underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
