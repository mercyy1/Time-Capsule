import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { forgetLinkToken, readLinkToken } from "../linkToken";

// Opened from the link in the password reset email. Choosing a new password logs
// the user in (and out everywhere else).
export default function ResetPassword() {
  const [token] = useState(readLinkToken);
  const { register, handleSubmit } = useForm();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(forgetLinkToken, []);

  const onSubmit = async ({ password, confirmPassword }) => {
    if (password !== confirmPassword) {
      setError("The two passwords don't match.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await api.post("/reset-password", { token, password });
      login(res.data.user, res.data.token);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 mt-10 bg-white rounded shadow">
      <h2 className="text-2xl mb-6 font-semibold">Choose a new password</h2>
      {!token ? (
        <p className="mb-4 text-red-600">
          This password reset link is incomplete. Open it again from the email, or ask for a new
          one.
        </p>
      ) : (
        <>
          {error && <p className="mb-4 text-red-600">{error}</p>}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <input
              {...register("password", { required: true })}
              type="password"
              placeholder="New password (at least 8 characters)"
              autoComplete="new-password"
              className="input"
              required
            />
            <input
              {...register("confirmPassword", { required: true })}
              type="password"
              placeholder="New password again"
              autoComplete="new-password"
              className="input"
              required
            />
            <button type="submit" className="btn btn-primary w-full" disabled={saving}>
              {saving ? "Saving…" : "Save and log in"}
            </button>
          </form>
        </>
      )}
      <p className="mt-4 text-center">
        <Link to="/forgot-password" className="text-blue-600 hover:underline">
          Ask for a new link
        </Link>
      </p>
    </div>
  );
}
