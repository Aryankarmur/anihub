import React, { useEffect, useState } from "react";
import { FaChevronDown, FaSearch } from "react-icons/fa";
import "../assets/css/Catalogs.css";
import Card from "../component/Card";
import SkeletonCard from "../component/SkeletonCard";
import { fetchJikan, fetchAniListCatalog } from "../api/Fetch";

const Catalogs = () => {
  const [isDropdown, setIsDropdown] = useState({
    isYear: false,
    isSeason: false,
    isGenres: false,
    isStudios: false,
    isFormat: false,
    isStatus: false,
    isSort: false,
  });

  const [genres, setGenres] = useState([]);
  const [studios, setStudios] = useState([]);
  const [allAnimeData, setAllAnimeData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sortBy, setSortBy] = useState("default");

  const [selectedFilters, setSelectedFilters] = useState({
    seasons: [],
    genres: [],
    studios: [],
    formats: [],
    status: [],
    years: {
      from: "",
      to: "",
    },
  });

  const [pagination, setPagination] = useState({
    current_page: 1,
  });
  
  const [totalPages, setTotalPages] = useState(1);

  const pageSize = 24;

  const buildParams = () => {
    const params = {
      page: pagination.current_page,
      perPage: pageSize,
    };

    if (selectedFilters.genres.length > 0) {
      params.genres = selectedFilters.genres;
    }

    if (selectedFilters.years.from) {
      params.seasonYear = selectedFilters.years.from;
    }

    if (selectedFilters.seasons.length > 0) {
      params.season = selectedFilters.seasons[0].toUpperCase();
    }

    if (selectedFilters.formats.length > 0) {
      const formatMap = {
        "tv": "TV",
        "movie": "MOVIE",
        "ova": "OVA",
        "ona": "ONA",
        "special": "SPECIAL",
        "tv special": "TV_SHORT",
        "music": "MUSIC",
        "cm": "MUSIC",
        "pv": "MUSIC",
      };
      params.format = formatMap[selectedFilters.formats[0].toLowerCase()] || "TV";
    }

    if (selectedFilters.status.length > 0) {
      const statusMap = {
        "airing": "RELEASING",
        "complete": "FINISHED",
        "upcoming": "NOT_YET_RELEASED"
      };
      params.status = statusMap[selectedFilters.status[0].toLowerCase()] || "RELEASING";
    }

    const sortMap = {
      "default": "POPULARITY_DESC",
      "score": "SCORE_DESC",
      "newest": "START_DATE_DESC",
      "oldest": "START_DATE_ASC",
      "title": "TITLE_ENGLISH_DESC"
    };
    params.sort = [sortMap[sortBy || "default"]];

    return params;
  };

  const fetchAnime = async () => {
    try {
      setLoading(true);
      setLoadError("");
      const baseParams = buildParams();

      const data = await fetchAniListCatalog(baseParams);

      const items = Array.isArray(data?.data) ? data.data : [];
      setAllAnimeData(items);
      setTotalPages(data?.pageInfo?.lastPage || 1);
    } catch (error) {
      console.warn("Catalog load failed:", error.message);
      setAllAnimeData([]);
      setTotalPages(1);
      setLoadError(
        "Anime catalog is temporarily unavailable. Please refresh in a moment."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnime();
  }, [
    selectedFilters.genres,
    selectedFilters.years.from,
    selectedFilters.seasons,
    selectedFilters.formats,
    selectedFilters.status,
    sortBy,
    pagination.current_page
  ]);

  const currentYear = new Date().getFullYear();

  const years = Array.from(
    { length: currentYear - 1917 + 1 },
    (_, index) => currentYear - index
  );

  const seasons = ["winter", "spring", "summer", "fall"];

  const formats = [
    "TV",
    "OVA",
    "Movie",
    "Special",
    "ONA",
    "Music",
    "CM",
    "PV",
    "TV Special",
  ];

  const statuses = ["airing", "complete", "upcoming"];

  useEffect(() => {
    const fetchGenres = async () => {
      try {
        setGenres([]);
        const data = await fetchJikan("genres/anime");
        (data?.data || []).forEach((g) => {
          setGenres((prev) => [...prev, { name: g?.name, id: g?.mal_id }]);
        });
      } catch (error) {
        console.log(error.message);
      }
    };

    const fetchStudios = async () => {
      setStudios([]);
      const data = await fetchJikan("producers");
      (data?.data || []).forEach((s) => {
        setStudios((prev) => [...prev, s?.titles[0]?.title]);
      });
    };

    fetchGenres();
    fetchStudios();
  }, []);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, current_page: 1 }));
  }, [
    selectedFilters.seasons,
    selectedFilters.studios,
    selectedFilters.formats,
    selectedFilters.status,
    selectedFilters.genres,
    selectedFilters.years.from,
    selectedFilters.years.to,
    sortBy,
  ]);

  const handleFilterChange = (category, value) => {
    setSelectedFilters((prev) => ({
      ...prev,
      [category]: prev[category].includes(value)
        ? prev[category].filter((item) => item !== value)
        : [...prev[category], value],
    }));
  };

  const handleClick = (filters) => {
    setIsDropdown((prev) => ({
      ...prev,
      [filters]: !prev[filters],
    }));
  };

  const pagedAnime = allAnimeData;

  const getPageNumbers = () => {
    const pages = [];
    const current = pagination.current_page;

    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    pages.push(1);

    if (current > 3) {
      pages.push("...");
    }

    for (
      let i = Math.max(2, current - 1);
      i <= Math.min(totalPages - 1, current + 1);
      i += 1
    ) {
      pages.push(i);
    }

    if (current < totalPages - 2) {
      pages.push("...");
    }

    pages.push(totalPages);

    return pages;
  };

  return (
    <section className="catalog_section">
      <aside className="sideBar">
        <h2>Catalog</h2>
        <div className="filters">
          <div className="dropdown_main" id="years">
            <div
              className="dropdown_menu"
              onClick={() => handleClick("isYear")}
            >
              <span>Year</span>
              <span
                className={`${isDropdown.isYear ? "toggleUp" : "toggleDown"}`}
              >
                {" "}
                <FaChevronDown />{" "}
              </span>
            </div>
            <div
              className={`dropdown_items ${isDropdown.isYear ? "show" : "hide"} `}
            >
              <label htmlFor="from">
                {" "}
                From :
                <select
                  name="year_from"
                  id="from"
                  value={selectedFilters.years.from || ""}
                  onChange={(e) =>
                    setSelectedFilters((prev) => ({
                      ...prev,
                      years: {
                        ...prev.years,
                        from: e.target.value ? Number(e.target.value) : "",
                      },
                    }))
                  }
                >
                  <option value="">Any</option>
                  {years.map((y) => {
                    return (
                      <option value={y} key={y}>
                        {y}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label htmlFor="to">
                {" "}
                To :
                <select
                  name="year_to"
                  id="to"
                  value={selectedFilters.years.to || ""}
                  onChange={(e) =>
                    setSelectedFilters((prev) => ({
                      ...prev,
                      years: {
                        ...prev.years,
                        to: e.target.value ? Number(e.target.value) : "",
                      },
                    }))
                  }
                >
                  <option value="">Any</option>
                  {selectedFilters.years.from
                    ? years
                        .filter((y) => y >= Number(selectedFilters.years.from))
                        .map((year) => {
                          return (
                            <option value={year} key={year}>
                              {year}
                            </option>
                          );
                        })
                    : years.map((year) => {
                        return (
                          <option value={year} key={year}>
                            {year}
                          </option>
                        );
                      })}
                </select>
              </label>
            </div>
          </div>

          <div className="dropdown_main">
            <div
              className="dropdown_menu"
              onClick={() => handleClick("isSort")}
            >
              <span>Sort By</span>
              <span
                className={`${isDropdown.isSort ? "toggleUp" : "toggleDown"}`}
              >
                {" "}
                <FaChevronDown />{" "}
              </span>
            </div>
            <div
              className={`dropdown_items ${isDropdown.isSort ? "show" : "hide"} `}
            >
              <label htmlFor="sort-select">
                <select
                  id="sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="default">Default</option>
                  <option value="score">Highest Score</option>
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="title">Title A-Z</option>
                </select>
              </label>
            </div>
          </div>

          <div className="dropdown_main">
            <div
              className="dropdown_menu"
              onClick={() => handleClick("isSeason")}
            >
              <span>Season</span>
              <span
                className={`${isDropdown.isSeason ? "toggleUp" : "toggleDown"}`}
              >
                {" "}
                <FaChevronDown />{" "}
              </span>
            </div>
            <div
              className={`dropdown_items ${isDropdown.isSeason ? "show" : "hide"} `}
            >
              {seasons.map((s, i) => {
                return (
                  <label htmlFor={s} key={i}>
                    <input
                      type="checkbox"
                      name={s}
                      id={s}
                      checked={selectedFilters.seasons.includes(s)}
                      onChange={() => handleFilterChange("seasons", s)}
                    />
                    <span>{s}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="dropdown_main">
            <div
              className="dropdown_menu"
              onClick={() => handleClick("isGenres")}
            >
              <span>Genres</span>
              <span
                className={`${isDropdown.isGenres ? "toggleUp" : "toggleDown"}`}
              >
                {" "}
                <FaChevronDown />{" "}
              </span>
            </div>
            <div
              className={`dropdown_items ${isDropdown.isGenres ? "show" : "hide"} `}
            >
              {genres.map((g, i) => {
                return (
                  <label htmlFor={g.id} key={i}>
                    <input
                      type="checkbox"
                      name={g.name}
                      id={g.id}
                      checked={selectedFilters.genres.includes(g.id)}
                      onChange={() => handleFilterChange("genres", g.id)}
                    />
                    <span> {g.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="dropdown_main">
            <div
              className="dropdown_menu"
              onClick={() => handleClick("isStudios")}
            >
              <span>Studios</span>
              <span
                className={`${isDropdown.isStudios ? "toggleUp" : "toggleDown"}`}
              >
                {" "}
                <FaChevronDown />{" "}
              </span>
            </div>
            <div
              className={`dropdown_items ${isDropdown.isStudios ? "show" : "hide"} `}
            >
              {studios.map((s, i) => {
                return (
                  <label htmlFor={s} key={i}>
                    <input
                      type="checkbox"
                      name={s}
                      id={s}
                      checked={selectedFilters.studios.includes(s)}
                      onChange={() => handleFilterChange("studios", s)}
                    />
                    <span> {s}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div
            className="dropdown_main"
            onClick={() => handleClick("isFormat")}
          >
            <div className="dropdown_menu">
              <span>Format</span>
              <span
                className={`${isDropdown.isFormat ? "toggleUp" : "toggleDown"}`}
              >
                {" "}
                <FaChevronDown />{" "}
              </span>
            </div>
            <div
              className={`dropdown_items ${isDropdown.isFormat ? "show" : "hide"} `}
            >
              {formats.map((f, i) => {
                return (
                  <label htmlFor={f} key={i}>
                    <input
                      type="checkbox"
                      name={f}
                      id={f}
                      checked={selectedFilters.formats.includes(f)}
                      onChange={() => handleFilterChange("formats", f)}
                    />
                    <span> {f}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div
            className="dropdown_main"
            onClick={() => handleClick("isStatus")}
          >
            <div className="dropdown_menu">
              <span>Airing Status</span>
              <span
                className={`${isDropdown.isStatus ? "toggleUp" : "toggleDown"}`}
              >
                {" "}
                <FaChevronDown />{" "}
              </span>
            </div>
            <div
              className={`dropdown_items ${isDropdown.isStatus ? "show" : "hide"} `}
            >
              {statuses.map((s, i) => {
                return (
                  <label htmlFor={s} key={i}>
                    <input
                      type="checkbox"
                      name={s}
                      id={s}
                      checked={selectedFilters.status.includes(s)}
                      onChange={() => handleFilterChange("status", s)}
                    />
                    <span> {s}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </aside>

      <div className="content">
        <div className="topBar">
          <div>
            <h3>Discover anime</h3>
            <p>
              Browse your favorite series with refined filters and elegant
              cards.
            </p>
          </div>
          <span className="pageInfo">
            Page {pagination.current_page} of {totalPages}
          </span>
        </div>

        <div className="cards">
          {loading ? (
            Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)
          ) : loadError ? (
            <div className="emptyState">
              <p>{loadError}</p>
            </div>
          ) : pagedAnime && pagedAnime.length > 0 ? (
            pagedAnime.map((anime) => (
              <Card
                animeInfo={{
                  mal_id: anime.mal_id,
                  large_image_url: anime?.images?.webp?.large_image_url,
                  title_english: anime?.title_english,
                  title: anime?.title,
                  score: anime?.score,
                  year: anime?.year,
                  episodes: anime?.episodes
                }}
                key={anime.mal_id}
              />
            ))
          ) : (
            <div className="emptyState">
              <FaSearch className="empty-icon" />
              <p>No anime matched these filters yet.</p>
            </div>
          )}
        </div>

        <div className="pagination">
          <button
            disabled={pagination.current_page === 1}
            onClick={() =>
              setPagination((prev) => ({
                ...prev,
                current_page: Math.max(1, prev.current_page - 1),
              }))
            }
          >
            Prev
          </button>

          {getPageNumbers().map((page, index) =>
            page === "..." ? (
              <span key={index}>...</span>
            ) : (
              <button
                key={index}
                className={pagination.current_page === page ? "active" : ""}
                onClick={() =>
                  setPagination((prev) => ({
                    ...prev,
                    current_page: page,
                  }))
                }
              >
                {page}
              </button>
            ),
          )}

          <button
            disabled={pagination.current_page === totalPages}
            onClick={() =>
              setPagination((prev) => ({
                ...prev,
                current_page: Math.min(totalPages, prev.current_page + 1),
              }))
            }
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
};

export default Catalogs;
