import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import api from "../api";
import { showApiError } from "../apiErrors";
import AuthPage from "../components/AuthPage";
import Field from "../components/Field";
import Notice from "../components/Notice";
import SecurityCheck from "../components/SecurityCheck";
import useSecurityCheck from "../useSecurityCheck";
import { emailRules } from "../validation";

// "Forgot your password?": emails a link to choose a new one.
export default function ForgotPassword() {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm();
  const [sent, setSent] = useState(null);
  const [problem, setProblem] = useState(null);
  const check = useSecurityCheck("forgot-password");

  const onSubmit = async ({ email }) => {
    setProblem(null);
    let captchaToken;
    try {
      captchaToken = await check.token();
    } catch (err) {
      setProblem(err.message);
      return;
    }
    try {
      const res = await api.post("/forgot-password", { email, captchaToken });
      setSent(res.data.message);
    } catch (err) {
      check.reset();
      setProblem(showApiError(err, setError, ["email"], "Couldn't send the link."));
    }
  };

  const backToLogIn = (
    <Link to="/login" className="link">
      Back to log in
    </Link>
  );

  if (sent) {
    return (
      <AuthPage title="Check your email" links={backToLogIn}>
        <Notice tone="success">{sent}</Notice>
        <p className="mt-5 text-sm text-slate">
          Nothing after a few minutes? Check your spam folder, or{" "}
          <button type="button" className="link" onClick={() => setSent(null)}>
            try another address
          </button>
          .
        </p>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title="Reset your password"
      intro="Enter your account's email address and we'll email you a link to choose a new password."
      links={backToLogIn}
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
        <SecurityCheck check={check} />
        <button type="submit" className="btn btn-primary w-full" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Email me a link"}
        </button>
      </form>
    </AuthPage>
  );
}
