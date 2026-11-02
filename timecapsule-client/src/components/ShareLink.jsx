import { useId } from "react";
import { shareUrl } from "../links";
import CopyLinkButton from "./CopyLinkButton";

// The link to a shared capsule's public page, to copy and send to people.
export default function ShareLink({ slug, sealed }) {
  const id = useId();
  const url = shareUrl(slug);
  return (
    <div>
      <label htmlFor={id} className="font-semibold">
        Share it with a link
      </label>
      <p id={`${id}-hint`} className="mt-0.5 text-sm text-slate">
        {sealed
          ? "Anyone with the link can read it once it opens. Until then, they only see when it opens."
          : "Anyone with the link can read it."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2 sm:flex-nowrap">
        <input
          id={id}
          value={url}
          readOnly
          aria-describedby={`${id}-hint`}
          onFocus={(event) => event.target.select()}
          className="field-input min-w-0 flex-1 basis-60 text-sm text-slate"
        />
        <CopyLinkButton url={url} className="btn btn-secondary shrink-0" />
      </div>
    </div>
  );
}
