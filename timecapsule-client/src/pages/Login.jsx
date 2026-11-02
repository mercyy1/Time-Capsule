import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import { showApiError } from "../apiErrors";
import AuthPage from "../components/AuthPage";
import Field from "../components/Field";
import Notice from "../components/Notice";
import { useAuth } from "../context/AuthContext";
import { emailRules } from "../validation";

export default function Login() {
  const location = useLocation();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    // Filled in when coming from the "email confirmed" page.
    defaultValues: { email: location.state?.email ?? "" },
  });
  const { login, sessionEnded } = useAuth();
  const navigate = useNavigate();
  // What went wrong with the last try: { tone, text }.
  const [problem, setProblem] = useState(null);
  // Where the user was going when they were sent here (see ProtectedRoute).
  const from = location.state?.from;

  const onSubmit = async (data) => {
    setProblem(null);
    try {
      const res = await api.post("/login", data);
      login(res.data.user, res.data.token);
      navigate(from ? `${from.pathname}${from.search}` : "/", { replace: true });
    } catch (err) {
      // An unconfirmed address isn't a mistake: a new link is on its way.
      const unconfirmed = err.response?.data?.code === "EMAIL_NOT_VERIFIED";
      const text = showApiError(err, setError, ["email", "password"], "Couldn't log you in.");
      if (text) setProblem({ tone: unconfirmed ? "info" : "error", text });
    }
  };

  return (
    <AuthPage
      title="Log in"
      links={
        <>
          <Link to="/forgot-password" className="link">
            Forgot your password?
          </Link>
          <p>
            New here?{" "}
            <Link to="/signup" className="link">
              Create an account
            </Link>
          </p>
        </>
      }
    >
      {problem ? (
        <Notice tone={problem.tone} className="mb-6">
          {problem.text}
        </Notice>
      ) : (
        sessionEnded && (
          <Notice className="mb-6">
            {sessionEnded}
            {from && " After that, you'll go back to the page you were on."}
          </Notice>
        )
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
        <Field label="Password" error={errors.password?.message}>
          {(props) => (
            <input
              {...props}
              {...register("password", { required: "Enter your password" })}
              type="password"
              autoComplete="current-password"
              className="field-input"
            />
          )}
        </Field>
        <button type="submit" className="btn btn-primary w-full" disabled={isSubmitting}>
          {isSubmitting ? "Logging in…" : "Log in"}
        </button>
      </form>
    </AuthPage>
  );
}
