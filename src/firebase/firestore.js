import {
  doc,
  collection,
  setDoc,
  getDoc,
  addDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  writeBatch,
  getCountFromServer
} from "firebase/firestore";
import { db } from "./firebaseConfig";

// ==========================================
// USER PROFILE
// ==========================================

export const createUserProfile = async (uid, profileData) => {
  try {
    const userRef = doc(db, "users", uid);
    await setDoc(userRef, profileData, { merge: true });
    return { error: null };
  } catch (error) {
    console.error("Error creating user profile:", error);
    throw error;
  }
};

export const getUserProfile = async (uid) => {
  try {
    const userRef = doc(db, "users", uid);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
      return { data: docSnap.data(), error: null };
    } else {
      return { data: null, error: "User profile not found." };
    }
  } catch (error) {
    console.error("Error getting user profile:", error);
    throw error;
  }
};

export const deleteUserData = async (uid) => {
  if (!uid) {
    throw new Error("uid is required to delete user data.");
  }
  
  try {
    const batches = [];
    let currentBatch = writeBatch(db);
    let currentBatchSize = 0;

    const commitBatchIfNeeded = () => {
      // Firestore allows up to 500 writes per batch, 450 is a safe limit
      if (currentBatchSize >= 450) {
        batches.push(currentBatch.commit());
        currentBatch = writeBatch(db);
        currentBatchSize = 0;
      }
    };

    // 1. Delete Watchlist
    const watchlistRef = collection(db, "users", uid, "watchlist");
    const watchlistSnap = await getDocs(watchlistRef);
    watchlistSnap.forEach((docSnap) => {
      currentBatch.delete(docSnap.ref);
      currentBatchSize++;
      commitBatchIfNeeded();
    });

    // 2. Delete Collections and their Items
    const collectionsRef = collection(db, "users", uid, "collections");
    const collectionsSnap = await getDocs(collectionsRef);
    
    for (const colSnap of collectionsSnap.docs) {
      // Get all items in this collection
      const itemsRef = collection(db, "users", uid, "collections", colSnap.id, "items");
      const itemsSnap = await getDocs(itemsRef);
      
      itemsSnap.forEach((itemSnap) => {
        currentBatch.delete(itemSnap.ref);
        currentBatchSize++;
        commitBatchIfNeeded();
      });

      // Delete the collection document
      currentBatch.delete(colSnap.ref);
      currentBatchSize++;
      commitBatchIfNeeded();
    }

    // 3. Delete user profile document
    const userProfileRef = doc(db, "users", uid);
    currentBatch.delete(userProfileRef);
    currentBatchSize++;
    
    // Commit the remaining batch
    if (currentBatchSize > 0) {
      batches.push(currentBatch.commit());
    }
    
    await Promise.all(batches);
    return { error: null };
  } catch (error) {
    console.error("Error deleting user data:", error);
    throw error; // Re-throw to be handled by caller
  }
};

// ==========================================
// WATCHLIST
// ==========================================

export const addToWatchlist = async (uid, anime) => {
  try {
    const { animeId, title, image, type, score } = anime;
    
    if (!animeId) {
      throw new Error("animeId is required to add to watchlist.");
    }

    const animeRef = doc(db, "users", uid, "watchlist", String(animeId));
    
    const animeData = {
      animeId: String(animeId),
      title: title || "Unknown Title",
      image: image || "",
      type: type || "TV",
      score: score || null,
      addedAt: serverTimestamp()
    };

    await setDoc(animeRef, animeData, { merge: true });
    return { error: null };
  } catch (error) {
    console.error("Error adding to watchlist:", error);
    throw error;
  }
};

export const removeFromWatchlist = async (uid, animeId) => {
  try {
    const animeRef = doc(db, "users", uid, "watchlist", String(animeId));
    await deleteDoc(animeRef);
    return { error: null };
  } catch (error) {
    console.error("Error removing from watchlist:", error);
    throw error;
  }
};

export const getWatchlist = async (uid) => {
  try {
    const watchlistRef = collection(db, "users", uid, "watchlist");
    const querySnapshot = await getDocs(watchlistRef);
    const watchlist = [];
    querySnapshot.forEach((doc) => {
      watchlist.push({ id: doc.id, ...doc.data() });
    });
    return { data: watchlist, error: null };
  } catch (error) {
    console.error("Error getting watchlist:", error);
    throw error;
  }
};

export const subscribeToWatchlist = (uid, callback, onError) => {
  const watchlistRef = collection(db, "users", uid, "watchlist");
  return onSnapshot(
    watchlistRef,
    (snapshot) => {
      const watchlist = [];
      snapshot.forEach((doc) => {
        watchlist.push({ id: doc.id, ...doc.data() });
      });
      callback(watchlist);
    },
    (error) => {
      console.error("Watchlist subscription error:", error);
      if (onError) onError(error);
    }
  );
};

export const checkInWatchlist = async (uid, animeId) => {
  try {
    const animeRef = doc(db, "users", uid, "watchlist", String(animeId));
    const docSnap = await getDoc(animeRef);
    return { data: docSnap.exists(), error: null };
  } catch (error) {
    console.error("Error checking watchlist:", error);
    throw error;
  }
};

export const getWatchlistCount = async (uid) => {
  try {
    const watchlistRef = collection(db, "users", uid, "watchlist");
    const snapshot = await getCountFromServer(watchlistRef);
    return { data: snapshot.data().count, error: null };
  } catch (error) {
    console.error("Error getting watchlist count:", error);
    return { data: 0, error };
  }
};

// ==========================================
// COLLECTIONS
// ==========================================

export const createCollection = async (uid, collectionData) => {
  try {
    const collectionsRef = collection(db, "users", uid, "collections");
    const newCollection = {
      name: collectionData.name || "Untitled Collection",
      description: collectionData.description || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    const docRef = await addDoc(collectionsRef, newCollection);
    return { id: docRef.id, error: null };
  } catch (error) {
    console.error("Error creating collection:", error);
    throw error;
  }
};

export const updateCollection = async (uid, collectionId, collectionData) => {
  try {
    const collectionRef = doc(db, "users", uid, "collections", collectionId);
    const updateData = {
      name: collectionData.name,
      description: collectionData.description,
      updatedAt: serverTimestamp()
    };
    await updateDoc(collectionRef, updateData);
    return { error: null };
  } catch (error) {
    console.error("Error updating collection:", error);
    throw error;
  }
};

export const getCollections = async (uid) => {
  try {
    const collectionsRef = collection(db, "users", uid, "collections");
    const querySnapshot = await getDocs(collectionsRef);
    const collections = [];
    querySnapshot.forEach((doc) => {
      collections.push({ id: doc.id, ...doc.data() });
    });
    return { data: collections, error: null };
  } catch (error) {
    console.error("Error getting collections:", error);
    throw error;
  }
};

export const subscribeToCollections = (uid, callback, onError) => {
  const collectionsRef = collection(db, "users", uid, "collections");
  return onSnapshot(
    collectionsRef,
    (snapshot) => {
      const collections = [];
      snapshot.forEach((doc) => {
        collections.push({ id: doc.id, ...doc.data() });
      });
      callback(collections);
    },
    (error) => {
      console.error("Collections subscription error:", error);
      if (onError) onError(error);
    }
  );
};

export const deleteCollection = async (uid, collectionId) => {
  try {
    const collectionRef = doc(db, "users", uid, "collections", collectionId);
    const itemsRef = collection(db, "users", uid, "collections", collectionId, "items");
    
    // Fetch all items in the collection to delete them first
    const itemsSnapshot = await getDocs(itemsRef);
    const batch = writeBatch(db);
    
    itemsSnapshot.forEach((itemDoc) => {
      batch.delete(itemDoc.ref);
    });
    
    // Delete the parent collection document
    batch.delete(collectionRef);
    
    // Commit the batch
    await batch.commit();
    return { error: null };
  } catch (error) {
    console.error("Error deleting collection:", error);
    throw error;
  }
};

export const getCollectionCount = async (uid) => {
  try {
    const collectionsRef = collection(db, "users", uid, "collections");
    const snapshot = await getCountFromServer(collectionsRef);
    return { data: snapshot.data().count, error: null };
  } catch (error) {
    console.error("Error getting collections count:", error);
    return { data: 0, error };
  }
};

// ==========================================
// COLLECTION ITEMS
// ==========================================

export const addToCollection = async (uid, collectionId, anime) => {
  try {
    const { animeId, title, image, type, score } = anime;
    
    if (!animeId) {
      throw new Error("animeId is required to add to a collection.");
    }

    const itemRef = doc(db, "users", uid, "collections", collectionId, "items", String(animeId));
    
    const animeData = {
      animeId: String(animeId),
      title: title || "Unknown Title",
      image: image || "",
      type: type || "TV",
      score: score || null,
      addedAt: serverTimestamp()
    };

    await setDoc(itemRef, animeData, { merge: true });

    // Also update the parent collection's updatedAt field
    const collectionRef = doc(db, "users", uid, "collections", collectionId);
    await setDoc(collectionRef, { updatedAt: serverTimestamp() }, { merge: true });

    return { error: null };
  } catch (error) {
    console.error("Error adding to collection:", error);
    throw error;
  }
};

export const removeFromCollection = async (uid, collectionId, animeId) => {
  try {
    const itemRef = doc(db, "users", uid, "collections", collectionId, "items", String(animeId));
    await deleteDoc(itemRef);

    // Also update the parent collection's updatedAt field
    const collectionRef = doc(db, "users", uid, "collections", collectionId);
    await setDoc(collectionRef, { updatedAt: serverTimestamp() }, { merge: true });

    return { error: null };
  } catch (error) {
    console.error("Error removing from collection:", error);
    throw error;
  }
};

export const getCollectionItems = async (uid, collectionId) => {
  try {
    const itemsRef = collection(db, "users", uid, "collections", collectionId, "items");
    const querySnapshot = await getDocs(itemsRef);
    const items = [];
    querySnapshot.forEach((doc) => {
      items.push({ id: doc.id, ...doc.data() });
    });
    return { data: items, error: null };
  } catch (error) {
    console.error("Error getting collection items:", error);
    throw error;
  }
};

export const checkInCollection = async (uid, collectionId, animeId) => {
  try {
    const itemRef = doc(db, "users", uid, "collections", collectionId, "items", String(animeId));
    const docSnap = await getDoc(itemRef);
    return { data: docSnap.exists(), error: null };
  } catch (error) {
    console.error("Error checking collection item:", error);
    throw error;
  }
};

export const subscribeToCollectionItems = (uid, collectionId, callback, onError) => {
  const itemsRef = collection(db, "users", uid, "collections", collectionId, "items");
  return onSnapshot(
    itemsRef,
    (snapshot) => {
      const items = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() });
      });
      callback(items);
    },
    (error) => {
      console.error("Collection items subscription error:", error);
      if (onError) onError(error);
    }
  );
};
