import { Link, Links } from "react-router-dom";
import "../assets/css/Card.css";

const Card = ({ animeInfo }) => {
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
          <p>{animeInfo.title_english || animeInfo.title}</p>
        </div>
      </Link>
    )
  );
};
export default Card;
