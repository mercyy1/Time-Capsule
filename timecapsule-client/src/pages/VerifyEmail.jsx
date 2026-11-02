import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { forgetLinkToken, readLinkToken } from "../linkToken";

// Opened from the link in the confirmation email sent after signing up.
export default function VerifyEmail() {
  const [token] = useState(readLinkToken);
  const [result, setResult] = useState(null); // { ok, message, email }
  const sent = useRef(false);

  useEffect(() => {
    forgetLinkToken();
    // In development, React runs effects twice; the link is sent once.
    if (!token || sent.current) return;
    sent.current = true;
    api
      .post("/verify-email", { token })
      .then((res) => setResult({ ok: true, message: res.data.message, email: res.data.email }))
      .catch((err) =>
        setResult({
          ok: false,
          message: err.response?.data?.error || "Something went wrong. Please try again.",
        }),
      );
  }, [token]);

  let content;
  if (!token) {
    content = (
      <p className="mb-4 text-red-600">
        This confirmation link is incomplete. Open it again from the email, or log in to get a new
        one.
      </p>
    );
  } else if (!result) {
    content = <p className="mb-4">Confirming your email address…</p>;
  } else {
    content = (
      <p className={`mb-4 ${result.ok ? "text-green-700" : "text-red-600"}`}>{result.message}</p>
    );
  }

  return (
    <div className="max-w-md mx-auto p-6 mt-10 bg-white rounded-sm shadow-sm">
      <h2 className="text-2xl mb-6 font-semibold">Confirm your email</h2>
      {content}
      {(!token || result) && (
        <Link
          to="/login"
          state={result?.email ? { email: result.email } : undefined}
          className="btn btn-primary inline-block"
        >
          Log in
        </Link>
      )}
    </div>
  );
}
