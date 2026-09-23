import { useEffect, useState } from "react";
import "../assets/css/Slider.css";
import { Link } from "react-router-dom";
import { fetchJikan } from "../api/Fetch";

const Slider = () => {
  const truncateTitle = (title) => {
    if (!title) return "";
    return title.length > 28 ? title.substring(0, 28) + "..." : title;
  };

  const [animeslid, setAnimeslid] = useState(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!animeslid?.length) return;

    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % animeslid.length);
    }, 3000);

    return () => clearInterval(timer);
  }, [animeslid, current]);

  const seasonAiring = async () => {
    try {
      const data = await fetchJikan("/seasons/now");

      const validAnime = (item) => item?.mal_id && item?.images?.webp?.large_image_url;
      const animeList = Array.isArray(data?.data) 
        ? data.data.filter(validAnime).slice(0, 7) 
        : [];
      setAnimeslid(animeList);
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    seasonAiring();
  }, []);

  return (
    <div className="main-slid">
      <div 
        className="slider-track"
        style={{
          transform: `translateX(-${current * 100}%)`,
        }}
      >
        {animeslid &&
          animeslid.map((item, index) => {
            return (
              <Link to={`anime/${item.mal_id}`} key={index} className="slider">
                <img
                  src={item.images?.webp?.large_image_url}
                  alt={item.title_english || item.title}
                />
                <div className="details">
                  <p className="ani-title">
                    {truncateTitle(item.title_english || item.title)}
                  </p>
                  <p className="ani-info">
                    <span className="year">{item.year}</span>
                    <span className="genera">
                      {item.genres?.map((gen) => gen.name).join(" • ")}
                    </span>
                  </p>
                </div>
              </Link>
            );
          })}
      </div>
      
      {animeslid && animeslid.length > 1 && (
        <div className="slider-indicators">
          {animeslid.map((_, idx) => (
            <span 
              key={idx} 
              className={`indicator ${idx === current ? "active" : ""}`}
              onClick={() => setCurrent(idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Slider;
