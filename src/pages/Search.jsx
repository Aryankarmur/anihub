import React, { useEffect, useState } from "react";
import "../assets/css/Search.css";
import { useNavigate, useSearchParams } from "react-router-dom";
import Card from "../component/Card";

const Search = () => {
  const [searchParams] = useSearchParams();
  const [results, setResults] = useState([]);
  const [resultsError, setResultsError] = useState("");
  const [resultsloading, setResultsloading] = useState(false);
  const query = searchParams.get("q");
  const page = Number(searchParams.get("page"));
  const navigate = useNavigate();

  useEffect(() => {
    const getSearchAnime = async () => {
      try {
        setResultsloading(true);
        const resp = await fetch(
          `https://api.jikan.moe/v4/anime?q=${query}&page=${page}`,
        );

        if (resp.status !== 200) {
          throw new Error("Something went wrong! ");
        }

        const data = await resp.json();
        setResults(data);
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

  const pages = getPageNumbers(page, results.pagination.last_visible_page);

  return (
    <section className="search_main">
      <h2>
        Search results for : <span> {query ? query : ""} </span>
      </h2>
      <div className="search_results">
        {resultsloading ? (
          <div className="notres">
            <p>Loading...</p>
          </div>
        ) : resultsError ? (
          <div className="notres">
            <p>{resultsError}</p>
          </div>
        ) : results.length <= 0 ? (
          <div className="notres">
            <p>No Results Found</p>
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
                },
              ]),
            ).values(),
          ].map((anime) => <Card animeInfo={anime} key={anime.mal_id} />)
        )}
      </div>
      <div className="pages">
        {pages.map((item, index) =>
          item === "..." ? (
            <span key={index}>...</span>
          ) : (
            <button
              key={item}
              onClick={() => changePage(item)}
              className={page === item ? "active" : ""}
            >
              {item}
            </button>
          ),
        )}
      </div>
    </section>
  );
};

export default Search;
