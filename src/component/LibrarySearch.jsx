import { IoClose, IoSearchOutline } from "react-icons/io5";
import { normalizeLibrarySearchQuery } from "../utils/librarySearch";

const LibrarySearch = ({
  query = "",
  onQueryChange,
  locationLabel,
  resultCount = null,
}) => {
  const label = `Search ${locationLabel}`;
  const isActive = Boolean(normalizeLibrarySearchQuery(query));

  return (
    <div className="library-search-area">
      <label className="library-search" aria-label={label}>
        <IoSearchOutline className="library-search-icon" aria-hidden="true" />
        <span className="sr-only">{label}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange?.(event.target.value)}
          placeholder={`Search ${locationLabel} by anime or group name`}
          aria-label={label}
          autoComplete="off"
        />
        {query.length > 0 && (
          <button
            type="button"
            className="library-search-clear"
            onClick={() => onQueryChange?.("")}
            aria-label={`Clear ${locationLabel} search`}
          >
            <IoClose aria-hidden="true" />
          </button>
        )}
      </label>
      {isActive && Number.isInteger(resultCount) && (
        <span className="library-search-count" role="status">
          {resultCount} {resultCount === 1 ? "result" : "results"}
        </span>
      )}
    </div>
  );
};

export const LibrarySearchEmptyState = ({ query }) => (
  <div className="library-search-empty" role="status">
    <p>No anime or groups match “{String(query).trim()}”.</p>
    <span>Try a different anime title or group name.</span>
  </div>
);

export default LibrarySearch;
