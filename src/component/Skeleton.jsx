import React from "react";
import "../assets/css/Cardslider.css"; // Ensure skeleton styles are loaded

const Skeleton = () => {
  return (
    <div className="skeleton-card">
      <div className="skeleton-image" />
      <div className="skeleton-line short" />
      <div className="skeleton-line" />
    </div>
  );
};

export default Skeleton;
