import { useEffect, useState } from "react";
import "../assets/css/Navbar.css";
import { IoIosMenu } from "react-icons/io";
import { IoIosClose } from "react-icons/io";

const Navbar = () => {
  const [isClick, setIsClick] = useState(false);
  const [scroll, setScroll] = useState(false);

  const handleMenu = () => {
    setIsClick(!isClick);
  };

  useEffect(() => {
    const handleScroll = () => {
      setScroll(window.scrollY > 50);
    };

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <nav>
      <section className={scroll? "scroll": ""}>
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
          <input type="search" name="search" id="search" placeholder="Search" />
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
