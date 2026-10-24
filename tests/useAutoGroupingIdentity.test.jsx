import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/firebase/groupingFeatureGate.js", () => ({
  isAnimeGroupingEnabled: true,
  isAutomaticReconciliationEnabled: (uid) => Boolean(uid),
}));

import { useAutoGrouping } from "../src/hooks/useAutoGrouping.js";

const animeDocuments = [
  {
    animeId: "101",
    title: "Season One",
    anilistRelations: [{ relatedId: "102", relationType: "SEQUEL" }],
  },
  {
    animeId: "102",
    title: "Season Two",
    anilistRelations: [{ relatedId: "101", relationType: "PREQUEL" }],
  },
];

function Harness({ uid, isLoading = false, services }) {
  const state = useAutoGrouping({
    uid,
    scopeKey: "watchlist",
    animeDocuments,
    isLoading,
    services,
  });

  return (
    <output data-testid="state">
      {JSON.stringify({
        isReconciling: state.isReconciling,
        lastResult: state.lastResult,
      })}
    </output>
  );
}

describe("useAutoGrouping identity isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels a pending old-account pass during sign-out or account loading", async () => {
    const reconcile = vi.fn().mockResolvedValue({ created: [] });
    const services = { runAutoGroupingReconciliation: reconcile };
    const view = render(<Harness uid="first-user" services={services} />);

    view.rerender(<Harness uid={null} isLoading services={services} />);
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(reconcile).not.toHaveBeenCalled();

    view.rerender(<Harness uid="second-user" services={services} />);
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      uid: "second-user",
      scopeKey: "watchlist",
    }));
  });

  it("does not expose a stale completion after the active account changes", async () => {
    let resolveFirst;
    const firstPass = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const reconcile = vi.fn().mockReturnValue(firstPass);
    const services = { runAutoGroupingReconciliation: reconcile };
    const view = render(<Harness uid="first-user" services={services} />);

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(reconcile).toHaveBeenCalledOnce();

    view.rerender(<Harness uid="second-user" isLoading services={services} />);
    expect(screen.getByTestId("state")).toHaveTextContent(
      JSON.stringify({ isReconciling: false, lastResult: null }),
    );

    await act(async () => {
      resolveFirst({ created: [{ groupId: "old-user-group" }] });
      await firstPass;
    });

    expect(screen.getByTestId("state")).toHaveTextContent(
      JSON.stringify({ isReconciling: false, lastResult: null }),
    );
  });
});
