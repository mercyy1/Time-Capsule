import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import api from "../api";
import { showApiError } from "../apiErrors";
import AuthPage from "../components/AuthPage";
import Field from "../components/Field";
import Notice from "../components/Notice";
import { emailRules, newPasswordRules } from "../validation";

export default function Signup() {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm();
  const [problem, setProblem] = useState(null);
  // The API's "check your email" message, once the signup is sent.
  const [sent, setSent] = useState(null);

  const onSubmit = async (data) => {
    setProblem(null);
    try {
      const res = await api.post("/signup", data);
      setSent(res.data.message);
    } catch (err) {
      setProblem(showApiError(err, setError, ["email", "password"], "Couldn't sign you up."));
    }
  };

  if (sent) {
    return (
      <AuthPage
        title="Check your email"
        links={
          <Link to="/login" className="link">
            Go to log in
          </Link>
        }
      >
        <Notice tone="success">{sent}</Notice>
        <p className="mt-5 text-sm text-slate">
          Nothing after a few minutes? Check your spam folder. Logging in with the password you
          chose also sends a new link.
        </p>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title="Create an account"
      intro="Write a message now and choose the day it opens. Until then, nobody can read it, not even you."
      links={
        <p>
          Already have an account?{" "}
          <Link to="/login" className="link">
            Log in
          </Link>
        </p>
      }
    >
      {problem && (
        <Notice tone="error" className="mb-6">
          {problem}
        </Notice>
      )}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <Field label="Email" error={errors.email?.message}>
          {(props) => (
            <input
              {...props}
              {...register("email", emailRules)}
              type="email"
              autoComplete="email"
              className="field-input"
            />
          )}
        </Field>
        <Field label="Password" hint="At least 8 characters." error={errors.password?.message}>
          {(props) => (
            <input
              {...props}
              {...register("password", newPasswordRules)}
              type="password"
              autoComplete="new-password"
              className="field-input"
            />
          )}
        </Field>
        <button type="submit" className="btn btn-primary w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating your account…" : "Create account"}
        </button>
      </form>
    </AuthPage>
  );
}
