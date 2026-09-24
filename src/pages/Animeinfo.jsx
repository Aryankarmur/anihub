import { Link, NavLink, Outlet, useOutletContext, useNavigate } from "react-router-dom";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { FaRegStar } from "react-icons/fa6";
import { IoBookmarkOutline } from "react-icons/io5";
import "../assets/css/Animeinfo.css";
import Card from "../component/Card";
import { fetchJikan } from "../api/Fetch";
import SkeletonCard from "../component/SkeletonCard";
import CollectionModal from "../component/CollectionModal";
import { useAuth } from "../context/AuthContext";
import { addToWatchlist, removeFromWatchlist, checkInWatchlist } from "../firebase/firestore";

const LoadingState = ({ message = "Loading..." }) => (
  <div className="load-state">
    <p>{message}</p>
  </div>
);

const AnimeInfoSkeleton = () => (
  <>
    <section className="anime-info" style={{ backgroundColor: "var(--bg-1)" }}>
      <div className="hero-overlay"></div>
      <div className="hero-content">
        <div className="img-div">
          <div className="skeleton-card" style={{ width: "100%", height: "100%", minHeight: "350px", margin: 0 }} />
        </div>
        <div className="info-div" style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
          <div className="skeleton-card" style={{ width: "60%", height: "48px", borderRadius: "8px" }} />
          <div className="meta-row" style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
            <div className="skeleton-card" style={{ width: "60px", height: "30px", borderRadius: "100px" }} />
            <div className="skeleton-card" style={{ width: "80px", height: "30px", borderRadius: "100px" }} />
            <div className="skeleton-card" style={{ width: "80px", height: "30px", borderRadius: "100px" }} />
            <div className="skeleton-card" style={{ width: "60px", height: "30px", borderRadius: "100px" }} />
          </div>
          <div className="btns" style={{ display: "flex", gap: "16px", marginTop: "16px" }}>
            <div className="skeleton-card" style={{ width: "140px", height: "45px", borderRadius: "8px" }} />
            <div className="skeleton-card" style={{ width: "160px", height: "45px", borderRadius: "8px" }} />
          </div>
        </div>
      </div>
    </section>
    
    <section className="anime-details">
      <nav>
        <ul style={{ display: "flex", gap: "30px", padding: "16px 0", borderBottom: "1px solid var(--border)", listStyle: "none" }}>
          <div className="skeleton-card" style={{ width: "80px", height: "24px", borderRadius: "4px" }} />
          <div className="skeleton-card" style={{ width: "80px", height: "24px", borderRadius: "4px" }} />
          <div className="skeleton-card" style={{ width: "80px", height: "24px", borderRadius: "4px" }} />
          <div className="skeleton-card" style={{ width: "80px", height: "24px", borderRadius: "4px" }} />
        </ul>
      </nav>
      
      <div className="overview" style={{ display: "flex", gap: "30px", marginTop: "30px" }}>
        <div className="info" style={{ flex: "0 0 250px" }}>
           <div className="skeleton-card" style={{ width: "100%", height: "400px", borderRadius: "8px" }} />
        </div>
        <div className="desc" style={{ flex: "1" }}>
           <div className="skeleton-card" style={{ width: "40%", height: "32px", marginBottom: "20px", borderRadius: "8px" }} />
           <div className="skeleton-card" style={{ width: "100%", height: "16px", marginBottom: "12px", borderRadius: "4px" }} />
           <div className="skeleton-card" style={{ width: "95%", height: "16px", marginBottom: "12px", borderRadius: "4px" }} />
           <div className="skeleton-card" style={{ width: "90%", height: "16px", marginBottom: "12px", borderRadius: "4px" }} />
           <div className="skeleton-card" style={{ width: "80%", height: "16px", marginBottom: "30px", borderRadius: "4px" }} />
           
           <div className="skeleton-card" style={{ width: "30%", height: "28px", marginBottom: "20px", borderRadius: "8px" }} />
           <div className="skeleton-card" style={{ width: "100%", height: "16px", marginBottom: "12px", borderRadius: "4px" }} />
           <div className="skeleton-card" style={{ width: "85%", height: "16px", marginBottom: "12px", borderRadius: "4px" }} />
        </div>
      </div>
    </section>
  </>
);

const Animeinfo = () => {
  const { id } = useParams();

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

  const navigate = useNavigate();
  const { currentUser } = useAuth();
  
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState("");
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchAnime = async () => {
      try {
        const query = `
          query($id: Int) {
            Media(id: $id, type: ANIME) {
              id
              title { romaji english }
              coverImage { extraLarge }
              bannerImage
              format
              episodes
              genres
              startDate { year month day }
              status
              season
              seasonYear
              studios(isMain: true) { nodes { name } }
              source
              averageScore
              duration
              description(asHtml: false)
              
              relations {
                edges {
                  relationType
                  node {
                    id
                    title { romaji english }
                    type
                  }
                }
              }
              
              characters(sort: ROLE, perPage: 15) {
                edges {
                  role
                  node {
                    id
                    name { full }
                    image { large }
                  }
                  voiceActors(language: JAPANESE) {
                    id
                    name { full }
                    image { large }
                  }
                }
              }
              
              staff(perPage: 15) {
                edges {
                  role
                  node {
                    id
                    name { full }
                    image { large }
                  }
                }
              }
              
              recommendations(perPage: 10, sort: RATING_DESC) {
                nodes {
                  mediaRecommendation {
                    id
                    title { romaji english }
                    coverImage { extraLarge }
                  }
                }
              }
            }
          }
        `;
        const { fetchAniList } = await import("../api/Fetch");
        const result = await fetchAniList(query, { id: parseInt(id) });
        const media = result.Media;

        if (!isMounted) return;

        setAnimefulldata({
          mal_id: media.id,
          title: media.title.english || media.title.romaji,
          images: { webp: { large_image_url: media.coverImage.extraLarge } },
          banner_image: media.bannerImage || media.coverImage.extraLarge,
          year: media.seasonYear,
          episodes: media.episodes,
          status: media.status,
          score: media.averageScore ? media.averageScore / 10 : null,
          type: media.format,
          genres: media.genres?.map(g => ({ name: g })) || [],
          aired: { string: media.startDate ? `${media.startDate.year}-${media.startDate.month}-${media.startDate.day}` : 'Unknown' },
          season: media.season,
          studios: media.studios?.nodes?.map(n => ({ name: n.name })) || [],
          source: media.source,
          duration: media.duration ? `${media.duration} min` : "Unknown",
          synopsis: media.description,
          background: ""
        });

        const groupedRelations = {};
        media.relations?.edges?.forEach(edge => {
            if (!edge.node) return;
            const relType = edge.relationType || "OTHER";
            if (!groupedRelations[relType]) groupedRelations[relType] = [];
            groupedRelations[relType].push({
                mal_id: edge.node.id,
                type: edge.node.type,
                name: edge.node.title?.english || edge.node.title?.romaji
            });
        });
        const mappedRelations = Object.keys(groupedRelations).map(k => ({
            relation: k.replace(/_/g, " "),
            entry: groupedRelations[k]
        }));
        setRelationdata(mappedRelations);
        
        setCharacters(media.characters?.edges?.map(edge => ({
            role: edge.role,
            character: {
                mal_id: edge.node?.id,
                name: edge.node?.name?.full,
                images: { webp: { image_url: edge.node?.image?.large } }
            },
            voice_actors: edge.voiceActors?.length > 0 ? [{
                person: {
                    mal_id: edge.voiceActors[0].id,
                    name: edge.voiceActors[0].name?.full,
                    images: { jpg: { image_url: edge.voiceActors[0].image?.large } }
                }
            }] : []
        })) || []);
        
        const rawStaff = media.staff?.edges?.map(edge => ({
            positions: [edge.role].filter(Boolean),
            person: {
                mal_id: edge.node?.id,
                name: edge.node?.name?.full,
                images: { jpg: { image_url: edge.node?.image?.large } }
            }
        })) || [];

        const uniqueStaffMap = new Map();
        rawStaff.forEach(item => {
            const key = item.person.mal_id || item.person.name;
            if (!key) return; // Skip invalid entries

            if (uniqueStaffMap.has(key)) {
                const existing = uniqueStaffMap.get(key);
                item.positions.forEach(pos => {
                    if (!existing.positions.includes(pos)) {
                        existing.positions.push(pos);
                    }
                });
            } else {
                uniqueStaffMap.set(key, item);
            }
        });

        setStaff(Array.from(uniqueStaffMap.values()));
        
        setRecommend(media.recommendations?.nodes?.filter(n => n.mediaRecommendation).map(n => ({
            mal_id: n.mediaRecommendation.id,
            title: n.mediaRecommendation.title?.english || n.mediaRecommendation.title?.romaji,
            title_english: n.mediaRecommendation.title?.english,
            large_image_url: n.mediaRecommendation.coverImage?.extraLarge,
            images: { webp: { large_image_url: n.mediaRecommendation.coverImage?.extraLarge } }
        })) || []);

      } catch (error) {
        if (isMounted) {
          setAnimedata_error(error.message || "Failed to load anime details.");
        }
      }
    };

    fetchAnime();

    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    let isMounted = true;
    const fetchWatchlistState = async () => {
      if (currentUser && animefulldata?.mal_id) {
        try {
          const { data, error } = await checkInWatchlist(currentUser.uid, animefulldata.mal_id);
          if (isMounted && data !== undefined) {
            setInWatchlist(data);
          }
        } catch (e) {
          console.error("Watchlist check error:", e);
        }
      } else if (!currentUser && isMounted) {
        setInWatchlist(false);
      }
    };
    fetchWatchlistState();
    return () => { isMounted = false; };
  }, [currentUser, animefulldata?.mal_id]);

  const handleWatchlistClick = async () => {
    if (!currentUser) {
      navigate("/login");
      return;
    }
    
    if (!animefulldata) return;

    setWatchlistLoading(true);
    setWatchlistError("");
    
    try {
      if (inWatchlist) {
        await removeFromWatchlist(currentUser.uid, animefulldata.mal_id);
        setInWatchlist(false);
      } else {
        const animeData = {
          animeId: animefulldata.mal_id,
          title: animefulldata.title,
          image: animefulldata.images?.webp?.large_image_url || animefulldata.banner_image || "",
          type: animefulldata.type,
          score: animefulldata.score
        };
        await addToWatchlist(currentUser.uid, animeData);
        setInWatchlist(true);
      }
    } catch (e) {
      setWatchlistError("Failed to update watchlist.");
      console.error(e);
    } finally {
      setWatchlistLoading(false);
    }
  };

  const handleCollectionClick = () => {
    if (!currentUser) {
      navigate("/login");
      return;
    }
    setIsCollectionModalOpen(true);
  };

  const formattedAnimeData = animefulldata ? {
    animeId: animefulldata.mal_id,
    title: animefulldata.title,
    image: animefulldata.images?.webp?.large_image_url || animefulldata.banner_image || "",
    type: animefulldata.type,
    score: animefulldata.score
  } : null;

  if (animedata_error && !animefulldata) {
    return (
      <div className="load-state error-state" style={{ marginTop: "100px", textAlign: "center" }}>
        <p>{animedata_error}</p>
      </div>
    );
  }

  if (!animefulldata) {
    return <AnimeInfoSkeleton />;
  }

  return (
    <>
      <section
        className="anime-info"
        style={{ backgroundImage: `url(${animefulldata.banner_image})` }}
      >
        <div className="hero-overlay"></div>
        <div className="hero-content">
          <div className="img-div">
            <img
              src={animefulldata.images?.webp?.large_image_url}
              alt={`${animefulldata.title}`}
            />
          </div>
          <div className="info-div">
            <h2>{animefulldata.title}</h2>
            <div className="meta-row">
              {animefulldata.year && <span className="meta-pill">{animefulldata.year}</span>}
              {animefulldata.episodes && <span className="meta-pill">{animefulldata.episodes} EPS</span>}
              {animefulldata.status && <span className="meta-pill">{animefulldata.status}</span>}
              {animefulldata.score && (
                <span className="meta-pill">
                  <FaRegStar /> {animefulldata.score}
                </span>
              )}
            </div>
            <div className="btns">
              <button 
                id="watchltr" 
                onClick={handleWatchlistClick}
                disabled={watchlistLoading}
                className={inWatchlist ? "saved" : ""}
              >
                {watchlistLoading ? "Loading..." : inWatchlist ? (
                  <><IoBookmarkOutline /> Added to Watchlist</>
                ) : (
                  <><IoBookmarkOutline /> Add to Watchlist</>
                )}
              </button>
              <button id="tocollec" onClick={handleCollectionClick}>+ Add to Collection</button>
            </div>
            {watchlistError && <p className="watchlist-error">{watchlistError}</p>}
          </div>
        </div>
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

      {formattedAnimeData && (
        <CollectionModal 
          isOpen={isCollectionModalOpen} 
          onClose={() => setIsCollectionModalOpen(false)} 
          user={currentUser} 
          animeData={formattedAnimeData} 
        />
      )}
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
                    <td>{animefulldata?.score ? `${animefulldata.score} / 10` : "N/A"}</td>
                  </tr>
                  <tr>
                    <td>Duration</td>
                    <td>{animefulldata?.duration}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="desc">
              {animefulldata?.synopsis && (
                <>
                  <h2>Description</h2>
                  <div className="desc-text" dangerouslySetInnerHTML={{ __html: animefulldata.synopsis }} />
                </>
              )}

              {animefulldata?.background && (
                <>
                  <h2 style={{ marginTop: "24px" }}>Anime background</h2>
                  <div className="desc-text" dangerouslySetInnerHTML={{ __html: animefulldata.background }} />
                </>
              )}
            </div>
          </>
        ) : (
          <div className="load-state block-state">
            {animedata_error ? (
              <p>{animedata_error}</p>
            ) : (
              <LoadingState message="Loading overview..." />
            )}
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
        {relationdata && relationdata.length > 0 ? (
          relationdata.map((item, index) => {
            return (
              <div className="relation-group" key={index}>
                <h3 className="list_title">{item.relation}</h3>
                <div className="relation-cards">
                  {item.entry.map((list) => (
                    <Link to={`/anime/${list.mal_id}`} key={list.mal_id} className="relation-card">
                      <p className="rel-type">{list.type}</p>
                      <p className="rel-name">{list.name}</p>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })
          ) : relat_error ? (
            <div className="load-state block-state">
              <p>{relat_error}</p>
            </div>
          ) : (
            <div className="relation-cards">
              {Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)}
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

export const Characters = () => {
  const { characters, char_error } = useOutletContext();

  return (
    <div className="character-div">
      <h2>Anime Characters</h2>
      <div className="char-cards">
        {characters && characters.length > 0 ? (
          characters.map((char) => {
            return (
              <div
                className="charcard"
                key={char.character?.mal_id || char?.character?.name}
              >
                <div className="char_img_div">
                  <img
                    src={
                      char.character?.images?.webp?.image_url ||
                      "https://cdn.myanimelist.net/images/questionmark_23.gif"
                    }
                    alt={`${char.character?.name || "Character"} image`}
                    className="anime-char"
                  />
                  <img
                    src={
                      char.voice_actors?.[0]?.person?.images?.jpg?.image_url ||
                      "https://cdn.myanimelist.net/images/questionmark_23.gif"
                    }
                    alt={`${char.voice_actors?.[0]?.person?.name || "Voice actor"} image`}
                    className="voice-char"
                  />
                </div>
                <div className="char-info">
                  <p className="anime-char">{char.character?.name}</p>
                  <p className="anime-char">{char?.role}</p>
                  <p className="voice-char">
                    {char.voice_actors?.[0]?.person?.name || "Voice Actor"}
                  </p>
                  <p className="voice-char">Voice Actor</p>
                </div>
              </div>
            );
          })
        ) : char_error ? (
          <div className="load-state block-state">
            <p>{char_error}</p>
          </div>
        ) : (
          Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)
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
        {staff && staff.length > 0 ? (
          staff.map((item, index) => {
            return (
              <div className="staff-card" key={item?.person?.mal_id || item?.person?.name || index}>
                <div className="card-img">
                  <img
                    src={item?.person?.images?.jpg?.image_url}
                    alt={`${item?.person?.name} image`}
                  />
                </div>
                <div className="staff-info">
                  <p className="name">{item?.person?.name}</p>
                  <p className="posi">{item?.positions?.join(" • ")}</p>
                </div>
              </div>
            );
          })
        ) : staff_error ? (
          <div className="load-state block-state">
            <p>{staff_error}</p>
          </div>
        ) : (
          Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)
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
        {recommend_anime === null ? (
          Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)
        ) : recommend_error ? (
          <div className="load-state block-state error-state">
            <p className="error">{recommend_error}</p>
          </div>
        ) : recommend_anime.length > 0 ? (
          recommend_anime.map((anime) => (
            <Card animeInfo={anime} key={anime.mal_id} />
          ))
        ) : (
          <div className="load-state block-state">
            <p>No recommendations available right now.</p>
          </div>
        )}
      </div>
    </div>
  );
};
