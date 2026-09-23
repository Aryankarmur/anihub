import React from "react";
import { Link } from "react-router-dom";
import "../assets/css/Footer.css";

const Footer = () => {
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-brand">
          <Link to="/" className="footer-logo">
            Ani<span className="accent">Hub</span>
          </Link>
          <p className="footer-tagline">
            Discover your next favorite anime.
          </p>
        </div>
        
        <div className="footer-explore">
          <h3 className="footer-title">Explore</h3>
          <ul className="footer-links">
            <li><Link to="/">Home</Link></li>
            <li><Link to="/catalog">Catalog</Link></li>
            <li><Link to="/search">Search</Link></li>
          </ul>
        </div>
        
        <div className="footer-about">
          <h3 className="footer-title">About</h3>
          <p className="footer-text">
            Built with React and AniList API.
          </p>
          <p className="footer-text">
            Anime information provided by <a href="https://anilist.co" target="_blank" rel="noreferrer">AniList</a>.
          </p>
        </div>
      </div>
      
      <div className="footer-bottom">
        <p>&copy; {new Date().getFullYear()} AniHub. All rights reserved.</p>
        <p className="footer-bottom-tag">Anime discovery made simple.</p>
      </div>
    </footer>
  );
};

export default Footer;
