import React, { useEffect, useState } from "react";
import { fetchAniListCatalog } from "../api/Fetch";
import { useParams } from "react-router-dom";
import Card from "../component/Card";
import "../assets/css/CatAllAnime.css";

const CatAllAnime = () => {
  const [allAnime, setAllAnime] = useState([]);
  const { anime } = useParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [variables, setVariables] = useState(null);

  useEffect(() => {
    let vars = { page, perPage: 24 };
    switch (anime) {
      case "topAiring":
        vars = { ...vars, status: "RELEASING", sort: ["SCORE_DESC"] };
        break;
      case "newEpisode":
        vars = { ...vars, status: "RELEASING", sort: ["START_DATE_DESC"] };
        break;
      case "recommendations":
        vars = { ...vars, sort: ["TRENDING_DESC"] };
        break;
      case "upcoming":
        vars = { ...vars, status: "NOT_YET_RELEASED", sort: ["POPULARITY_DESC"] };
        break;
      case "Popular":
        vars = { ...vars, sort: ["POPULARITY_DESC"] };
        break;
      default:
        vars = { ...vars, status: "RELEASING", sort: ["SCORE_DESC"] };
        break;
    }
    setVariables(vars);
  }, [anime, page]);

  useEffect(() => {
    const fetchAllCatAnime = async () => {
      if (!variables) return;
      try {
        setLoading(true);
        setError("");
        const data = await fetchAniListCatalog(variables);
        setAllAnime(data.data || []);
        setTotalPages(data.pageInfo?.lastPage || 1);
      } catch (error) {
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAllCatAnime();
  }, [variables]);

  // Map section key to readable title
  const getReadableTitle = () => {
    switch (anime) {
      case "topAiring": return "TOP AIRING";
      case "newEpisode": return "NEW EPISODES RELEASES";
      case "recommendations": return "RECOMMENDED (TRENDING)";
      case "upcoming": return "UPCOMING";
      case "Popular": return "MOST POPULAR";
      default: return anime.toUpperCase();
    }
  }

  return (
    <div className="anime-main-div">
      <h2>{getReadableTitle()}</h2>

      <div className="anime-list">
        {loading ? (
          <div className="loading-state">Loading...</div>
        ) : error ? (
          <div className="error-state">{error}</div>
        ) : (
          allAnime.map((animeData, i) => {
            return <Card animeInfo={animeData} key={animeData.mal_id || i} />;
          })
        )}
      </div>
      
      {!loading && totalPages > 1 && (
        <div className="pagination">
          <button 
            disabled={page === 1} 
            onClick={() => setPage(p => p - 1)}
            aria-label="Previous page"
          >
            Prev
          </button>
          <span className="page-indicator">
            Page {page} of {totalPages}
          </span>
          <button 
            disabled={page === totalPages} 
            onClick={() => setPage(p => p + 1)}
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default CatAllAnime;
