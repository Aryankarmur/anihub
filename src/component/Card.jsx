import { Link } from "react-router-dom";
import { FaStar } from "react-icons/fa";
import "../assets/css/Card.css";

const Card = ({ animeInfo }) => {
  if (!animeInfo) return null;

  const animeTitle = animeInfo.title_english || animeInfo.title;

  return (
    <Link to={`/anime/${animeInfo.mal_id}`} className="card-link">
      <div className="card">
        <div className="img-wrapper">
          <img
            src={animeInfo.large_image_url}
            alt={`${animeTitle} image`}
          />
          {animeInfo.score && (
            <div className="score-badge">
              <FaStar className="star-icon" />
              <span>{animeInfo.score}</span>
            </div>
          )}
        </div>
        <div className="card-content">
          <p className="card-title">{animeTitle}</p>
          <p className="card-meta">
            {animeInfo.episodes || animeInfo.year ? (
              <>
                {animeInfo.episodes ? `${animeInfo.episodes} EPS` : ""}
                {animeInfo.episodes && animeInfo.year ? " • " : ""}
                {animeInfo.year || ""}
              </>
            ) : (
              <>&nbsp;</>
            )}
          </p>
        </div>
      </div>
    </Link>
  );
};
export default Card;
