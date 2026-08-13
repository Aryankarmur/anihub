import React, { useEffect, useState } from "react";
import { fetchJikan } from "../api/Fetch";
import { useParams } from "react-router-dom";
import Card from "../component/Card";
import "../assets/css/CatAllAnime.css";

const CatAllAnime = () => {
  const [allAnime, setAllAnime] = useState([]);
  const { anime } = useParams();
  const [animePath, setAnimePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    switch (anime) {
      case "topAiring":
        setAnimePath("top/anime?filter=airing");
        break;

      case "newEpisode":
        setAnimePath("seasons/now");

        break;
      case "recommendations":
        setAnimePath("recommendations/anime");

        break;
      case "upcoming":
        setAnimePath("top/anime?filter=upcoming");

        break;
      case "Popular":
        setAnimePath("top/anime?filter=bypopularity");

        break;

      default:
        setAnimePath("top/anime?filter=airing");
        break;
    }

    const fetchAllCatAnime = async () => {
      try {
        setLoading(true);
        if (animePath) {
          
          const data = await fetchJikan(animePath);
          setAllAnime(Array.isArray(data?.data) ? data : []);
        }
      } catch (error) {
        console.log(animePath);
        
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAllCatAnime();
  }, [animePath, anime]);

  const getFilterAnime = () => {
    if (animePath.includes("watch")) {
      return [
        ...new Map(
          allAnime?.data
            ?.filter(
              (item) =>
                item.entry?.images?.webp?.large_image_url !==
                "https://cdn.myanimelist.net/images/icon-banned-youtube-rect.png",
            )
            .map((item) => [
              item.entry?.mal_id,
              {
                mal_id: item.entry?.mal_id,
                large_image_url: item.entry?.images?.webp?.large_image_url,
                title: item.entry?.title,
                title_english: item.entry?.title,
              },
            ]),
        ).values(),
      ];
    }

    if (animePath.includes("recommendations")) {
      return [
        ...new Map(
          allAnime?.data
            ?.filter(
              (item) =>
                item.entry[0]?.images?.webp?.large_image_url !==
                "https://cdn.myanimelist.net/images/icon-banned-youtube-rect.png",
            )
            .map((item) => [
              item.entry[0]?.mal_id,
              {
                mal_id: item.entry[0]?.mal_id,
                large_image_url: item.entry[0]?.images?.webp?.large_image_url,
                title: item.entry[0]?.title,
                title_english: item.entry[0]?.title,
              },
            ]),
        ).values(),
      ];
    }

    return [
      ...new Map(
        allAnime?.data?.map((item) => [
          item.mal_id,
          {
            mal_id: item.mal_id,
            large_image_url: item.images?.webp?.large_image_url,
            title: item.title,
            title_english: item.title_english,
          },
        ]),
      ).values(),
    ];
  };

  return (
    <div className="anime-main-div">
      <h2>{anime.toLocaleUpperCase()}</h2>

      <div className="anime-list">
        {loading ? (
          <div>Loading...</div>
        ) : error ? (
          <div> {error} </div>
        ) : (
          getFilterAnime &&
          getFilterAnime().map((animeData, i) => {
            return <Card animeInfo={animeData} key={i} />;
          })
        )}
      </div>
    </div>
  );
};

export default CatAllAnime;
