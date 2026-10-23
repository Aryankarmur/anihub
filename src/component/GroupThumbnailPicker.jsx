import { useEffect, useMemo, useRef } from "react";
import GroupingImage from "./GroupingImage";
import { getAnimeId, getAnimeImage, getAnimeTitle } from "./groupingUi";
import "../assets/css/AnimeGrouping.css";

const GroupThumbnailPicker = ({ members = [], selectedAnimeId, onChange, disabled = false }) => {
  const optionRefs = useRef([]);
  const memberIds = useMemo(() => members.map(getAnimeId).filter(Boolean), [members]);
  const selectedId = String(selectedAnimeId ?? "");
  const activeIndex = Math.max(0, memberIds.indexOf(selectedId));

  useEffect(() => {
    if (members.length > 0 && !memberIds.includes(selectedId)) {
      onChange?.(memberIds[0]);
    }
  }, [memberIds, members.length, onChange, selectedId]);

  const handleKeyDown = (event, index) => {
    let nextIndex;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) nextIndex = (index + 1) % members.length;
    else if (["ArrowLeft", "ArrowUp"].includes(event.key)) nextIndex = (index - 1 + members.length) % members.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = members.length - 1;
    else return;
    event.preventDefault();
    const nextId = getAnimeId(members[nextIndex]);
    onChange?.(nextId);
    optionRefs.current[nextIndex]?.focus();
  };

  if (members.length === 0) {
    return <p className="group-thumbnail-empty">Select anime to choose a thumbnail.</p>;
  }

  return (
    <div className="group-thumbnail-picker" role="radiogroup" aria-label="Group thumbnail">
      {members.map((anime, index) => {
        const animeId = getAnimeId(anime);
        const selected = animeId === selectedId;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Use ${getAnimeTitle(anime)} as group thumbnail`}
            className={`group-thumbnail-option ${selected ? "selected" : ""}`}
            key={animeId}
            onClick={() => onChange?.(animeId)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            disabled={disabled}
            tabIndex={selected || (!selectedId && index === activeIndex) ? 0 : -1}
            ref={(element) => { optionRefs.current[index] = element; }}
          >
            <GroupingImage src={getAnimeImage(anime)} alt="" />
            <span>{getAnimeTitle(anime)}</span>
          </button>
        );
      })}
    </div>
  );
};

export default GroupThumbnailPicker;
