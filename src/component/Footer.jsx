import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../assets/css/Footer.css";

const Footer = () => {
  const { currentUser } = useAuth();

  return (
    <footer className="footer">
      <div className="footer-container">
        
        {/* ROW 1 */}
        <div className="footer-row row-1">
          {/* BRAND */}
          <div className="footer-section footer-brand">
            <Link to="/" className="footer-logo">
              Ani<span className="accent">Hub</span>
            </Link>
            <p className="footer-tagline">
              Discover, explore, and keep track of your favorite anime.
            </p>
          </div>
          
          {/* EXPLORE */}
          <div className="footer-section">
            <h3 className="footer-title">Explore</h3>
            <nav>
              <ul className="footer-links">
                <li><Link to="/">Home</Link></li>
                <li><Link to="/catalog">Catalog</Link></li>
                <li><Link to="/search">Search</Link></li>
              </ul>
            </nav>
          </div>
          
          {/* MY LIBRARY */}
          <div className="footer-section">
            <h3 className="footer-title">My Library</h3>
            <nav>
              <ul className="footer-links">
                <li><Link to="/library">Watchlist</Link></li>
                <li><Link to="/library">Collections</Link></li>
              </ul>
            </nav>
          </div>
        </div>

        {/* ROW 2 */}
        <div className="footer-row row-2">
          {/* ACCOUNT */}
          <div className="footer-section">
            <h3 className="footer-title">Account</h3>
            <nav>
              <ul className="footer-links">
              {currentUser ? (
                <>
                  <li><Link to="/profile">Profile</Link></li>
                </>
              ) : (
                <>
                  <li><Link to="/login">Login</Link></li>
                  <li><Link to="/register">Sign Up</Link></li>
                </>
              )}
              </ul>
            </nav>
          </div>

          {/* ABOUT */}
          <div className="footer-section footer-about">
            <h3 className="footer-title">About</h3>
            <p className="footer-text">
              Built with React and AniList API.
            </p>
            <p className="footer-text">
              Anime information provided by <a href="https://anilist.co/" target="_blank" rel="noreferrer">AniList</a>.
            </p>
          </div>
        </div>

      </div>
      
      <div className="footer-bottom">
        <p>&copy; 2026 AniHub</p>
        <p className="footer-bottom-tag">Built with React</p>
      </div>
    </footer>
  );
};

export default Footer;
