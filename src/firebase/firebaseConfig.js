import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { evaluateGroupingPreviewEnvironment } from "./groupingPreviewConfig";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const configuredFirebaseProjectId = firebaseConfig.projectId;

// Validate that the config exists to prevent confusing undefined errors
if (!firebaseConfig.apiKey) {
  console.warn("Firebase configuration is missing! Please check your .env file.");
}

const emulatorRequested = import.meta.env.VITE_FIREBASE_USE_EMULATOR === "true";
const previewConfig = evaluateGroupingPreviewEnvironment(import.meta.env);

if (previewConfig.requested && !previewConfig.enabled) {
  throw new Error(`Unsafe grouping preview configuration: ${previewConfig.errors.join(" ")}`);
}
if (emulatorRequested && !previewConfig.enabled) {
  throw new Error("Firebase emulator mode is restricted to the isolated grouping preview.");
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export let isIsolatedFirestoreEmulator = false;
export let isIsolatedAuthEmulator = false;
export let isIsolatedFirebasePreview = false;

if (previewConfig.enabled) {
  try {
    connectAuthEmulator(
      auth,
      `http://${previewConfig.authHost}:${previewConfig.authPort}`,
      { disableWarnings: true },
    );
    isIsolatedAuthEmulator = true;
    connectFirestoreEmulator(db, previewConfig.firestoreHost, previewConfig.firestorePort);
    isIsolatedFirestoreEmulator = true;
    isIsolatedFirebasePreview = true;
  } catch (error) {
    isIsolatedAuthEmulator = false;
    isIsolatedFirestoreEmulator = false;
    isIsolatedFirebasePreview = false;
    throw new Error("Firebase emulator connection failed; preview startup was blocked.", {
      cause: error,
    });
  }
}

export default app;

