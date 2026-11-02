import { useForm } from "react-hook-form";
import api from "../api";
import { Link } from "react-router-dom";
import { useState } from "react";

export default function Signup() {
  const { register, handleSubmit } = useForm();
  const [error, setError] = useState(null);
  // The API's "check your email" message, once the signup is sent.
  const [sent, setSent] = useState(null);

  const onSubmit = async (data) => {
    setError(null);
    try {
      const res = await api.post("/signup", data);
      setSent(res.data.message);
    } catch (err) {
      setError(err.response?.data?.error || "Signup failed");
    }
  };

  if (sent) {
    return (
      <div className="max-w-md mx-auto p-6 mt-10 bg-white rounded-sm shadow-sm">
        <h2 className="text-2xl mb-6 font-semibold">Check your email</h2>
        <p className="mb-4 text-green-700">{sent}</p>
        <p className="mb-4 text-sm text-gray-600">
          Nothing after a few minutes? Check your spam folder. Logging in with the password you
          chose also sends a new link.
        </p>
        <Link to="/login" className="btn btn-primary inline-block">
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-6 mt-10 bg-white rounded-sm shadow-sm">
      <h2 className="text-2xl mb-6 font-semibold">Sign Up</h2>
      {error && <p className="mb-4 text-red-600">{error}</p>}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <input
          {...register("email", { required: true })}
          type="email"
          placeholder="Email"
          className="input"
          required
        />
        <input
          {...register("password", { required: true })}
          type="password"
          placeholder="Password (at least 8 characters)"
          autoComplete="new-password"
          className="input"
          required
        />
        <button type="submit" className="btn btn-primary w-full">
          Create Account
        </button>
      </form>
      <p className="mt-4 text-center">
        Already have an account?{" "}
        <Link to="/login" className="text-blue-600 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
