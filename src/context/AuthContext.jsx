import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { serverTimestamp } from "firebase/firestore";
import { auth } from "../firebase/firebaseConfig";
import { registerUser, loginUser, logoutUser, resetUserPassword } from "../firebase/auth";
import { getUserProfile, createUserProfile } from "../firebase/firestore";

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const syncedUidRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Avoid duplicate syncs for the same user session to prevent unnecessary Firestore writes
        if (syncedUidRef.current !== user.uid) {
          syncedUidRef.current = user.uid;
          try {
            const { data } = await getUserProfile(user.uid);
            
            // If profile doesn't exist, create it (handles both registration and first-time logins)
            if (!data) {
              await createUserProfile(user.uid, {
                uid: user.uid,
                displayName: user.displayName || user.email.split('@')[0],
                email: user.email,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
              });
            }
          } catch (error) {
            // Authentication should not unnecessarily fail just because profile sync encounters an error
            console.error("Profile sync encountered a non-fatal error:", error);
          }
        }
      } else {
        syncedUidRef.current = null;
      }
      
      setCurrentUser(user);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    loading,
    register: registerUser,
    login: loginUser,
    logout: logoutUser,
    resetPassword: resetUserPassword,
    updateUser: (user) => setCurrentUser({ ...user }),
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
