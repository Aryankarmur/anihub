import { IoAlbumsOutline, IoCreateOutline, IoTrashOutline } from "react-icons/io5";
import GroupingImage from "./GroupingImage";
import { getAnimeImage, getGroupId, getGroupThumbnailMember } from "./groupingUi";
import "../assets/css/AnimeGrouping.css";

const GroupCard = ({
  group,
  members = [],
  onOpenGroup,
  onEditGroup,
  onDeleteGroup,
  showActions = true,
}) => {
  const groupId = getGroupId(group);
  if (!groupId || group?.status !== "active" || members.length < 2) return null;
  const thumbnail = getGroupThumbnailMember(group, members);

  return (
    <article className="group-card" data-testid={`group-card-${groupId}`}>
      <button
        type="button"
        className="group-card-open"
        onClick={() => onOpenGroup?.(group)}
        aria-label={`Open ${group.name} group, ${members.length} anime`}
      >
        <span className="group-card-image-wrap">
          <GroupingImage src={getAnimeImage(thumbnail)} alt="" className="group-card-image" />
          <span className="group-card-badge"><IoAlbumsOutline aria-hidden="true" /> Group</span>
        </span>
        <span className="group-card-content">
          <span className="group-card-title">{group.name}</span>
          <span className="group-card-meta">{members.length} anime</span>
        </span>
      </button>
      {showActions && (
        <div className="group-card-actions" aria-label={`${group.name} group actions`}>
          <button type="button" onClick={() => onEditGroup?.(group)} aria-label={`Edit ${group.name} group`}>
            <IoCreateOutline aria-hidden="true" />
          </button>
          <button type="button" className="danger" onClick={() => onDeleteGroup?.(group)} aria-label={`Delete ${group.name} group`}>
            <IoTrashOutline aria-hidden="true" />
          </button>
        </div>
      )}
    </article>
  );
};

export default GroupCard;
