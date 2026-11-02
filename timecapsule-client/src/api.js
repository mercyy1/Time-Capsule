import axios from "axios";

// Set in .env (see .env.example); vite.config.js refuses to run without it.
const API_URL = import.meta.env.VITE_API_URL;

const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// The API's answers (401) when a request's login token no longer works: it
// expired (after a day), or the password was changed.
const SESSION_ENDED = new Set(["TOKEN_EXPIRED", "TOKEN_REVOKED", "INVALID_TOKEN", "AUTH_REQUIRED"]);

// Called with the error body ({ error, code }) when the API says the session
// ended. AuthProvider sets it.
let onSessionEnded = null;
export const setSessionEndedHandler = (handler) => {
  onSessionEnded = handler;
};

// Added here, once, rather than by a component: axios fixes a request's
// response handlers when the request starts, and pages start theirs before
// their parents' effects run.
api.interceptors.response.use(undefined, (error) => {
  const { status, data } = error.response ?? {};
  if (status === 401 && SESSION_ENDED.has(data?.code)) onSessionEnded?.(data);
  return Promise.reject(error);
});

export default api;
