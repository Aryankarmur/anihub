import React, { useState, useEffect } from "react";
import { IoClose } from "react-icons/io5";
import { updateCollection } from "../firebase/firestore";
import "../assets/css/CollectionModal.css";

const EditCollectionModal = ({ isOpen, onClose, user, collection }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen && collection) {
      setName(collection.name || "");
      setDescription(collection.description || "");
      setError("");
    }
  }, [isOpen, collection]);

  const handleSave = async (e) => {
    e.preventDefault();
    
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Collection name is required.");
      return;
    }
    
    if (trimmedName.length > 100) {
      setError("Collection name must be 100 characters or less.");
      return;
    }

    const trimmedDesc = description.trim();
    if (trimmedDesc.length > 300) {
      setError("Description must be 300 characters or less.");
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await updateCollection(user.uid, collection.id, {
        name: trimmedName,
        description: trimmedDesc
      });
      onClose();
    } catch (err) {
      console.error(err);
      setError("Unable to update collection. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !collection) return null;

  return (
    <div className="modal-overlay align-center" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Collection</h3>
          <button className="close-btn" onClick={onClose}>
            <IoClose />
          </button>
        </div>

        <div className="modal-content">
          {error && <div className="modal-error">{error}</div>}

          <form className="create-form" onSubmit={handleSave}>
            <div className="form-group">
              <label htmlFor="edit-col-name">Name *</label>
              <input 
                type="text" 
                id="edit-col-name" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My Favorites"
                maxLength={100}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="edit-col-desc">Description (Optional)</label>
              <textarea 
                id="edit-col-desc" 
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Anime I want to remember..."
                maxLength={300}
              />
            </div>
            <div className="form-actions">
              <button 
                type="button" 
                className="btn-cancel" 
                onClick={onClose}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button type="submit" className="btn-submit" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EditCollectionModal;
