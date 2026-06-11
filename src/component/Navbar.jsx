import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import "../assets/css/Navbar.css";
import { IoIosMenu } from "react-icons/io";
import { IoIosClose } from "react-icons/io";

const Navbar = () => {
  const [isClick, setIsClick] = useState(false);
  const [scroll, setScroll] = useState(false);
  const [query, setQuery] = useState("");
  const [search_res, setSearch_res] = useState([]);
  const [loading_search, setLoading_search] = useState([]);
  
  const navigate = useNavigate();
  const location = useLocation();


  const handleMenu = () => {
    setIsClick(!isClick);
  };
  
  const handelSearchForm=(e)=>{
    e.preventDefault();
    if(query.trim()){
      navigate(`/search?q=${encodeURIComponent(query)}&page=1`);
      setSearch_res([]);
      setQuery("");
    }
  }
  
  useEffect(() => {
    const resulttimeout = setTimeout(async () => {
      setLoading_search(true);
      try {
        if (query.trim()) {
          const result_resp = await fetch(
            `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=5`,
          );
          const result_data = await result_resp.json();

          setSearch_res(result_data.data || []);
        }
        if (query === "") {
          setSearch_res([]);
        }
      } catch (error) {
        console.log(error.message);
      } finally {
        setLoading_search(false);
      }
    }, 500);

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
}, [location.pathname]);

  return (
    <nav>
      <section className={scroll ? "scroll" : ""}>
        <div className="logo">
          <p>
            <span>Ani</span>hub
          </p>
        </div>
        <div className="menu">
          <ul>
            <li>Home</li>
            <li>Catalog</li>
            <li>Collections</li>
          </ul>
          <form onSubmit={handelSearchForm}>
            <input
              type="search"
              name="search"
              id="search"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>
          <div className="search_results">
            {!location.pathname.includes("/search") && search_res.length > 0
              ? search_res.map((items) => {
                  return (
                    <Link to={`/anime/${items?.mal_id}`} key={items?.mal_id}>
                      <div className="card_main">
                        <div className="image">
                          <img
                            src={items.images?.webp?.large_image_url}
                            alt={`${items?.title} image`}
                          />
                        </div>
                        <div className="details">
                          <p>{items.title} </p>
                          <p>
                            {" "}
                            <span>Score : </span> {items.score}{" "}
                            <span>Rating : </span>{" "}
                            {items.rating?.split(" - ")[0]}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })
              : ""}
          </div>
          <button>Login</button>
        </div>
        <div className="mob-menu">
          <div className="menu-btn" onClick={handleMenu}>
            {isClick ? <IoIosClose /> : <IoIosMenu />}
          </div>
          <ul className={isClick ? "menu-list" : "dis-none"}>
            <li>Home</li>
            <li>Catalog</li>
            <li>Collections</li>
            <input
              type="search"
              name="search"
              id="search"
              placeholder="Search"
            />
            <button>Login</button>
          </ul>
        </div>
      </section>
    </nav>
  );
};

export default Navbar;
