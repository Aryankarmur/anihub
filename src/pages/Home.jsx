import { useEffect, useState } from "react";
import { getAnime } from "../api/Fetch";
import "../assets/css/Home.css";

import Slider from "../component/Slider";
import Cardslider from "../component/Cardslider";

const Home = () => {
  const [airing, setAiring] = useState(null);
  const [episode, setEpisode] = useState(null);
  const [recommended, setRecommended] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [popular, setPopular] = useState(null);

  useEffect(() => {
    // Fire all requests immediately.
    // The global request queue in Fetch.js will handle sequencing and rate limits.
    getAnime("top/anime?filter=airing").then(setAiring).catch(() => setAiring([]));
    getAnime("seasons/now").then(setEpisode).catch(() => setEpisode([]));
    getAnime("recommendations/anime").then(setRecommended).catch(() => setRecommended([]));
    getAnime("seasons/upcoming").then(setUpcoming).catch(() => setUpcoming([]));
    getAnime("top/anime?filter=bypopularity").then(setPopular).catch(() => setPopular([]));
  }, []);

  return (
    <div className="home-wrapper">
      <Slider />

      <Cardslider 
      sliderTitle="Top Airing" 
      anime={airing} 
      loading={airing === null} 
      seeMorePath={"topAiring"}
      />

      <Cardslider
        sliderTitle="New Episodes Releases"
        anime={episode}
        loading={episode === null}
        seeMorePath={"newEpisode"}
      />

      <Cardslider
        sliderTitle="Recommended"
        anime={recommended}
        loading={recommended === null}
        seeMorePath={"recommendations"}
      />

      <Cardslider 
      sliderTitle="Upcoming" 
      anime={upcoming} 
      loading={upcoming === null} 
      seeMorePath={"upcoming"}
      />

      <Cardslider
        sliderTitle="Most Popular"
        anime={popular}
        loading={popular === null}
        seeMorePath={"Popular"}
      />
    </div>
  );
};

export default Home;
