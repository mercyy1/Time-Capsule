import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import api from "../api";
import { showApiError } from "../apiErrors";
import AuthPage from "../components/AuthPage";
import Field from "../components/Field";
import Notice from "../components/Notice";
import { useAuth } from "../context/AuthContext";
import { forgetLinkToken, readLinkToken } from "../linkToken";
import { newPasswordRules } from "../validation";

// Opened from the link in the password reset email. Choosing a new password logs
// the user in (and out everywhere else).
export default function ResetPassword() {
  const [token] = useState(readLinkToken);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [problem, setProblem] = useState(null);

  useEffect(forgetLinkToken, []);

  const askAgain = (
    <Link to="/forgot-password" className="link">
      Ask for a new link
    </Link>
  );

  if (!token) {
    return (
      <AuthPage title="This link is incomplete" links={askAgain}>
        <p>Open the link again from the email, or ask for a new one.</p>
      </AuthPage>
    );
  }

  const onSubmit = async ({ password }) => {
    setProblem(null);
    try {
      const res = await api.post("/reset-password", { token, password });
      login(res.data.user, res.data.token);
      navigate("/", { replace: true, state: { notice: "Your new password is saved." } });
    } catch (err) {
      setProblem(showApiError(err, setError, ["password"], "Couldn't save your password."));
    }
  };

  return (
    <AuthPage
      title="Choose a new password"
      intro="Saving it logs you out on every other device."
      links={askAgain}
    >
      {problem && (
        <Notice tone="error" className="mb-6">
          {problem}
        </Notice>
      )}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <Field label="New password" hint="At least 8 characters." error={errors.password?.message}>
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
        <Field label="Type it again" error={errors.confirmPassword?.message}>
          {(props) => (
            <input
              {...props}
              {...register("confirmPassword", {
                required: "Type the new password again",
                validate: (value, { password }) =>
                  value === password || "The two passwords don't match",
              })}
              type="password"
              autoComplete="new-password"
              className="field-input"
            />
          )}
        </Field>
        <button type="submit" className="btn btn-primary w-full" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save and log in"}
        </button>
      </form>
    </AuthPage>
  );
}
