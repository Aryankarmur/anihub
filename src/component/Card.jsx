import { Link, Links } from "react-router-dom";
import "../assets/css/Card.css";

const Card = ({ animeInfo }) => {
  const animeTitle = animeInfo.title_english || animeInfo.title;
  const truncatedTitle =
    animeTitle.length > 14 ? `${animeTitle.substring(0, 14)}...` : animeTitle;

  return (
    animeInfo && (
      <Link to={`/anime/${animeInfo.mal_id}`}>
        <div className="card">
          <div className="img">
            <img
              src={animeInfo.large_image_url}
              alt={`${animeInfo.title_english || animeInfo.title} image`}
            />
          </div>
          <p>{truncatedTitle}</p>
        </div>
      </Link>
    )
  );
};
export default Card;
