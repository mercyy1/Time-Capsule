import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { errorMessage } from "../apiErrors";
import AuthPage from "../components/AuthPage";
import Notice from "../components/Notice";
import { forgetLinkToken, readLinkToken } from "../linkToken";

// Opened from the link in the confirmation email sent after signing up.
export default function VerifyEmail() {
  const [token] = useState(readLinkToken);
  // { ok, message, email } once the API has answered; { ok: false, retry: true }
  // when it couldn't be reached (the link itself may still work).
  const [result, setResult] = useState(null);
  const sent = useRef(false);

  const confirm = useCallback(
    () =>
      api
        .post("/verify-email", { token })
        .then((res) => setResult({ ok: true, message: res.data.message, email: res.data.email }))
        .catch((err) =>
          setResult({
            ok: false,
            message: errorMessage(err),
            retry: err.response?.data?.code !== "INVALID_LINK",
          }),
        ),
    [token],
  );

  useEffect(() => {
    forgetLinkToken();
    // In development, React runs effects twice; the link is sent once.
    if (!token || sent.current) return;
    sent.current = true;
    confirm();
  }, [token, confirm]);

  if (!token) {
    return (
      <AuthPage title="This link is incomplete" links={<LogInLink />}>
        <p>
          Open the link again from the email. If it still doesn't work, log in: that sends a new
          one.
        </p>
      </AuthPage>
    );
  }

  if (!result) {
    return (
      <AuthPage title="Confirming your email">
        <p role="status">One moment…</p>
      </AuthPage>
    );
  }

  if (result.ok) {
    return (
      <AuthPage title="Email confirmed">
        <Notice tone="success">{result.message}</Notice>
        <Link to="/login" state={{ email: result.email }} className="btn btn-primary mt-6 w-full">
          Log in
        </Link>
      </AuthPage>
    );
  }

  return (
    <AuthPage title="Couldn't confirm your email" links={<LogInLink />}>
      <Notice tone="error">{result.message}</Notice>
      {result.retry && (
        <button
          type="button"
          className="btn btn-secondary mt-6 w-full"
          onClick={() => {
            setResult(null);
            confirm();
          }}
        >
          Try again
        </button>
      )}
    </AuthPage>
  );
}

function LogInLink() {
  return (
    <Link to="/login" className="link">
      Go to log in
    </Link>
  );
}
