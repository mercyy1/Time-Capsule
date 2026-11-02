import { createContext, useContext } from "react";

// Holds { user, token, login, logout }; AuthProvider.jsx supplies the value.
export const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);
