import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import GroupCard from "../src/component/GroupCard";
import GroupDeleteDialog from "../src/component/GroupDeleteDialog";
import GroupDetail from "../src/component/GroupDetail";
import GroupManagementModal from "../src/component/GroupManagementModal";
import GroupThumbnailPicker from "../src/component/GroupThumbnailPicker";
import LibraryGrid from "../src/component/LibraryGrid";

const anime = [
  { id: "doc-1", animeId: "1", title: "First", image: "", type: "TV", score: 8, groupId: "g1" },
  { id: "doc-2", animeId: "2", title: "Second", image: "second.jpg", type: "Movie", groupId: "g1" },
  { id: "doc-3", animeId: "3", title: "Third", image: "third.jpg", type: "TV", groupId: "g2" },
  { id: "doc-4", animeId: "4", title: "Fourth", image: "fourth.jpg", type: "TV", groupId: "g2" },
  { id: "doc-5", animeId: "5", title: "Fifth", image: "fifth.jpg", type: "OVA", groupId: "g2" },
  { id: "doc-6", animeId: "6", title: "Singleton", image: "single.jpg", type: "TV", groupId: "g3" },
  { id: "doc-7", animeId: "7", title: "Orphan", image: "orphan.jpg", type: "TV", groupId: "missing" },
  { id: "doc-8", animeId: "8", title: "Standalone", image: "standalone.jpg", type: "TV" }
];

const groups = [
  { groupId: "g1", name: "Pair", thumbnailAnimeId: "1", status: "active" },
  { groupId: "g2", name: "Trilogy", thumbnailAnimeId: "4", status: "active" },
  { groupId: "g3", name: "Too small", thumbnailAnimeId: "6", status: "active" },
  { groupId: "g4", name: "Empty", thumbnailAnimeId: null, status: "active" },
  { groupId: "g5", name: "Deleting", thumbnailAnimeId: "8", status: "deleting" }
];

const renderInRouter = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

describe("LibraryGrid and GroupCard", () => {
  it("renders valid two/multi-member groups first and leaves singleton, orphan, and standalone anime visible", () => {
    const { container } = renderInRouter(<LibraryGrid groups={groups} animeDocuments={anime} />);
    expect(screen.getByTestId("group-card-g1")).toBeInTheDocument();
    expect(screen.getByTestId("group-card-g2")).toBeInTheDocument();
    expect(screen.queryByTestId("group-card-g3")).not.toBeInTheDocument();
    expect(screen.queryByText("Empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("anime-card-6")).toBeInTheDocument();
    expect(screen.getByTestId("anime-card-7")).toBeInTheDocument();
    expect(screen.getByTestId("anime-card-8")).toBeInTheDocument();
    const ids = [...container.querySelector(".library-group-grid").children]
      .map((element) => element.dataset.testid);
    expect(ids).toEqual([
      "group-card-g1", "group-card-g2", "anime-card-6", "anime-card-7", "anime-card-8"
    ]);
  });

  it("applies the display limit after combining group and standalone cards", () => {
    renderInRouter(<LibraryGrid groups={groups} animeDocuments={anime} displayLimit={3} />);
    expect(screen.getAllByText(/anime$/i)).toHaveLength(2);
    expect(screen.getByTestId("anime-card-6")).toBeInTheDocument();
    expect(screen.queryByTestId("anime-card-7")).not.toBeInTheDocument();
  });

  it("uses a local fallback and exposes separate accessible open, edit, and delete controls", () => {
    const onOpenGroup = vi.fn();
    const onEditGroup = vi.fn();
    const onDeleteGroup = vi.fn();
    const { container } = render(
      <GroupCard
        group={groups[0]}
        members={anime.slice(0, 2)}
        onOpenGroup={onOpenGroup}
        onEditGroup={onEditGroup}
        onDeleteGroup={onDeleteGroup}
      />
    );
    expect(container.querySelector(".group-card-image")).toHaveAttribute("data-fallback", "true");
    fireEvent.click(screen.getByRole("button", { name: /open pair group/i }));
    fireEvent.click(screen.getByRole("button", { name: /edit pair group/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete pair group/i }));
    expect(onOpenGroup).toHaveBeenCalledWith(groups[0]);
    expect(onEditGroup).toHaveBeenCalledWith(groups[0]);
    expect(onDeleteGroup).toHaveBeenCalledWith(groups[0]);
    expect(document.querySelector("button button")).toBeNull();
  });
});

describe("GroupDetail", () => {
  it("supports inline back, edit, remove, and delete actions while preserving anime links", () => {
    const onBack = vi.fn();
    const onEditGroup = vi.fn();
    const onRemoveMember = vi.fn();
    const onDeleteGroup = vi.fn();
    renderInRouter(
      <GroupDetail
        group={groups[0]}
        members={anime.slice(0, 2)}
        onBack={onBack}
        onEditGroup={onEditGroup}
        onRemoveMember={onRemoveMember}
        onDeleteGroup={onDeleteGroup}
      />
    );
    expect(screen.getByRole("link", { name: /first image/i })).toHaveAttribute("href", "/anime/1");
    fireEvent.click(screen.getByRole("button", { name: /back to collection/i }));
    fireEvent.click(screen.getByRole("button", { name: /edit group/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove first from pair/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete group/i }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onEditGroup).toHaveBeenCalledWith(groups[0]);
    expect(onRemoveMember).toHaveBeenCalledWith(anime[0], groups[0]);
    expect(onDeleteGroup).toHaveBeenCalledWith(groups[0]);
  });

  it("shows a useful state when live membership falls below two", () => {
    const { rerender } = renderInRouter(<GroupDetail group={groups[0]} members={anime.slice(0, 2)} />);
    expect(screen.getByRole("heading", { name: "Pair" })).toBeInTheDocument();
    rerender(<MemoryRouter><GroupDetail group={groups[0]} members={anime.slice(0, 1)} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /no longer available/i })).toBeInTheDocument();
    expect(screen.getByText(/standalone cards/i)).toBeInTheDocument();
  });
});

describe("Group management", () => {
  it("validates the name and two-member minimum immediately", () => {
    render(<GroupManagementModal isOpen availableAnime={anime.slice(0, 3)} onClose={() => {}} />);
    const nameInput = screen.getByRole("textbox", { name: /group name/i });
    expect(nameInput).toHaveAttribute("maxlength", "80");
    expect(screen.getByText(/group name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/select at least two anime/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create group/i })).toBeDisabled();
    fireEvent.change(nameInput, { target: { value: "x".repeat(81) } });
    expect(screen.getByText(/80 characters or less/i)).toBeInTheDocument();
  });

  it("does not silently select anime assigned to another group", () => {
    render(
      <GroupManagementModal
        isOpen
        availableAnime={[...anime.slice(0, 3), { ...anime[0], id: "duplicate-doc" }]}
        initialAnimeIds={["1", "1"]}
        onClose={() => {}}
      />
    );
    expect(screen.getByRole("checkbox", { name: /first/i })).toBeDisabled();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByText(/^0$/)).toBeInTheDocument();
    expect(screen.getAllByText(/already in another group/i)).toHaveLength(3);
  });

  it("emits normalized save data and supports Cancel", () => {
    const available = anime.slice(0, 3).map((item) => ({ ...item, groupId: undefined }));
    const onClose = vi.fn();
    const onSaveGroup = vi.fn();
    render(
      <GroupManagementModal
        isOpen
        availableAnime={available}
        onClose={onClose}
        onSaveGroup={onSaveGroup}
      />
    );
    fireEvent.change(screen.getByRole("textbox", { name: /group name/i }), { target: { value: "  New   Group  " } });
    fireEvent.click(screen.getByRole("checkbox", { name: /first/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /second/i }));
    fireEvent.click(screen.getByRole("button", { name: /create group/i }));
    expect(onSaveGroup).toHaveBeenCalledWith({
      name: "New Group",
      animeIds: ["1", "2"],
      thumbnailAnimeId: "1"
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("GroupThumbnailPicker", () => {
  it("selects covers with click and keyboard navigation", () => {
    const onChange = vi.fn();
    const members = anime.slice(0, 3);
    const { rerender } = render(
      <GroupThumbnailPicker members={members} selectedAnimeId="1" onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("radio", { name: /use second/i }));
    expect(onChange).toHaveBeenLastCalledWith("2");
    rerender(<GroupThumbnailPicker members={members} selectedAnimeId="2" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: /use second/i }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("3");
  });

  it("updates selection when the chosen member disappears", () => {
    const onChange = vi.fn();
    render(<GroupThumbnailPicker members={anime.slice(1, 3)} selectedAnimeId="1" onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith("2");
  });
});

describe("GroupDeleteDialog", () => {
  it("requires an explicit confirmation and explains data preservation", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<GroupDeleteDialog isOpen groupName="Pair" onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.getByRole("alertdialog", { name: /delete “pair”/i })).toBeInTheDocument();
    expect(screen.getByText(/anime will not be deleted/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete group" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("supports Escape, loading, errors, initial focus, and focus restoration", () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(
      <GroupDeleteDialog isOpen groupName="Pair" onClose={onClose} onConfirm={() => {}} isLoading error="Try again" />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Try again");
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole("alertdialog"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("responsive stylesheet", () => {
  it("defines overflow-safe layouts for every required breakpoint", () => {
    const css = readFileSync("src/assets/css/AnimeGrouping.css", "utf8");
    for (const width of [1024, 768, 480, 375, 320]) {
      expect(css).toContain(`@media (max-width: ${width}px)`);
    }
    expect(css).toContain("repeat(2, minmax(0, 1fr))");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("max-height: calc(100dvh - 16px)");
  });
});
