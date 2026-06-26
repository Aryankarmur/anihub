import Card from "./Card";
import "../assets/css/Cardslider.css";

const Cardslider = ({ sliderTitle, anime, loading = false }) => {
  const placeholderCards = Array.from({ length: 6 }, (_, index) => index);

  return (
    <div className="slider_main">
      <div className="header">
        <p className="title">{sliderTitle}</p>
        <p className="see">See all</p>
      </div>
      <div className={`card-slider ${loading ? "is-loading" : ""}`}>
        {loading
          ? placeholderCards.map((item) => (
              <div className="skeleton-card" key={item}>
                <div className="skeleton-image" />
                <div className="skeleton-line short" />
                <div className="skeleton-line" />
              </div>
            ))
          : anime?.map((animeinfo, index) => (
              <Card animeInfo={animeinfo} key={index} />
            ))}
      </div>
    </div>
  );
};

export default Cardslider;
