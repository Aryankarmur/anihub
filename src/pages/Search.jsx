import React, { useEffect, useState } from "react";
import "../assets/css/Search.css";
import { useNavigate, useSearchParams } from "react-router-dom";
import Card from "../component/Card";
import SkeletonCard from "../component/SkeletonCard";
import { fetchJikan } from "../api/Fetch";
import { FaSearch } from "react-icons/fa";

const Search = () => {
  const [searchParams] = useSearchParams();
  const [results, setResults] = useState([]);
  const [resultsError, setResultsError] = useState("");
  const [resultsloading, setResultsloading] = useState(false);
  const query = searchParams.get("q");
  const page = Number(searchParams.get("page")) || 1;
  const navigate = useNavigate();

  useEffect(() => {
    const getSearchAnime = async () => {
      try {
        setResultsloading(true);
        setResultsError("");

        if (!query) {
          setResults({ data: [] });
          return;
        }

        const data = await fetchJikan("anime", {
          params: { q: query, page },
        });

        setResults(data || { data: [] });
      } catch (error) {
        setResultsError(error.message);
      } finally {
        setResultsloading(false);
      }
    };

    getSearchAnime();
  }, [query, page]);

  const changePage = (pageNumber) => {
    navigate(`/search?q=${encodeURIComponent(query)}&page=${pageNumber}`);
  };

  const getPageNumbers = (currentPage, totalPages) => {
    if (!totalPages) return [];
    const pages = [];

    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    pages.push(1);

    if (currentPage > 4) {
      pages.push("...");
    }

    const start = Math.max(2, currentPage - 2);
    const end = Math.min(totalPages - 1, currentPage + 2);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (currentPage < totalPages - 3) {
      pages.push("...");
    }

    pages.push(totalPages);

    return pages;
  };

  const pages = getPageNumbers(page, results?.pagination?.last_visible_page);

  return (
    <section className="search_main">
      <div className="search-header">
        <h2>
          Search results for: <span className="query">"{query || ""}"</span>
        </h2>
      </div>
      <div className="search_results">
        {resultsloading ? (
          Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)
        ) : resultsError ? (
          <div className="empty-state">
            <p>{resultsError}</p>
          </div>
        ) : results.data && results.data.length === 0 ? (
          <div className="empty-state">
            <FaSearch className="empty-icon" />
            <p>No results. Try a different title.</p>
          </div>
        ) : (
          results.data &&
          [
            ...new Map(
              results.data.map((anime) => [
                anime.mal_id,
                {
                  mal_id: anime.mal_id,
                  large_image_url: anime?.images?.webp?.large_image_url,
                  title_english: anime?.title_english,
                  title: anime?.title,
                  score: anime?.score,
                  year: anime?.year,
                  episodes: anime?.episodes
                },
              ]),
            ).values(),
          ].map((anime) => <Card animeInfo={anime} key={anime.mal_id} />)
        )}
      </div>
      {pages.length > 0 && (
        <div className="pages">
          {pages.map((item, index) =>
            item === "..." ? (
              <span key={index}>...</span>
            ) : (
              <button
                key={index}
                onClick={() => changePage(item)}
                className={page === item ? "active" : ""}
              >
                {item}
              </button>
            ),
          )}
        </div>
      )}
    </section>
  );
};

export default Search;
