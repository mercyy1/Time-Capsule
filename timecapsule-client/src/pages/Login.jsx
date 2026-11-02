import { useForm } from "react-hook-form";
import { useAuth } from "../context/AuthContext";
import api from "../api";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useState } from "react";

export default function Login() {
  const location = useLocation();
  // Filled in when coming from the "email confirmed" page.
  const { register, handleSubmit } = useForm({
    defaultValues: { email: location.state?.email ?? "" },
  });
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  const onSubmit = async (data) => {
    setError(null);
    try {
      const res = await api.post("/login", data);
      login(res.data.user, res.data.token);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 mt-10 bg-white rounded shadow">
      <h2 className="text-2xl mb-6 font-semibold">Log In</h2>
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
          placeholder="Password"
          autoComplete="current-password"
          className="input"
          required
        />
        <button type="submit" className="btn btn-primary w-full">
          Log In
        </button>
      </form>
      <p className="mt-4 text-center">
        <Link to="/forgot-password" className="text-blue-600 hover:underline">
          Forgot your password?
        </Link>
      </p>
      <p className="mt-2 text-center">
        Don't have an account?{" "}
        <Link to="/signup" className="text-blue-600 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
