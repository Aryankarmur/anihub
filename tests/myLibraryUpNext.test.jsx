import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const upNextMocks = vi.hoisted(() => ({
  discoverSequels: vi.fn(),
}));

vi.mock("../src/context/AuthContext", () => {
  const currentUser = { uid: "test-user" };
  return { useAuth: () => ({ currentUser }) };
});

vi.mock("../src/firebase/groupingFeatureGate", () => ({
  isGroupingPresentationEnabled: () => false,
  isAnimeGroupingEnabled: false,
}));

vi.mock("../src/firebase/firestore", () => {
  const subscribeEmpty = vi.fn((uid, callback) => {
    callback([]);
    return vi.fn();
  });
  return {
    SYSTEM_COLLECTION_COMPLETED: "__completed__",
    subscribeToWatchlist: subscribeEmpty,
    subscribeToCollections: subscribeEmpty,
    subscribeToCollectionItems: subscribeEmpty,
    subscribeToCompleted: subscribeEmpty,
    removeFromWatchlist: vi.fn(),
    removeFromCollection: vi.fn(),
    removeFromCompleted: vi.fn(),
    addToWatchlist: vi.fn(),
    addToCompleted: vi.fn(),
    deleteCollection: vi.fn(),
    getFirestoreErrorMessage: (error) => error.message,
    inspectLegacyMigration: vi.fn(),
    migrateLegacyCompletedCollection: vi.fn(),
  };
});

vi.mock("../src/features/upNext/useUpNextSuggestions", () => ({
  useUpNextSuggestions: () => ({
    suggestions: [],
    isLoading: false,
    error: "",
    isDiscovering: false,
    discoveryMessage: "",
    discoveryError: "",
    discoverSequels: upNextMocks.discoverSequels,
  }),
}));

vi.mock("../src/component/WatchlistSection", () => ({ default: () => <div>Watchlist fixture</div> }));
vi.mock("../src/component/CompletedSection", () => ({ default: () => <div>Completed fixture</div> }));
vi.mock("../src/component/CustomCollectionSection", () => ({ default: () => <div>Collection fixture</div> }));
vi.mock("../src/component/CollectionModal", () => ({ default: () => null }));
vi.mock("../src/component/EditCollectionModal", () => ({ default: () => null }));
vi.mock("../src/features/upNext/UpNextSection", () => ({
  default: ({ onDiscoverSequels }) => (
    <div data-testid="up-next-section">
      Up Next fixture
      <button type="button" onClick={onDiscoverSequels}>Discover fixture</button>
    </div>
  ),
}));

import MyLibrary from "../src/pages/MyLibrary";

describe("My Library Up Next integration", () => {
  it("creates the Up Next system Collection automatically and exposes no rename/delete controls", async () => {
    render(<MemoryRouter><MyLibrary /></MemoryRouter>);
    const tab = await screen.findByText("Up Next");
    fireEvent.click(tab);
    await waitFor(() => expect(screen.getByTestId("up-next-section")).toBeInTheDocument());
    expect(screen.getByText("Automatic Collection")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discover fixture" }));
    expect(upNextMocks.discoverSequels).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /edit collection/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete collection/i })).not.toBeInTheDocument();
  });
});
