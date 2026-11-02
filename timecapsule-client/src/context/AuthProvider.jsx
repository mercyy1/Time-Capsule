import React, { useState, useEffect } from "react";
import { AuthContext } from "./AuthContext";
import { setSessionEndedHandler } from "../api";

// These explain themselves; other ways a session ends get a general message.
const EXPLAINED = new Set(["TOKEN_EXPIRED", "TOKEN_REVOKED"]);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("user");
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  // Why the session ended, if the API ended it, for the login page to say.
  const [sessionEnded, setSessionEnded] = useState(null);

  useEffect(() => {
    if (user && token) {
      localStorage.setItem("user", JSON.stringify(user));
      localStorage.setItem("token", token);
    } else {
      localStorage.removeItem("user");
      localStorage.removeItem("token");
    }
  }, [user, token]);

  // When the API says the login token no longer works (see api.js), log out:
  // ProtectedRoute then sends the user to the login page, which says why and
  // brings them back afterwards.
  useEffect(() => {
    setSessionEndedHandler(({ code, error }) => {
      setSessionEnded(EXPLAINED.has(code) ? error : "Please log in again.");
      setUser(null);
      setToken(null);
    });
    return () => setSessionEndedHandler(null);
  }, []);

  const login = (userData, jwt) => {
    setUser(userData);
    setToken(jwt);
    setSessionEnded(null);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, sessionEnded }}>
      {children}
    </AuthContext.Provider>
  );
};
