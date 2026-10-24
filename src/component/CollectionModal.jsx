import React, { useState, useEffect } from "react";
import { IoClose } from "react-icons/io5";
import { IoCheckmark } from "react-icons/io5";
import { 
  getCollections, 
  createCollection, 
  checkInCollection, 
  addToCollection, 
  removeFromCollection,
  checkInCompleted,
  addToCompleted,
  removeFromCompleted,
  isReservedCollectionName,
  getFirestoreErrorMessage,
  SYSTEM_COLLECTION_COMPLETED
} from "../firebase/firestore";
import "../assets/css/CollectionModal.css";

const CollectionModal = ({ isOpen, onClose, user, animeData }) => {
  const [view, setView] = useState("list"); // "list" or "create"
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Create form state
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  
  // Track specific collection loading states during add/remove operations
  const [operationLoading, setOperationLoading] = useState({});

  useEffect(() => {
    if (isOpen && user) {
      fetchCollections();
      setView(animeData ? "list" : "create");
      setError("");
    }
  }, [isOpen, user, animeData]);

  const fetchCollections = async () => {
    setLoading(true);
    setError("");
    try {
      const { data: cols, error: fetchErr } = await getCollections(user.uid);
      if (fetchErr) throw fetchErr;

      // Only filter out legacy manual completed collections that have been confirmed migrated
      const customCols = (cols || []).filter((c) => !c._isMigratedLegacy);

      // Check if anime exists in each collection (if animeData is provided)
      let enrichedCols = [];
      if (animeData) {
        // 1. Check Completed built-in collection status safely
        let inCompleted = false;
        try {
          const compRes = await checkInCompleted(user.uid, animeData.animeId);
          inCompleted = Boolean(compRes?.data);
        } catch (compErr) {
          console.error("Error checking inCompleted in modal:", compErr);
        }

        const completedBuiltIn = {
          id: SYSTEM_COLLECTION_COMPLETED,
          name: "Completed",
          description: "Built-in collection (moves from Watchlist to Completed)",
          isSystem: true,
          inCollection: inCompleted
        };

        // 2. Check custom collections
        const enrichedCustom = await Promise.all(
          customCols.map(async (col) => {
            try {
              const { data: inCol } = await checkInCollection(user.uid, col.id, animeData.animeId);
              return { ...col, inCollection: Boolean(inCol) };
            } catch (err) {
              console.error(`Error checking inCollection for ${col.id}:`, err);
              return { ...col, inCollection: false };
            }
          })
        );

        enrichedCols = [completedBuiltIn, ...enrichedCustom];
      } else {
        enrichedCols = customCols;
      }
      
      setCollections(enrichedCols);
    } catch (err) {
      console.error("fetchCollections error:", err);
      setError(getFirestoreErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleCollection = async (collectionId, currentlyInCollection) => {
    setOperationLoading((prev) => ({ ...prev, [collectionId]: true }));
    setError("");
    
    try {
      if (collectionId === SYSTEM_COLLECTION_COMPLETED) {
        if (currentlyInCollection) {
          // Remove from Completed (restores to Watchlist)
          await removeFromCompleted(user.uid, animeData.animeId, true);
        } else {
          // Add to Completed (removes from Watchlist)
          await addToCompleted(user.uid, animeData);
        }
      } else {
        if (currentlyInCollection) {
          await removeFromCollection(user.uid, collectionId, animeData.animeId);
        } else {
          await addToCollection(user.uid, collectionId, animeData);
        }
      }
      
      // Update local state to immediately reflect the change
      setCollections(cols => 
        cols.map(c => 
          c.id === collectionId ? { ...c, inCollection: !currentlyInCollection } : c
        )
      );
    } catch (err) {
      console.error("handleToggleCollection error:", err);
      setError(getFirestoreErrorMessage(err));
    } finally {
      setOperationLoading((prev) => ({ ...prev, [collectionId]: false }));
    }
  };

  const handleCreateCollection = async (e) => {
    e.preventDefault();
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setError("Collection name is required.");
      return;
    }
    if (trimmedName.length > 50) {
      setError("Collection name must be 50 characters or less.");
      return;
    }
    if (isReservedCollectionName(trimmedName)) {
      setError(`"${trimmedName}" is a reserved system collection name.`);
      return;
    }

    setIsCreating(true);
    setError("");

    try {
      await createCollection(user.uid, {
        name: trimmedName,
        description: newDesc.trim()
      });
      
      // Clear form
      setNewName("");
      setNewDesc("");
      
      // Refresh the list view so the new collection is available
      await fetchCollections();
      if (animeData) {
        setView("list");
      } else {
        onClose();
      }
      
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to create collection.");
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay align-top" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{view === "list" && animeData ? "Add to Collection" : "New Collection"}</h3>
          <button className="close-btn" onClick={onClose}>
            <IoClose />
          </button>
        </div>

        <div className="modal-content">
          {error && <div className="modal-error">{error}</div>}

          {view === "list" ? (
            <>
              {loading ? (
                <div className="modal-loader">Loading collections...</div>
              ) : (
                <div className="collection-list">
                  {collections.length === 0 ? (
                    <div className="empty-state">No collections found.</div>
                  ) : (
                    collections.map(col => {
                      const isLegacyCompleted = !col.isSystem && col.name && col.name.trim().toLowerCase() === "completed";
                      return (
                        <div className="collection-item" key={col.id}>
                          <div className="collection-info">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="collection-name" title={col.name}>
                                {col.name}{isLegacyCompleted ? " (Custom)" : ""}
                              </span>
                              {col.isSystem && <span className="system-pill">Built-in</span>}
                              {isLegacyCompleted && (
                                <span className="system-pill" style={{ background: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24', borderColor: 'rgba(251, 191, 36, 0.35)' }}>Custom</span>
                              )}
                            </div>
                            {col.description && (
                              <span className="collection-desc" title={col.description}>{col.description}</span>
                            )}
                          </div>
                          <div className="collection-action">
                            <button 
                              className={`collection-btn ${col.inCollection ? "added" : ""}`}
                              onClick={() => handleToggleCollection(col.id, col.inCollection)}
                              disabled={operationLoading[col.id]}
                            >
                              {operationLoading[col.id] 
                                ? "..." 
                                : col.inCollection ? <><IoCheckmark /> Added</> : "Add"}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
              
              {!loading && (
                <button 
                  className="create-new-btn" 
                  onClick={() => {
                    setView("create");
                    setError("");
                  }}
                >
                  + Create New Collection
                </button>
              )}
            </>
          ) : (
            <form className="create-form" onSubmit={handleCreateCollection}>
              <div className="form-group">
                <label htmlFor="col-name">Name *</label>
                <input 
                  type="text" 
                  id="col-name" 
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. My Favorites"
                  maxLength={50}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="col-desc">Description (Optional)</label>
                <textarea 
                  id="col-desc" 
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Anime I want to remember..."
                  maxLength={200}
                />
              </div>
              <div className="form-actions">
                <button 
                  type="button" 
                  className="btn-cancel" 
                  onClick={() => {
                    if (animeData) {
                      setView("list");
                      setError("");
                    } else {
                      onClose();
                    }
                  }}
                  disabled={isCreating}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-submit" disabled={isCreating}>
                  {isCreating ? "Creating..." : "Create Collection"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default CollectionModal;
