import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import "../assets/css/Navbar.css";
import { IoIosMenu } from "react-icons/io";
import { IoIosClose } from "react-icons/io";
import { fetchJikan } from "../api/Fetch";

const Navbar = () => {
  const [isClick, setIsClick] = useState(false);
  const [scroll, setScroll] = useState(false);
  const [query, setQuery] = useState("");
  const [search_res, setSearch_res] = useState([]);
  const [loading_search, setLoading_search] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const handleMenu = () => {
    setIsClick(!isClick);
  };

  const handelSearchForm = (e) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query)}&page=1`);
      setSearch_res([]);
      setQuery("");
      setIsClick(false);
    }
  };

  const handleNavLinkClick = () => {
    setIsClick(false);
  };

  useEffect(() => {
    const resulttimeout = setTimeout(async () => {
      setLoading_search(true);
      try {
        if (query.trim().length >= 3) {
          const result_data = await fetchJikan("anime", {
            params: { q: query, limit: 5 },
          });

          setSearch_res(result_data?.data || []);
        } else {
          setSearch_res([]);
        }
      } catch (error) {
        console.log(error.message);
      } finally {
        setLoading_search(false);
      }
    }, 800);

    return () => clearTimeout(resulttimeout);
  }, [query]);

  useEffect(() => {
    const handleScroll = () => {
      setScroll(window.scrollY > 50);
    };

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    setSearch_res([]);
    setQuery("");
    setIsClick(false);
  }, [location.pathname]);

  return (
    <nav>
      <section className={scroll ? "scroll" : ""}>
        <div className="logo">
          <Link to="/" onClick={handleNavLinkClick}>
            Ani<span className="accent">Hub</span>
          </Link>
        </div>

        <div className="menu">
          <ul>
            <li>
              <NavLink to={"/"} end onClick={handleNavLinkClick}>
                Home
              </NavLink>
            </li>
            <li>
              <NavLink to={"/catalog"} onClick={handleNavLinkClick}>
                Catalog
              </NavLink>
            </li>
         
          </ul>

          <form onSubmit={handelSearchForm} className="search-form">
            <input
              type="search"
              name="search"
              id="search"
              placeholder="Search anime"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>

          {!location.pathname.includes("/search") && (search_res.length > 0 || (loading_search && query.trim().length >= 3)) && (
            <div className="search_results">
              {search_res.length > 0
                ? search_res.map((items) => {
                    return (
                      <Link
                        to={`/anime/${items?.mal_id}`}
                        key={items?.mal_id}
                        onClick={handleNavLinkClick}
                      >
                        <div className="card_main">
                          <div className="image">
                            <img
                              src={items.images?.webp?.large_image_url}
                              alt={`${items?.title} image`}
                            />
                          </div>
                          <div className="details">
                            <p>{items.title}</p>
                            <p>
                              <span>Score:</span> {items.score} •{" "}
                              <span>Rating:</span> {items.rating?.split(" - ")[0]}
                            </p>
                          </div>
                        </div>
                      </Link>
                    );
                  })
                : null}
              {loading_search && query.trim().length >= 3 ? (
                <div className="search_status">Searching...</div>
              ) : null}
            </div>
          )}

         
        </div>

        <div className="mob-menu">
          <button
            className="menu-btn"
            onClick={handleMenu}
            type="button"
            aria-label="Toggle menu"
            aria-expanded={isClick}
          >
            {isClick ? <IoIosClose /> : <IoIosMenu />}
          </button>

          <ul className={isClick ? "menu-list" : "menu-list dis-none"}>
            <li>
              <NavLink to={"/"} end onClick={handleNavLinkClick}>
                Home
              </NavLink>
            </li>
            <li>
              <NavLink to={"/catalog"} onClick={handleNavLinkClick}>
                Catalog
              </NavLink>
            </li>
            
            <form onSubmit={handelSearchForm} className="mobile-search-form">
              <input
                type="search"
                name="search"
                placeholder="Search anime"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </form>
            
          </ul>
        </div>
      </section>
    </nav>
  );
};

export default Navbar;
