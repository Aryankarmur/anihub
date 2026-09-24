import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IoTrashOutline } from "react-icons/io5";
import { useAuth } from "../context/AuthContext";
import Card from "../component/Card";
import SkeletonCard from "../component/SkeletonCard";
import CollectionModal from "../component/CollectionModal";
import EditCollectionModal from "../component/EditCollectionModal";
import { 
  subscribeToWatchlist, 
  subscribeToCollections, 
  subscribeToCollectionItems,
  removeFromWatchlist,
  removeFromCollection,
  deleteCollection
} from "../firebase/firestore";
import "../assets/css/MyLibrary.css";

// Helper to map Firestore library data to the format Card.jsx expects
const mapFirestoreToCardData = (item) => ({
  mal_id: item.animeId,
  title: item.title,
  large_image_url: item.image,
  score: item.score,
  episodes: item.type, // Map the format/type to the episodes display slot
});

const MyLibrary = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // Watchlist State
  const [watchlist, setWatchlist] = useState([]);
  const [watchlistLoading, setWatchlistLoading] = useState(true);

  // Collections State
  const [collections, setCollections] = useState([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  
  // Selected Collection State
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const [collectionItems, setCollectionItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Presentation State
  const [showAllWatchlist, setShowAllWatchlist] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 1. Subscribe to Watchlist
  useEffect(() => {
    if (!currentUser) return;
    
    setWatchlistLoading(true);
    const unsubscribe = subscribeToWatchlist(
      currentUser.uid,
      (data) => {
        // Sort newest first
        data.sort((a, b) => (b.addedAt?.toMillis() || 0) - (a.addedAt?.toMillis() || 0));
        setWatchlist(data);
        setWatchlistLoading(false);
      },
      (error) => {
        setWatchlistLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // 2. Subscribe to Collections list
  useEffect(() => {
    if (!currentUser) return;
    
    setCollectionsLoading(true);
    const unsubscribe = subscribeToCollections(
      currentUser.uid,
      (data) => {
        setCollections(data);
        setCollectionsLoading(false);
      },
      (error) => {
        setCollectionsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // 3. Subscribe to specific Collection Items when selected
  useEffect(() => {
    if (!currentUser || !selectedCollectionId) {
      setCollectionItems([]);
      return;
    }

    setItemsLoading(true);
    const unsubscribe = subscribeToCollectionItems(
      currentUser.uid,
      selectedCollectionId,
      (data) => {
        data.sort((a, b) => (b.addedAt?.toMillis() || 0) - (a.addedAt?.toMillis() || 0));
        setCollectionItems(data);
        setItemsLoading(false);
      },
      (error) => {
        setItemsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser, selectedCollectionId]);


  // Action Handlers
  const handleRemoveFromWatchlist = async (e, animeId) => {
    e.preventDefault(); // Prevent navigating to Anime Info
    e.stopPropagation();
    try {
      await removeFromWatchlist(currentUser.uid, animeId);
    } catch (error) {
      alert("Failed to remove from watchlist.");
    }
  };

  const handleRemoveFromCollection = async (e, animeId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedCollectionId) return;
    
    try {
      await removeFromCollection(currentUser.uid, selectedCollectionId, animeId);
    } catch (error) {
      alert("Failed to remove from collection.");
    }
  };

  const handleDeleteCollection = async () => {
    if (!selectedCollectionId) return;
    const confirmDelete = window.confirm(
      "Delete this collection? Anime inside the collection will no longer be available here."
    );
    if (!confirmDelete) return;

    try {
      await deleteCollection(currentUser.uid, selectedCollectionId);
      setSelectedCollectionId(null);
    } catch (error) {
      alert("Failed to delete collection.");
    }
  };

  // Render Authentication Wall
  if (!currentUser) {
    return (
      <div className="library-container">
        <div className="auth-required">
          <h2>My Library</h2>
          <p>Please log in to view and manage your personal watchlist and collections.</p>
          <Link to="/login" className="explore-btn" style={{ background: 'var(--accent)', color: 'white', padding: '10px 24px', borderRadius: 'var(--radius-pill)', textDecoration: 'none', fontWeight: 600 }}>
            Log In
          </Link>
        </div>
      </div>
    );
  }

  // Find currently selected collection metadata
  const selectedCollection = collections.find(c => c.id === selectedCollectionId);

  // Watchlist presentation limits
  const displayLimit = isMobile ? 6 : 12;
  const visibleWatchlist = showAllWatchlist ? watchlist : watchlist.slice(0, displayLimit);
  const hasMoreWatchlist = watchlist.length > displayLimit;

  return (
    <div className="library-container">
      <div className="library-header">
        <h1>My Library</h1>
        <p>Manage your watchlist and personal anime collections.</p>
      </div>

      {/* WATCHLIST SECTION */}
      <div className="library-section">
        <h2 className="section-title">Watchlist</h2>
        
        {watchlistLoading ? (
          <div className="grid-wrapper">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : watchlist.length > 0 ? (
          <>
            <div className="grid-wrapper">
              {visibleWatchlist.map(anime => (
                <div className="library-card-wrapper" key={anime.id}>
                  <button 
                    className="remove-btn" 
                    onClick={(e) => handleRemoveFromWatchlist(e, anime.id)}
                    title="Remove from Watchlist"
                  >
                    <IoTrashOutline />
                  </button>
                  <Card animeInfo={mapFirestoreToCardData(anime)} />
                </div>
              ))}
            </div>
            {hasMoreWatchlist && (
              <div className="show-more-container">
                <button 
                  className="show-more-btn"
                  onClick={() => setShowAllWatchlist(!showAllWatchlist)}
                >
                  {showAllWatchlist ? "Show Less ↑" : "Show More ↓"}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="library-empty-state">
            <p>Your watchlist is empty.</p>
            <p style={{fontSize: '0.9rem'}}>Add anime from the Anime Info page and they will appear here.</p>
            <Link to="/catalog" className="explore-btn">Explore Anime</Link>
          </div>
        )}
      </div>

      {/* COLLECTIONS SECTION */}
      <div className="library-section">
        <h2 className="section-title">Collections</h2>
        
        {collectionsLoading ? (
          <div className="collections-nav">
            <div className="collection-tab" style={{width: '120px', height: '60px', opacity: 0.5}}></div>
          </div>
        ) : (
          <div className="collections-nav">
            <div 
              className="collection-tab create-tab"
              onClick={() => setIsModalOpen(true)}
            >
              + Create Collection
            </div>
            {collections.map(col => (
              <div 
                key={col.id}
                className={`collection-tab ${selectedCollectionId === col.id ? 'active' : ''}`}
                onClick={() => setSelectedCollectionId(col.id === selectedCollectionId ? null : col.id)}
              >
                <span>{col.name}</span>
                <span className="tab-count">Collection</span>
              </div>
            ))}
          </div>
        )}

        {/* ACTIVE COLLECTION VIEW */}
        {selectedCollectionId && selectedCollection && (
          <div className="active-collection-view">
            <div className="active-collection-header">
              <div className="active-collection-info">
                <h2>{selectedCollection.name}</h2>
                {selectedCollection.description && <p>{selectedCollection.description}</p>}
              </div>
              <div className="active-collection-actions">
                <button className="edit-collection-btn" onClick={() => setIsEditModalOpen(true)}>
                  Edit Collection
                </button>
                <button className="delete-collection-btn" onClick={handleDeleteCollection}>
                  Delete Collection
                </button>
              </div>
            </div>
            
            {itemsLoading ? (
              <div className="grid-wrapper">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : collectionItems.length > 0 ? (
              <div className="grid-wrapper">
                {collectionItems.map(anime => (
                  <div className="library-card-wrapper" key={anime.id}>
                    <button 
                      className="remove-btn" 
                      onClick={(e) => handleRemoveFromCollection(e, anime.id)}
                      title="Remove from Collection"
                    >
                      <IoTrashOutline />
                    </button>
                    <Card animeInfo={mapFirestoreToCardData(anime)} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="library-empty-state">
                <p>This collection is empty.</p>
                <p style={{fontSize: '0.9rem'}}>Add anime from an Anime Info page.</p>
              </div>
            )}
          </div>
        )}
        
        {!selectedCollectionId && collections.length === 0 && !collectionsLoading && (
          <div className="library-empty-state">
            <p>You haven't created any collections yet.</p>
            <button className="explore-btn" onClick={() => setIsModalOpen(true)}>
              + Create Collection
            </button>
          </div>
        )}
      </div>

      {/* REUSE THE COLLECTION MODAL FOR CREATION (No anime attached) */}
      <CollectionModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        user={currentUser}
        animeData={null} 
      />

      {/* EDIT COLLECTION MODAL */}
      <EditCollectionModal 
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        user={currentUser}
        collection={selectedCollection}
      />
    </div>
  );
};

export default MyLibrary;
