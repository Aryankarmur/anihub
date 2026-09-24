import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { updateProfile } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";
import { getWatchlistCount, getCollectionCount, deleteUserData } from "../firebase/firestore";
import { deleteUserAccount, reauthenticateUser } from "../firebase/auth";
import "../assets/css/Profile.css";
import "../assets/css/CollectionModal.css";

const Profile = () => {
  const { currentUser, logout, resetPassword, updateUser } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState({ watchlist: 0, collections: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState("");
  const [updateLoading, setUpdateLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [showDeletePassword, setShowDeletePassword] = useState(false);

  useEffect(() => {
    if (currentUser) {
      setNewName(currentUser.displayName || "");
      loadStats();
    }
  }, [currentUser]);

  const loadStats = async () => {
    if (!currentUser) return;
    setStatsLoading(true);
    
    try {
      const [watchRes, collRes] = await Promise.all([
        getWatchlistCount(currentUser.uid),
        getCollectionCount(currentUser.uid)
      ]);
      
      setStats({
        watchlist: watchRes.data || 0,
        collections: collRes.data || 0
      });
    } catch (error) {
      console.error("Failed to load stats", error);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    if (!newName.trim() || newName.trim() === currentUser.displayName) {
      setIsEditing(false);
      return;
    }

    setUpdateLoading(true);
    setMessage({ type: "", text: "" });

    try {
      // 1. Update Firebase Auth Profile
      await updateProfile(currentUser, { displayName: newName.trim() });
      
      // 2. Update Firestore user document
      const userRef = doc(db, "users", currentUser.uid);
      await updateDoc(userRef, {
        displayName: newName.trim(),
        updatedAt: new Date()
      });

      // 3. Immediately reflect in context/navbar
      if (updateUser) {
        updateUser(currentUser);
      }
      
      setMessage({ type: "success", text: "Profile updated successfully." });
      setIsEditing(false);
    } catch (error) {
      setMessage({ type: "error", text: "Failed to update profile." });
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setMessage({ type: "", text: "" });
    try {
      const result = await resetPassword(currentUser.email);
      if (result.error) {
        setMessage({ type: "error", text: "Failed to send reset email. Please try again." });
      } else {
        setMessage({ type: "success", text: "Password reset email sent. Please check your inbox." });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to send reset email." });
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/");
    } catch (error) {
      setMessage({ type: "error", text: "Failed to log out." });
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      setDeleteError("Please enter your current password.");
      return;
    }

    setIsDeleting(true);
    setDeleteError("");
    
    try {
      // 1. Re-authenticate
      const reauthResult = await reauthenticateUser(deletePassword);
      if (reauthResult.error) {
        setDeleteError(reauthResult.error);
        setIsDeleting(false);
        return; // STOP. Firestore is untouched.
      }

      // 2. Delete Firestore Data
      await deleteUserData(currentUser.uid);
      
      // 3. Delete Auth Account
      const authResult = await deleteUserAccount();
      
      if (authResult.error) {
        setDeleteError(authResult.error);
        setIsDeleting(false);
        return;
      }
      
      // Success
      setIsDeleteModalOpen(false);
      setDeletePassword("");
      setShowDeletePassword(false);
      navigate("/");
    } catch (error) {
      console.error(error);
      setDeleteError("Unable to delete your account data. Please try again.");
      setIsDeleting(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="profile-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="auth-required">
          <h2>Profile</h2>
          <p>Please log in to view your profile and account settings.</p>
          <Link to="/login" className="explore-btn" style={{ background: 'var(--accent)', color: 'white', padding: '10px 24px', borderRadius: 'var(--radius-pill)', textDecoration: 'none', fontWeight: 600 }}>
            Log In
          </Link>
        </div>
      </div>
    );
  }

  const initial = currentUser.displayName 
    ? currentUser.displayName.charAt(0).toUpperCase() 
    : currentUser.email.charAt(0).toUpperCase();

  return (
    <div className="profile-container">
      {/* HEADER */}
      <div className="profile-header-card">
        <div className="profile-avatar">
          {initial}
        </div>
        
        {isEditing ? (
          <form className="edit-profile-form" onSubmit={handleUpdateProfile}>
            <input 
              type="text" 
              className="edit-input" 
              value={newName} 
              onChange={(e) => setNewName(e.target.value)} 
              placeholder="Display Name"
              required
              minLength="2"
              maxLength="30"
            />
            <div className="edit-actions">
              <button type="button" className="edit-btn cancel" onClick={() => { setIsEditing(false); setNewName(currentUser.displayName || ""); }}>Cancel</button>
              <button type="submit" className="edit-btn save" disabled={updateLoading}>
                {updateLoading ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <div className="profile-info">
            <h1>{currentUser.displayName || "Anime Fan"}</h1>
            <p>{currentUser.email}</p>
          </div>
        )}
      </div>

      {message.text && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* STATISTICS */}
      <div className="profile-section">
        <h2>Library Statistics</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-number">{statsLoading ? "-" : stats.watchlist}</span>
            <span className="stat-label">Watchlist</span>
          </div>
          <div className="stat-card">
            <span className="stat-number">{statsLoading ? "-" : stats.collections}</span>
            <span className="stat-label">Collections</span>
          </div>
        </div>
      </div>

      {/* ACCOUNT ACTIONS */}
      <div className="profile-section">
        <h2>Account</h2>
        <div className="account-actions">
          {!isEditing && (
            <button className="account-action-btn" onClick={() => setIsEditing(true)}>
              Edit Profile
            </button>
          )}
          <button className="account-action-btn" onClick={handleResetPassword}>
            Reset Password
          </button>
          <button className="account-action-btn danger" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>

      {/* DANGER ZONE */}
      <div className="profile-section">
        <h2>Danger Zone</h2>
        <div className="account-actions danger-zone-box">
          <p className="danger-text">Permanently delete your AniHub account and all data associated with it.</p>
          <button className="account-action-btn danger solid" onClick={() => setIsDeleteModalOpen(true)}>
            Delete Account
          </button>
        </div>
      </div>

      {/* DELETE CONFIRMATION MODAL */}
      {isDeleteModalOpen && (
        <div className="modal-overlay align-center" onClick={() => { 
          if (!isDeleting) { 
            setIsDeleteModalOpen(false); 
            setDeleteError("");
            setDeletePassword("");
            setShowDeletePassword(false);
          } 
        }}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ color: 'var(--danger)' }}>Delete your account?</h3>
            </div>
            <div className="modal-content">
              <p style={{ margin: 0, color: 'var(--text-1)' }}>This action is permanent and cannot be undone.</p>
              <ul className="delete-list">
                <li>Your AniHub account</li>
                <li>Your watchlist</li>
                <li>All of your collections</li>
                <li>All anime stored inside your collections</li>
                <li>Your saved profile information</li>
              </ul>
              
              <p style={{ marginTop: '16px', marginBottom: '8px', color: 'var(--text-1)' }}>
                To confirm, enter your current password.
              </p>
              
              <div className="input-group" style={{ position: 'relative', marginBottom: '16px' }}>
                <input
                  type={showDeletePassword ? "text" : "password"}
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Current password"
                  autoComplete="current-password"
                  disabled={isDeleting}
                  className="edit-input"
                  style={{ width: '100%', boxSizing: 'border-box', textAlign: 'left', paddingRight: '60px' }}
                />
                <button 
                  type="button" 
                  onClick={() => setShowDeletePassword(!showDeletePassword)}
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', fontSize: '0.85rem' }}
                  disabled={isDeleting}
                >
                  {showDeletePassword ? "Hide" : "Show"}
                </button>
              </div>
              
              {deleteError && (
                <div className="message error">
                  {deleteError}
                </div>
              )}
              
              <div className="form-actions">
                <button 
                  className="btn-cancel" 
                  onClick={() => {
                    setIsDeleteModalOpen(false);
                    setDeleteError("");
                    setDeletePassword("");
                    setShowDeletePassword(false);
                  }}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button 
                  className="btn-submit delete" 
                  onClick={handleDeleteAccount}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Verifying & Deleting..." : "Delete My Account"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;
