import { useForm } from "react-hook-form";
import { useAuth } from "../context/AuthContext";
import api from "../api";
import { useNavigate, Link } from "react-router-dom";
import { useState } from "react";

export default function Signup() {
  const { register, handleSubmit } = useForm();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  const onSubmit = async (data) => {
    setError(null);
    try {
      const res = await api.post("/signup", data);
      login(res.data.user, res.data.token);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Signup failed");
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 mt-10 bg-white rounded shadow">
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
          placeholder="Password"
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
