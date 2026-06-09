import Card from "./Card";
import "../assets/css/Cardslider.css";
import { getAnime } from "../api/Fetch";
import { useEffect, useState } from "react";

const Cardslider = ({ sliderTitle, anime }) => {
  return (
    <>
      <div className="slider_main">
        <div className="header">
          <p className="title">{sliderTitle}</p>
          <p className="see">See all</p>
        </div>
        <div className="card-slider">
          {anime &&
            anime.map((animeinfo, index) => {
              return <Card animeInfo={animeinfo} key={index} />;
            })}
        </div>
      </div>
    </>
  );
};

export default Cardslider;
