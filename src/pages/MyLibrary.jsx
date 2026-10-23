/* eslint-disable react-hooks/set-state-in-effect -- existing subscription loading/reset behavior */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import CollectionModal from "../component/CollectionModal";
import EditCollectionModal from "../component/EditCollectionModal";
import WatchlistSection from "../component/WatchlistSection";
import CustomCollectionSection from "../component/CustomCollectionSection";
import CompletedSection from "../component/CompletedSection";
import * as groupingFeatureGate from "../firebase/groupingFeatureGate";

const isPresentationEnabled = () => {
  try {
    if (typeof groupingFeatureGate.isGroupingPresentationEnabled === "function") {
      return groupingFeatureGate.isGroupingPresentationEnabled();
    }
  } catch {
    // Fall back to isAnimeGroupingEnabled if mock does not define isGroupingPresentationEnabled
  }
  return Boolean(groupingFeatureGate.isAnimeGroupingEnabled);
};

import { 
  subscribeToWatchlist, 
  subscribeToCollections, 
  subscribeToCollectionItems, 
  subscribeToCompleted,
  removeFromWatchlist,
  removeFromCollection,
  removeFromCompleted,
  deleteCollection,
  getFirestoreErrorMessage,
  inspectLegacyMigration,
  migrateLegacyCompletedCollection,
  SYSTEM_COLLECTION_COMPLETED
} from "../firebase/firestore";
import "../assets/css/MyLibrary.css";

const MyLibrary = () => {
  const { currentUser } = useAuth();

  // Watchlist State
  const [watchlist, setWatchlist] = useState([]);
  const [watchlistLoading, setWatchlistLoading] = useState(true);

  // Collections State
  const [collections, setCollections] = useState([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);

  // Completed State (Built-in Collection)
  const [completedList, setCompletedList] = useState([]);
  const [completedLoading, setCompletedLoading] = useState(true);

  // Migration panel state
  const [migrationAlert, setMigrationAlert] = useState(null);
  const [migrationReport, setMigrationReport] = useState(null); // result of inspectLegacyMigration
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationResult, setMigrationResult] = useState(null); // result of the live run
  
  // Selected Collection State
  const [selectedCollectionId, setSelectedCollectionId] = useState(null);
  const [collectionItems, setCollectionItems] = useState([]);
  const [collectionItemsScopeId, setCollectionItemsScopeId] = useState(null);
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
      () => {
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
      () => {
        setCollectionsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // 3. Subscribe to Completed collection (Built-in)
  useEffect(() => {
    if (!currentUser) return;

    setCompletedLoading(true);
    const unsubscribe = subscribeToCompleted(
      currentUser.uid,
      (data) => {
        data.sort((a, b) => (b.addedAt?.toMillis() || 0) - (a.addedAt?.toMillis() || 0));
        setCompletedList(data);
        setCompletedLoading(false);
      },
      () => {
        setCompletedLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // 4. Safe detection of legacy "Completed" custom collection
  // NOTE: Automatic background migration is disabled per safety requirements.
  // All original collections remain visible and preserved.
  useEffect(() => {
    if (!currentUser || collectionsLoading || collections.length === 0) {
      setMigrationAlert(null);
      return;
    }

    const legacyMatches = collections.filter(
      (c) => c.name && c.name.trim().toLowerCase() === "completed" && !c._isMigratedLegacy
    );

    if (legacyMatches.length > 0) {
      setMigrationAlert(
        "Notice: Your original custom collection 'Completed' is accessible below under 'Completed (Custom)'. Automatic migration is paused for data safety. No anime records were deleted or modified."
      );
    } else {
      setMigrationAlert(null);
    }
  }, [currentUser, collections, collectionsLoading]);

  // 5. Subscribe to specific Collection Items when selected (custom collections only)
  useEffect(() => {
    if (!currentUser || !selectedCollectionId || selectedCollectionId === SYSTEM_COLLECTION_COMPLETED) {
      setCollectionItems([]);
      setCollectionItemsScopeId(null);
      return;
    }

    let active = true;
    const subscribedCollectionId = selectedCollectionId;
    setCollectionItems([]);
    setCollectionItemsScopeId(subscribedCollectionId);
    setItemsLoading(true);
    const unsubscribe = subscribeToCollectionItems(
      currentUser.uid,
      subscribedCollectionId,
      (data) => {
        if (!active) return;
        data.sort((a, b) => (b.addedAt?.toMillis() || 0) - (a.addedAt?.toMillis() || 0));
        setCollectionItems(data);
        setItemsLoading(false);
      },
      () => {
        if (!active) return;
        setItemsLoading(false);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [currentUser, selectedCollectionId]);

  // Action Handlers
  const handleRemoveFromWatchlist = async (e, animeId) => {
    e.preventDefault(); // Prevent navigating to Anime Info
    e.stopPropagation();
    try {
      await removeFromWatchlist(currentUser.uid, animeId);
    } catch (error) {
      console.error("Failed to remove from watchlist:", error);
      alert(getFirestoreErrorMessage(error));
    }
  };

  const handleRemoveFromCompleted = async (e, animeId) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      // Removing from Completed restores the anime to Watchlist
      await removeFromCompleted(currentUser.uid, animeId, true);
    } catch (error) {
      console.error("Failed to remove from completed:", error);
      alert(getFirestoreErrorMessage(error));
    }
  };

  const handleRemoveFromCollection = async (e, animeId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedCollectionId) return;
    
    try {
      await removeFromCollection(currentUser.uid, selectedCollectionId, animeId);
    } catch (error) {
      console.error("Failed to remove from collection:", error);
      alert(getFirestoreErrorMessage(error));
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
      console.error("Failed to delete collection:", error);
      alert(getFirestoreErrorMessage(error));
    }
  };

  // Migration: inspect (dry-run, read-only)
  const handleInspectMigration = async () => {
    if (!currentUser) return;
    setMigrationReport(null);
    setMigrationResult(null);
    setMigrationRunning(true);
    try {
      const report = await inspectLegacyMigration(currentUser.uid);
      setMigrationReport(report);
    } catch (err) {
      console.error("inspectLegacyMigration error:", err);
      setMigrationReport({ error: getFirestoreErrorMessage(err) });
    } finally {
      setMigrationRunning(false);
    }
  };

  // Migration: live run (requires explicit user confirmation)
  const handleRunMigration = async () => {
    if (!currentUser || !migrationReport?.found) return;
    const confirmed = window.confirm(
      `This will copy ${migrationReport.missingCount} anime from your old custom Completed collection into the System Completed collection.\n\nNo existing data will be deleted or overwritten.\n\nProceed?`
    );
    if (!confirmed) return;

    setMigrationRunning(true);
    setMigrationResult(null);
    try {
      const result = await migrateLegacyCompletedCollection(currentUser.uid, { skipFlagCheck: true });
      setMigrationResult(result);
      // Refresh the inspection report to reflect the new destination state
      const updatedReport = await inspectLegacyMigration(currentUser.uid);
      setMigrationReport(updatedReport);
    } catch (err) {
      console.error("migrateLegacyCompletedCollection error:", err);
      setMigrationResult({ success: false, error: getFirestoreErrorMessage(err) });
    } finally {
      setMigrationRunning(false);
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

  // Only exclude legacy custom collections if they have been fully and verified migrated.
  // Legacy collections are NEVER hidden solely because their name is "Completed".
  const visibleCollections = collections.filter((c) => !c._isMigratedLegacy);

  // Find currently selected collection metadata
  const selectedCollection = collections.find(c => c.id === selectedCollectionId);
  const activeCollectionItems = collectionItemsScopeId === selectedCollectionId
    ? collectionItems
    : [];
  const activeCollectionItemsLoading = itemsLoading
    || (Boolean(selectedCollectionId)
      && selectedCollectionId !== SYSTEM_COLLECTION_COMPLETED
      && collectionItemsScopeId !== selectedCollectionId);

  return (
    <div className="library-container">
      <div className="library-header">
        <h1>My Library</h1>
        <p>Manage your watchlist and personal anime collections.</p>
      </div>

      {/* WATCHLIST SECTION */}
      <WatchlistSection
        uid={currentUser.uid}
        animeDocuments={watchlist}
        isLoading={watchlistLoading}
        isMobile={isMobile}
        showAll={showAllWatchlist}
        onToggleShowAll={() => setShowAllWatchlist((current) => !current)}
        onRemoveAnime={handleRemoveFromWatchlist}
        groupingEnabled={isPresentationEnabled()}
      />

      {/* COLLECTIONS SECTION */}
      <div className="library-section">
        <h2 className="section-title">Collections</h2>

        {migrationAlert && (
          <div className="migration-alert" role="alert">
            <div className="migration-alert-text">{migrationAlert}</div>
            <div className="migration-alert-actions">
              <button
                className="migration-inspect-btn"
                onClick={handleInspectMigration}
                disabled={migrationRunning}
              >
                {migrationRunning && !migrationReport ? "Inspecting…" : "🔍 Inspect Migration"}
              </button>
            </div>

            {/* Inspection Report */}
            {migrationReport && (
              <div className="migration-report">
                {migrationReport.error ? (
                  <p className="migration-report-error">Error: {migrationReport.error}</p>
                ) : !migrationReport.found ? (
                  <p className="migration-report-ok">✓ {migrationReport.message}</p>
                ) : (
                  <>
                    <table className="migration-report-table">
                      <tbody>
                        <tr><td>Source collection ID</td><td><code>{migrationReport.collectionId}</code></td></tr>
                        <tr><td>Source anime count</td><td>{migrationReport.sourceCount}</td></tr>
                        <tr><td>Destination count (current)</td><td>{migrationReport.destinationCount}</td></tr>
                        <tr><td>Items to copy</td><td><strong>{migrationReport.missingCount}</strong></td></tr>
                        <tr><td>Already migrated</td><td>{migrationReport.alreadyMigratedCount}</td></tr>
                        <tr><td>Items missing animeId field</td><td>{migrationReport.itemsWithNoAnimeId}</td></tr>
                        <tr><td>Profile migration flag</td><td>{migrationReport.profileFlagSet ? "⚠ Set (was bypassed)" : "Not set"}</td></tr>
                        <tr><td>Collection migration flag</td><td>{migrationReport.collectionFlagSet ? "⚠ Set (was bypassed)" : "Not set"}</td></tr>
                      </tbody>
                    </table>
                    {migrationReport.missingCount > 0 ? (
                      <div className="migration-report-items">
                        <p><strong>Anime to be copied:</strong></p>
                        <ul>
                          {migrationReport.missingItems.map((item) => (
                            <li key={item.animeId}>{item.title} <span className="migration-id">(ID: {item.animeId})</span></li>
                          ))}
                        </ul>
                        <button
                          className="migration-run-btn"
                          onClick={handleRunMigration}
                          disabled={migrationRunning}
                        >
                          {migrationRunning ? "Migrating…" : `▶ Run Migration (${migrationReport.missingCount} anime)`}
                        </button>
                      </div>
                    ) : (
                      <p className="migration-report-ok">✓ {migrationReport.message}</p>
                    )}
                  </>
                )}

                {/* Live migration result */}
                {migrationResult && (
                  <div className={`migration-live-result ${migrationResult.success ? 'success' : 'error'}`}>
                    {migrationResult.success
                      ? `✓ ${migrationResult.message}`
                      : `✗ ${migrationResult.error}`
                    }
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        
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

            {/* Built-in Completed Collection Tab */}
            <div 
              className={`collection-tab ${selectedCollectionId === SYSTEM_COLLECTION_COMPLETED ? 'active' : ''}`}
              onClick={() => setSelectedCollectionId(selectedCollectionId === SYSTEM_COLLECTION_COMPLETED ? null : SYSTEM_COLLECTION_COMPLETED)}
            >
              <span>Completed</span>
              <span className="tab-count">{completedLoading ? "..." : `${completedList.length} Anime`}</span>
            </div>

            {/* Custom Collection Tabs */}
            {visibleCollections.map(col => {
              const isLegacyCompleted = col.name && col.name.trim().toLowerCase() === "completed";
              return (
                <div 
                  key={col.id}
                  className={`collection-tab ${selectedCollectionId === col.id ? 'active' : ''}`}
                  onClick={() => setSelectedCollectionId(col.id === selectedCollectionId ? null : col.id)}
                >
                  <span>{col.name}{isLegacyCompleted ? " (Custom)" : ""}</span>
                  <span className="tab-count">{isLegacyCompleted ? "Custom Collection" : "Collection"}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* ACTIVE COLLECTION VIEW */}
        {selectedCollectionId === SYSTEM_COLLECTION_COMPLETED ? (
          <div className="active-collection-view">
            <div className="active-collection-header">
              <div className="active-collection-info">
                <h2>Completed</h2>
                <p>Anime you have finished watching.</p>
              </div>
              <div className="active-collection-badge">
                <span className="built-in-badge">Built-in Collection</span>
              </div>
            </div>

            <CompletedSection
              uid={currentUser.uid}
              animeDocuments={completedList}
              isLoading={completedLoading}
              onRemoveAnime={handleRemoveFromCompleted}
              groupingEnabled={isPresentationEnabled()}
            />
          </div>
        ) : selectedCollectionId && selectedCollection ? (
          <div className="active-collection-view">
            <div className="active-collection-header">
              <div className="active-collection-info">
                <h2>
                  {selectedCollection.name}
                  {selectedCollection.name && selectedCollection.name.trim().toLowerCase() === "completed" ? " (Custom Collection)" : ""}
                </h2>
                {selectedCollection.description && <p>{selectedCollection.description}</p>}
                {selectedCollection.name && selectedCollection.name.trim().toLowerCase() === "completed" && (
                  <p style={{ color: "var(--accent)", fontSize: "0.9rem", marginTop: "4px" }}>
                    Original custom collection. All of your anime records are preserved here.
                  </p>
                )}
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

            <CustomCollectionSection
              uid={currentUser.uid}
              collectionId={selectedCollectionId}
              animeDocuments={activeCollectionItems}
              isLoading={activeCollectionItemsLoading}
              onRemoveAnime={handleRemoveFromCollection}
              groupingEnabled={isPresentationEnabled()}
            />
          </div>
        ) : null}
        
        {!selectedCollectionId && visibleCollections.length === 0 && !collectionsLoading && (
          <div className="library-empty-state">
            <p>You haven't created any custom collections yet.</p>
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
