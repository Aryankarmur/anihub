import process from "node:process";

import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  serverTimestamp,
  terminate,
  writeBatch,
} from "firebase/firestore";

const PROJECT_ID = "demo-anihub-f01";
const AUTH_HOST = "127.0.0.1:9099";
const FIRESTORE_HOST = "127.0.0.1:8080";
const TEST_EMAIL = "grouping.preview@anihub.test";
const TEST_PASSWORD = "PreviewOnly123!";

const argumentsByName = new Map(
  process.argv.slice(2).map((argument) => {
    const [name, ...value] = argument.split("=");
    return [name, value.join("=")];
  }),
);

const configuredProject = process.env.GCLOUD_PROJECT
  || process.env.FIREBASE_PROJECT_ID
  || argumentsByName.get("--project");
const configuredAuthHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
  || argumentsByName.get("--auth-host");
const configuredFirestoreHost = process.env.FIRESTORE_EMULATOR_HOST
  || argumentsByName.get("--firestore-host");

const refuseUnsafeEnvironment = () => {
  if (configuredProject !== PROJECT_ID) {
    throw new Error(`Refusing to seed: the configured project must equal ${PROJECT_ID}.`);
  }
  if (configuredAuthHost !== AUTH_HOST) {
    throw new Error(`Refusing to seed: the Auth Emulator host must equal ${AUTH_HOST}.`);
  }
  if (configuredFirestoreHost !== FIRESTORE_HOST) {
    throw new Error(`Refusing to seed: the Firestore Emulator host must equal ${FIRESTORE_HOST}.`);
  }
};

const cover = (label, color) => (
  `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420">
      <rect width="300" height="420" fill="${color}"/>
      <circle cx="150" cy="145" r="72" fill="rgba(255,255,255,.18)"/>
      <text x="150" y="330" text-anchor="middle" fill="white" font-family="sans-serif" font-size="26">${label}</text>
      <text x="150" y="365" text-anchor="middle" fill="white" font-family="sans-serif" font-size="16">Synthetic preview</text>
    </svg>
  `)}`
);

const anime = [
  {
    animeId: "preview-101",
    title: "Skyward Chapter I",
    image: cover("Chapter I", "#315c9b"),
    type: "TV",
    score: 8.1,
    anilistRelations: [
      { relatedId: "preview-102", relationType: "SEQUEL" },
    ],
  },
  {
    animeId: "preview-102",
    title: "Skyward Chapter II",
    image: cover("Chapter II", "#654ea3"),
    type: "TV",
    score: 8.3,
    anilistRelations: [
      { relatedId: "preview-101", relationType: "PREQUEL" },
      { relatedId: "preview-103", relationType: "SEQUEL" },
    ],
  },
  {
    animeId: "preview-103",
    title: "Skyward Final Arc",
    image: cover("Final Arc", "#9b315e"),
    type: "Movie",
    score: 8.6,
    anilistRelations: [
      { relatedId: "preview-102", relationType: "PREQUEL" },
    ],
  },
  { animeId: "preview-104", title: "Standalone Harbor", image: cover("Harbor", "#26786f"), type: "TV", score: 7.7 },
  { animeId: "preview-105", title: "Standalone Meteor", image: cover("Meteor", "#a4612a"), type: "ONA", score: 7.9 },
  { animeId: "preview-106", title: "Standalone Garden", image: cover("Garden", "#49742b"), type: "OVA", score: 7.5 },
  {
    animeId: "preview-201",
    title: "Completed Prelude",
    image: cover("Prelude", "#475569"),
    type: "TV",
    score: 8.0,
    anilistRelations: [
      { relatedId: "preview-202", relationType: "SEQUEL" },
    ],
  },
  {
    animeId: "preview-202",
    title: "Completed Journey",
    image: cover("Journey", "#7c3aed"),
    type: "Movie",
    score: 8.4,
    anilistRelations: [
      { relatedId: "preview-201", relationType: "PREQUEL" },
      { relatedId: "preview-203", relationType: "SEQUEL" },
    ],
  },
  {
    animeId: "preview-203",
    title: "Completed Finale",
    image: cover("Finale", "#be123c"),
    type: "TV",
    score: 8.8,
    anilistRelations: [
      { relatedId: "preview-202", relationType: "PREQUEL" },
    ],
  },
  { animeId: "preview-204", title: "Completed Standalone", image: cover("Complete", "#0369a1"), type: "Special", score: 7.8 },
];

refuseUnsafeEnvironment();

const app = initializeApp({
  apiKey: PROJECT_ID,
  authDomain: `${PROJECT_ID}.localhost`,
  projectId: PROJECT_ID,
  appId: "1:000000000000:web:groupingpreviewseed",
});
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);

let credential;
try {
  credential = await createUserWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
} catch (error) {
  if (error.code !== "auth/email-already-in-use") throw error;
  credential = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
}

const uid = credential.user.uid;
const batch = writeBatch(db);
batch.set(doc(db, "users", uid), {
  uid,
  displayName: "Grouping Preview",
  email: TEST_EMAIL,
  previewSeed: true,
  updatedAt: serverTimestamp(),
}, { merge: true });

for (const item of anime.slice(0, 6)) {
  batch.set(doc(db, "users", uid, "watchlist", item.animeId), {
    ...item,
    addedAt: serverTimestamp(),
    previewSeed: true,
  }, { merge: true });
}
for (const item of anime.slice(6)) {
  batch.set(doc(db, "users", uid, "completed", item.animeId), {
    ...item,
    addedAt: serverTimestamp(),
    previewSeed: true,
  }, { merge: true });
}

const collections = [
  { id: "preview-favorites", name: "Preview Favorites", description: "Synthetic grouping playground" },
  { id: "preview-weekends", name: "Preview Weekends", description: "Independent collection membership" },
];
for (const collectionData of collections) {
  batch.set(doc(db, "users", uid, "collections", collectionData.id), {
    name: collectionData.name,
    description: collectionData.description,
    previewSeed: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}
for (const item of anime.slice(0, 4)) {
  batch.set(doc(db, "users", uid, "collections", "preview-favorites", "items", item.animeId), {
    ...item,
    addedAt: serverTimestamp(),
    previewSeed: true,
  }, { merge: true });
}
for (const item of [anime[1], anime[2], anime[4], anime[5]]) {
  batch.set(doc(db, "users", uid, "collections", "preview-weekends", "items", item.animeId), {
    ...item,
    addedAt: serverTimestamp(),
    previewSeed: true,
  }, { merge: true });
}

await batch.commit();
console.log(`Seeded isolated preview user ${TEST_EMAIL} (${uid}) in ${PROJECT_ID}.`);
console.log(`Password: ${TEST_PASSWORD}`);
console.log("Seeded 6 Watchlist anime, 4 Completed anime, and 2 custom Collections.");
await terminate(db);
await deleteApp(app);
