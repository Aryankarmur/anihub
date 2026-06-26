import { useEffect, useState } from "react";
import { getAnime } from "../api/Fetch";

import Slider from "../component/Slider";
import Cardslider from "../component/Cardslider";

const Home = () => {
  const [airing, setAiring] = useState([]);
  const [episode, setEpisode] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [popular, setPopular] = useState([]);
  const [loading, setLoading] = useState(true);

  const delayedGetAnime = async (endpoint, ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return getAnime(endpoint);
  };

  useEffect(() => {
    const fetchdata = async () => {
      const [
        airingData,
        episodeData,
        recommendedData,
        upcomingData,
        popularData,
      ] = await Promise.all([
        delayedGetAnime("top/anime?filter=airing", 500),
        delayedGetAnime("seasons/now", 500),
        delayedGetAnime("recommendations/anime", 1020),
        delayedGetAnime("top/anime?filter=upcoming", 2000),
        delayedGetAnime("top/anime?filter=bypopularity", 3000),
      ]);

      setAiring(airingData);
      setEpisode(episodeData);
      setRecommended(recommendedData);
      setUpcoming(upcomingData);
      setPopular(popularData);
      setLoading(false);
    };

    fetchdata();
  }, []);

  return (
    <>
      <Slider />

      <Cardslider sliderTitle="Top Airing" anime={airing} loading={loading} />

      <Cardslider
        sliderTitle="New Episodes Releases"
        anime={episode}
        loading={loading}
      />

      <Cardslider
        sliderTitle="Recommended"
        anime={recommended}
        loading={loading}
      />

      <Cardslider sliderTitle="Upcoming" anime={upcoming} loading={loading} />

      <Cardslider
        sliderTitle="Most Popular"
        anime={popular}
        loading={loading}
      />
    </>
  );
};

export default Home;
