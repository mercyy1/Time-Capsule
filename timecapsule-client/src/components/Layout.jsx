import { useEffect, useRef } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// The current page's link (NavLink marks it aria-current="page") is plain text.
const navLink = ({ isActive }) => (isActive ? "font-semibold text-ink" : "link");

// Every page: the header (the wordmark, and what you can do from anywhere) and
// the page itself.
export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const main = useRef(null);
  const firstPage = useRef(true);

  // Moving to another page starts at its top, with the keyboard focus there too
  // (the browser does both on a full page load, but this app changes pages
  // without one), so screen readers start reading the new page.
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [pathname]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:bg-sheet focus:px-3 focus:py-2"
      >
        Skip to the page
      </a>
      <header className="border-b border-rule/80 bg-sheet/70">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="display flex items-baseline text-xl text-ink">
            TimeCapsule
          </Link>
          {user ? (
            <nav aria-label="Account" className="flex items-center gap-1 sm:gap-3">
              <NavLink to="/create" className="btn btn-primary">
                <span className="sm:hidden">Write</span>
                <span className="hidden sm:inline">Write a capsule</span>
              </NavLink>
              <button
                type="button"
                className="btn text-slate hover:text-ink"
                onClick={handleLogout}
              >
                Log out
              </button>
            </nav>
          ) : (
            <nav aria-label="Account" className="flex items-center gap-4 text-sm">
              <NavLink to="/login" className={navLink}>
                Log in
              </NavLink>
              <NavLink to="/signup" className={navLink}>
                Create an account
              </NavLink>
            </nav>
          )}
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
    </div>
  );
}
