import { useEffect, useState } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  signOut,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { auth, db, isIsolatedFirebasePreview } from "../src/firebase/firebaseConfig";
import {
  addToWatchlist,
  deleteGroup,
  subscribeToWatchlist,
} from "../src/firebase/firestore";
import { useAutoGrouping } from "../src/hooks/useAutoGrouping";

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `automatic-save-${runId}@anihub.test`;
const password = "PreviewOnly123!";

let uid;

function AutomaticSaveHarness({ userId }) {
  const [animeDocuments, setAnimeDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => subscribeToWatchlist(
    userId,
    (documents) => {
      setAnimeDocuments(documents);
      setIsLoading(false);
    },
    (error) => {
      throw error;
    },
  ), [userId]);

  useAutoGrouping({
    uid: userId,
    scopeKey: "watchlist",
    animeDocuments,
    isLoading,
  });

  return <output data-testid="saved-count">{animeDocuments.length}</output>;
}

const anime = (animeId, title, relations) => ({
  animeId,
  title,
  image: "",
  type: "TV",
  score: 8,
  anilistRelations: relations,
});

const loadGroups = () => getDocs(collection(db, "users", uid, "groups"));
const loadMembers = (groupId) => getDocs(query(
  collection(db, "users", uid, "watchlist"),
  where("groupId", "==", groupId),
));

beforeAll(async () => {
  if (!isIsolatedFirebasePreview) {
    throw new Error("Refusing to run automatic save flow outside the isolated Firebase preview.");
  }
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  uid = credential.user.uid;
});

afterAll(async () => {
  cleanup();
  if (uid) {
    const groups = await loadGroups();
    const animeDocuments = await getDocs(collection(db, "users", uid, "watchlist"));
    await Promise.all(animeDocuments.docs.map((snapshot) => deleteDoc(snapshot.ref)));
    for (const snapshot of groups.docs) {
      await deleteGroup(uid, snapshot.id);
    }
  }
  if (auth.currentUser) await deleteUser(auth.currentUser);
  await signOut(auth).catch(() => {});
});

describe("automatic grouping through the real save flow", () => {
  it("creates on the second related save and expands on the third without duplicates", async () => {
    render(<AutomaticSaveHarness userId={uid} />);

    await addToWatchlist(uid, anime("900000101", "Synthetic Saga I", [
      { relatedId: "900000102", relationType: "SEQUEL" },
    ]));

    await waitFor(async () => {
      expect((await loadGroups()).size).toBe(0);
    });

    await addToWatchlist(uid, anime("900000102", "Synthetic Saga II", [
      { relatedId: "900000101", relationType: "PREQUEL" },
      { relatedId: "900000103", relationType: "SEQUEL" },
    ]));

    let groupId;
    await waitFor(async () => {
      const groups = await loadGroups();
      expect(groups.size).toBe(1);
      groupId = groups.docs[0].id;
      expect(groups.docs[0].data().groupType).toBe("automatic");
      expect((await loadMembers(groupId)).size).toBe(2);
    }, { timeout: 10_000 });

    await addToWatchlist(uid, anime("900000103", "Synthetic Saga III", [
      { relatedId: "900000102", relationType: "PREQUEL" },
    ]));

    await waitFor(async () => {
      const groups = await loadGroups();
      expect(groups.size).toBe(1);
      expect(groups.docs[0].id).toBe(groupId);
      expect((await loadMembers(groupId)).size).toBe(3);
    }, { timeout: 10_000 });
  });
});
