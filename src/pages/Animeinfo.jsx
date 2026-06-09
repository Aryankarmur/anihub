import { Link, NavLink, Outlet, useOutletContext } from "react-router-dom";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { FaRegStar } from "react-icons/fa6";
import { IoBookmarkOutline } from "react-icons/io5";
import "../assets/css/Animeinfo.css";
import Card from "../component/Card";

const Animeinfo = () => {
  const { id } = useParams();
  // const id = 21;

  const [animefulldata, setAnimefulldata] = useState(null);
  const [animedata_error, setAnimedata_error] = useState("");

  const [relationdata, setRelationdata] = useState(null);
  const [relat_error, setRelat_error] = useState("");

  const [characters, setCharacters] = useState(null);
  const [char_error, setChar_error] = useState("");

  const [staff, setStaff] = useState(null);
  const [staff_error, setStaff_error] = useState("");

  const [recommend, setRecommend] = useState(null);
  const [recommend_error, setRecommend_error] = useState("");

  useEffect(() => {
    const fetchAnime = async () => {
      // ====== full anime details api fetch ======
      try {
        const resp = await fetch(`https://api.jikan.moe/v4/anime/${id}/full`);
        if (resp.status !== 200) {
          throw new Error(" Not responding ", res.status);
        }
        const data = await resp.json();
        setAnimefulldata(data.data);
      } catch (error) {
        setAnimedata_error(error.message);
      }

      // ====== relations api fetch ======
      const relations = setTimeout(async () => {
        try {
          const relation_resp = await fetch(
            `https://api.jikan.moe/v4/anime/${id}/relations`,
          );

          if (relation_resp.status !== 200) {
            throw new Error("Sever not found");
          }

          const relation_data = await relation_resp.json();
          setRelationdata(relation_data.data);
        } catch (error) {
          setRelat_error(error.message);
        }
      }, 300);

      // ====== characters api ======
      const characters = setTimeout(() => {
        const fetchCharacters = async () => {
          try {
            const response = await fetch(
              `https://api.jikan.moe/v4/anime/${id}/characters`,
            );

            const data = await response.json();
            if (data.status === 500) {
              setCharacters(null);
              setChar_error("Jikan server error. Please try again later.");
            } else {
              setCharacters(data);
            }

            if (!response.ok) {
              throw new Error(`Error: ${response.status}`);
            }
          } catch (error) {
            setChar_error(error.message);
          }
        };
        fetchCharacters();
      }, 1100);

      // ====== staff api fetch ======
      const staff_timeout = setTimeout(async () => {
        try {
          const staff_res = await fetch(
            `https://api.jikan.moe/v4/anime/${id}/staff`,
          );

          if (staff_res.status !== 200) {
            throw new Error("Sever not found");
          }

          const staff_data = await staff_res.json();
          setStaff(staff_data.data);
        } catch (error) {
          setStaff_error(error.message);
        }
      }, 700);

      // ====== recommendations api fetch ======
      const recommend_timeout = setTimeout(async () => {
        try {
          const recommend_res = await fetch(
            `https://api.jikan.moe/v4/anime/${id}/recommendations`,
          );

          if (recommend_res.status !== 200) {
            throw new Error("Sever not found");
          }

          const recommend_data = await recommend_res.json();
          const recommendations = [
            ...new Map(
              recommend_data.data
                .filter(
                  (item) =>
                    item.entry?.images?.webp?.large_image_url !==
                    "https://cdn.myanimelist.net/images/icon-banned-youtube-rect.png",
                )
                .map((item) => [
                  item.entry?.mal_id,
                  {
                    mal_id: item.entry?.mal_id,
                    large_image_url: item.entry?.images?.webp?.large_image_url,
                    title: item.entry?.title,
                    title_english: item.entry?.title,
                  },
                ]),
            ).values(),
          ];

          setRecommend(recommendations);
        } catch (error) {
          setRecommend_error(error.message);
        }
      }, 1000);

      return () => {
        clearTimeout(relations);
        clearTimeout(characters);
        clearTimeout(recommend_timeout);
        clearTimeout(staff_timeout);
      };
    };

    fetchAnime();
  }, [id]);

 

  return (
    <>
      <section className="anime-info">
        {animefulldata ? (
          <>
            <div className="img-div">
              <div id="image">
                <img
                  src={animefulldata?.images?.webp?.large_image_url}
                  alt={`${animefulldata?.title}`}
                />
              </div>
            </div>
            <div className="info-div">
              <h2>{animefulldata?.title}</h2>
              <p>
                <FaRegStar /> {animefulldata?.score}
              </p>
              <div className="btns">
                <button id="watchltr">
                  {" "}
                  <IoBookmarkOutline /> Add to watch
                </button>
                <button id="tocollec">+ Add to Collection</button>
              </div>
            </div>
          </>
        ) : (
          <div className="load">
            {animedata_error ? <p>{animedata_error} </p> : <p>Loading .... </p>}
          </div>
        )}
      </section>
      <section className="anime-details">
        <nav>
          <ul>
            <li>
              <NavLink to="" end>
                Overview
              </NavLink>
            </li>
            <li>
              <NavLink to="relations">Relations</NavLink>
            </li>
            <li>
              <NavLink to="characters">Characters</NavLink>
            </li>
            <li>
              <NavLink to="staff">Staff</NavLink>
            </li>
          </ul>
        </nav>

        <Outlet
          context={{
            animefulldata,
            animedata_error,

            relationdata,
            relat_error,

            characters,
            char_error,

            staff,
            staff_error,

            recommend,
            recommend_error,
          }}
        />
      </section>
    </>
  );
};

export default Animeinfo;

export const Overview = () => {
  const { animefulldata, animedata_error, recommend, recommend_error } =
    useOutletContext();
  return (
    <>
      <div className="overview">
        {animefulldata ? (
          <>
            <div className="info">
              <table>
                <thead>
                  <tr>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Type</td>
                    <td>{animefulldata?.type}</td>
                  </tr>
                  <tr>
                    <td>Episodes</td>
                    <td>
                      {animefulldata?.episodes === null
                        ? "undefine"
                        : animefulldata?.episodes}
                    </td>
                  </tr>
                  <tr>
                    <td>Genres</td>
                    <td>
                      {animefulldata?.genres.map((g) => g.name).join(", ")}
                    </td>
                  </tr>
                  <tr>
                    <td>Aired</td>
                    <td>{animefulldata?.aired?.string}</td>
                  </tr>
                  <tr>
                    <td>Status</td>
                    <td>{animefulldata?.status}</td>
                  </tr>
                  <tr>
                    <td>Season</td>
                    <td>{`${animefulldata?.season} ${animefulldata?.year}`}</td>
                  </tr>
                  <tr>
                    <td>Studios</td>
                    <td>
                      {animefulldata?.studios.map((s) => s.name).join(", ")}
                    </td>
                  </tr>
                  <tr>
                    <td>Source</td>
                    <td>{animefulldata?.source}</td>
                  </tr>
                  <tr>
                    <td>Rating</td>
                    <td>{animefulldata?.rating?.split(" - ")[0]}</td>
                  </tr>
                  <tr>
                    <td>Duration</td>
                    <td>{animefulldata?.duration}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="desc">
              <h2>Description</h2>

              {animefulldata?.synopsis
                ?.split("\n\n")
                .map((paragraph, index) => (
                  <p key={index}>
                    {paragraph} <br />
                    <br />
                  </p>
                ))}

              <h2> Anime background</h2>
              <p>{animefulldata?.background}</p>
            </div>
          </>
        ) : (
          <div className="load">
            {animedata_error ? <p>{animedata_error} </p> : <p>Loading .... </p>}
          </div>
        )}
      </div>
      <Recommendations
        recommend_anime={recommend}
        recommend_error={recommend_error}
      />
    </>
  );
};

export const Relations = () => {
  const { relationdata, relat_error, recommend, recommend_error } =
    useOutletContext();

  return (
    <>
      <div className="relations_div">
        <dl>
          {relationdata ? (
            relationdata.map((item, index) => {
              return (
                <React.Fragment key={index}>
                  <dt className="list_title">{item.relation}</dt>

                  {item.entry.map((list) => {
                    return (
                      <dd key={list.mal_id} className="list_data">
                        {" "}
                        <Link to={`/anime/${list.mal_id}`}>
                          {list.name}
                        </Link>{" "}
                      </dd>
                    );
                  })}
                </React.Fragment>
              );
            })
          ) : (
            <div className="load">
              {relat_error ? <p>{relat_error} </p> : <p>Loading .... </p>}
            </div>
          )}
        </dl>
      </div>
      <Recommendations
        recommend_anime={recommend}
        recommend_error={recommend_error}
      />
    </>
  );
};

export const Characters = () => {
  const { characters, char_error } = useOutletContext();

  return (
    <div className="character-div">
      <h2>Anime Charecters</h2>
      <div className="char-cards">
        {characters ? (
          characters.data.map((char) => {
            return (
              <div className="charcard" key={char.character.mal_id}>
                <div className="char_img_div">
                  <img
                    src={char.character?.images?.webp?.image_url}
                    alt={`${char.character?.name} image`}
                    className=" anime-char"
                  />
                  <img
                    src={char.voice_actors[0]?.person?.images?.jpg?.image_url}
                    alt={`${char.voice_actors[0]?.person?.name} image`}
                    className="voice-char"
                  />
                </div>
                <div className="char-info">
                  <p className=" anime-char">{char.character?.name}</p>
                  <p className="anime-char"> {char?.role}</p>

                  <p className=" voice-char">
                    {char.voice_actors[0]?.person?.name}
                  </p>
                  <p className="voice-char"> Voice Actor</p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="load">
            {char_error ? <p>{char_error} </p> : <p>Loading .... </p>}
          </div>
        )}
      </div>
    </div>
  );
};

export const Staff = () => {
  const { staff, staff_error } = useOutletContext();
  return (
    <div className="staff-div">
      <h2>Staff</h2>
      <div className="staff-cards">
        {staff ? (
          staff.map((item) => {
            return (
              <div className="staff-card" key={item?.person?.mal_id}>
                <div className="card-img">
                  <img
                    src={item?.person?.images?.jpg?.image_url}
                    alt={`${item?.person?.name} image`}
                  />
                </div>
                <div className="staff-info">
                  <p className="name">
                    Name: <span> {item?.person?.name}</span>
                  </p>
                  <p className="posi">
                    Position:{" "}
                    <span>
                      {item?.positions?.map((p) => p).join(", ")}
                    </span>{" "}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="load">
            {staff_error ? <p>{staff_error} </p> : <p>Loading .... </p>}
          </div>
        )}
      </div>
    </div>
  );
};

export const Recommendations = ({ recommend_anime, recommend_error }) => {
  return (
    <div className="recommendation">
      <h2>Recommendation</h2>
      <div className="recommend-animes">
      {
  recommend_anime === null ? (
    <div className="load">
      <p>Loading....</p>
    </div>
  ) : recommend_error ? (
    <div className="load">
      <p className="error">{recommend_error}</p>
    </div>
  ) : recommend_anime.length > 0 ? (
    recommend_anime.map((anime) => (
      <Card animeInfo={anime} key={anime.mal_id} />
    ))
  ) : (
    <div className="load">
      <p>No Recommendation available!</p>
    </div>
  )
}
      </div>
    </div>
  );
};
