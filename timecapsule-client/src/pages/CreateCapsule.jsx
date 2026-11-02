import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import api from "../api";
import { showApiError } from "../apiErrors";
import Field from "../components/Field";
import Notice from "../components/Notice";
import { capsulePath } from "../links";
import {
  describeTimeLeft,
  formatDateTime,
  formatTime,
  formatWallTime,
  readLocalDateTime,
  timeLeft,
  timeZoneLabel,
  toLocalInputValue,
} from "../time";
import useNow from "../useNow";
import usePageTitle from "../usePageTitle";
import { emailRules } from "../validation";

// The API's limits (see the README's input rules), checked here first.
const TITLE_MAX = 200;
const MESSAGE_MAX = 10_000;
const MAX_YEARS_AHEAD = 50;

// The fields that show the API's complaints under them.
const FIELDS = ["title", "message", "unlockDate", "recipientEmail"];

const yearsFromNow = (years, now = new Date()) => {
  const date = new Date(now);
  date.setFullYear(date.getFullYear() + years);
  return date;
};

const rules = {
  title: {
    validate: (value) => value.trim() !== "" || "Give it a title",
    maxLength: { value: TITLE_MAX, message: `Use at most ${TITLE_MAX} characters` },
  },
  message: {
    validate: (value) => value.trim() !== "" || "Write a message",
    maxLength: {
      value: MESSAGE_MAX,
      message: `Use at most ${MESSAGE_MAX.toLocaleString()} characters`,
    },
  },
  unlockDate: {
    validate: (value) => {
      if (!value) return "Choose when it opens";
      const picked = readLocalDateTime(value);
      if (!picked) return "Enter a date and a time";
      if (picked.date <= new Date()) return "Choose a time in the future";
      if (picked.date > yearsFromNow(MAX_YEARS_AHEAD)) {
        return `Choose a time within ${MAX_YEARS_AHEAD} years`;
      }
      return true;
    },
  },
  // Optional: checked only when filled in.
  recipientEmail: { maxLength: emailRules.maxLength, pattern: emailRules.pattern },
};

export default function CreateCapsule() {
  usePageTitle("Write a capsule");
  const navigate = useNavigate();
  const [problem, setProblem] = useState(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: { title: "", message: "", unlockDate: "", recipientEmail: "", isPublic: false },
  });
  const [unlockValue, message] = useWatch({ control, name: ["unlockDate", "message"] });
  const now = useNow(60_000);

  const onSubmit = async ({ title, message, unlockDate, recipientEmail, isPublic }) => {
    setProblem(null);
    try {
      const { data } = await api.post("/capsules", {
        title: title.trim(),
        message: message.trim(),
        // The moment it names, in UTC ("2027-01-15T14:30:00.000Z"): the API stores
        // instants, and every page shows them in the reader's own time zone.
        unlockDate: readLocalDateTime(unlockDate).date.toISOString(),
        isPublic,
        recipientEmail: recipientEmail.trim() || null,
      });
      navigate(capsulePath(data.slug), { state: { notice: "Your capsule is sealed." } });
    } catch (err) {
      setProblem(showApiError(err, setError, FIELDS, "Couldn't seal your capsule."));
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="display text-3xl sm:text-4xl">Write a capsule</h1>
      <p className="mt-3 text-slate">
        Once it's sealed, nobody can read it before the day you choose, not even you. You can't
        change it, but you can delete it.
      </p>
      {problem && (
        <Notice tone="error" className="mt-6">
          {problem}
        </Notice>
      )}
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="sheet mt-8 space-y-7 p-5 sm:p-8"
      >
        <Field label="Title" error={errors.title?.message}>
          {(props) => (
            <input
              {...props}
              {...register("title", rules.title)}
              placeholder="Dear me, a year from now"
              className="field-input font-letter text-xl"
            />
          )}
        </Field>
        <Field
          label="Message"
          error={errors.message?.message}
          hint={
            message.length > MESSAGE_MAX * 0.9
              ? `${message.length.toLocaleString()} of ${MESSAGE_MAX.toLocaleString()} characters`
              : undefined
          }
        >
          {(props) => (
            <textarea
              {...props}
              {...register("message", rules.message)}
              rows={9}
              className="field-input font-letter text-lg/relaxed"
            />
          )}
        </Field>
        <Field
          label="Don't open before"
          error={errors.unlockDate?.message}
          hint={<OpeningHint value={unlockValue} now={now} />}
        >
          {(props) => (
            <input
              {...props}
              {...register("unlockDate", rules.unlockDate)}
              type="datetime-local"
              min={toLocalInputValue(new Date(now))}
              max={toLocalInputValue(yearsFromNow(MAX_YEARS_AHEAD, now))}
              className="field-input sm:w-auto"
            />
          )}
        </Field>
        <Field
          label="Email it to someone when it opens (optional)"
          error={errors.recipientEmail?.message}
          hint="They'll get the title and the message, and your email address so they can reply. You'll get an email when it opens either way."
        >
          {(props) => (
            <input
              {...props}
              {...register("recipientEmail", rules.recipientEmail)}
              type="email"
              autoComplete="off"
              className="field-input"
            />
          )}
        </Field>
        <div className="flex gap-3">
          <input
            id="isPublic"
            type="checkbox"
            {...register("isPublic")}
            aria-describedby="isPublic-hint"
            className="mt-0.5 size-5 shrink-0 accent-airmail-blue"
          />
          <div>
            <label htmlFor="isPublic" className="font-semibold">
              Share it with a link
            </label>
            <p id="isPublic-hint" className="mt-0.5 text-sm text-slate">
              Anyone with the link can see when it opens, and read it once it has. Leave this off to
              keep it to yourself.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-6">
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Sealing…" : "Seal capsule"}
          </button>
          <Link to="/" className="btn text-slate">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

// Under the date: the time zone it's read in, and once a time is picked, exactly
// when that is, with a warning on the nights clocks change.
function OpeningHint({ value, now }) {
  const picked = readLocalDateTime(value);
  const future = picked && picked.date > now;
  return (
    <>
      <span className="block">Your time zone: {timeZoneLabel()}.</span>
      {future && (
        <span className="mt-1 block text-ink">
          It opens {formatDateTime(picked.date)}, in{" "}
          {describeTimeLeft(timeLeft(picked.date, now), { seconds: false })}.
        </span>
      )}
      {future && picked.issue && (
        <span className="mt-2 block border-l-4 border-airmail-blue/50 bg-airmail-blue/5 px-3 py-2 text-ink">
          {picked.issue === "skipped"
            ? `The clocks go forward that night, so ${formatWallTime(value)} doesn't happen. It opens at ${formatTime(picked.date)} instead.`
            : `The clocks go back that night, so ${formatWallTime(value)} happens twice. It opens the first time, at ${formatTime(picked.date)}.`}
        </span>
      )}
    </>
  );
}
