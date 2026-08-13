import { useEffect, useState } from "react";
import "../assets/css/Slider.css";
import { Link } from "react-router-dom";
import { fetchJikan } from "../api/Fetch";

const Slider = () => {
  const [animeslid, setAnimeslid] = useState(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!animeslid?.length) return;

    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % animeslid.length);
    }, 7000);

    return () => clearInterval(timer);
  }, [animeslid]);

  const seasonAiring = async () => {
    try {
      const data = await fetchJikan("/seasons/now", {
        params: { limit: 7 },
      });

      setAnimeslid(Array.isArray(data?.data) ? data.data : []);
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    seasonAiring();
  }, []);

  return (
    <div className="main-slid">
      {animeslid &&
        animeslid.map((item, index) => {
          return (
            <Link to={`anime/${item.mal_id}`} key={index}>
              <div
                className="slider"
                style={{
                  transform: `translateX(-${current * 100}%)`,
                }}
              >
                <img
                  src={item.images.webp.large_image_url}
                  alt={item.title_english}
                />
                <div className="details">
                  <p className="ani-title">
                    {item.title_english || item.title}
                  </p>
                  <p className="ani-info">
                    <span className="year">{item.year}</span>
                    <span className="genera">
                      {item.genres.map((gen) => gen.name).join(", ")}
                    </span>
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
    </div>
  );
};

export default Slider;
