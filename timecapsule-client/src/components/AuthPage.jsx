import { useEffect, useRef } from "react";
import usePageTitle from "../usePageTitle";

// The frame of the account pages (log in, sign up, passwords): one sheet with a
// heading, and links to the other account pages underneath.
export default function AuthPage({ title, intro, children, links }) {
  usePageTitle(title);
  const heading = useRef(null);
  const shownTitle = useRef(title);

  // When the page's step changes (the form is sent and "Check your email" takes
  // its place), the keyboard focus goes to the new heading, so screen readers
  // read the new step instead of staying on a button that is gone.
  useEffect(() => {
    if (shownTitle.current === title) return;
    shownTitle.current = title;
    heading.current?.focus();
  }, [title]);

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
      <div className="sheet airmail-top px-5 pt-9 pb-7 sm:px-8 sm:pt-11 sm:pb-9">
        <h1 ref={heading} tabIndex={-1} className="display text-2xl outline-none sm:text-3xl">
          {title}
        </h1>
        {intro && <p className="mt-3 text-slate">{intro}</p>}
        <div className="mt-7">{children}</div>
      </div>
      {links && <div className="mt-6 flex flex-col items-center gap-3">{links}</div>}
    </div>
  );
}
