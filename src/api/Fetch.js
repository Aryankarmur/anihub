const BASE_URL = "https://graphql.anilist.co";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// To handle deduplication
const pendingRequests = new Map();

// Helper to get from local storage
const getFromCache = (key) => {
  try {
    const item = localStorage.getItem(`anilist:${key}`);
    if (item) {
      const parsed = JSON.parse(item);
      if (Date.now() - parsed.t < CACHE_TTL_MS) {
        return parsed.d;
      }
    }
  } catch (e) {}
  return null;
};

const saveToCache = (key, data) => {
  try {
    localStorage.setItem(
      `anilist:${key}`,
      JSON.stringify({ t: Date.now(), d: data })
    );
  } catch (e) {}
};

export const fetchAniList = async (query, variables = {}) => {
  const cacheKey = btoa(query + JSON.stringify(variables));

  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }

  const requestPromise = (async () => {
    try {
      const response = await fetch(BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });

      const json = await response.json();

      if (!response.ok || json.errors) {
        throw new Error(json.errors?.[0]?.message || "AniList GraphQL Error");
      }

      saveToCache(cacheKey, json.data);
      return json.data;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  })();

  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
};

// Backwards compatibility layer for Jikan endpoints
export const fetchJikan = async (path, options = {}) => {
  // If it's a search
  if (path === "anime" && options.params?.q) {
    const query = `
      query($search: String) {
        Page(perPage: 20) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title { romaji english }
            coverImage { extraLarge }
            averageScore
            genres
            seasonYear
          }
        }
      }
    `;
    const data = await fetchAniList(query, { search: options.params.q });
    return {
      data: data.Page.media.map((item) => ({
        mal_id: item.id,
        title: item.title.english || item.title.romaji,
        title_english: item.title.english,
        images: { webp: { large_image_url: item.coverImage.extraLarge } },
        score: item.averageScore ? item.averageScore / 10 : null,
        year: item.seasonYear,
        genres: item.genres.map((g) => ({ name: g })),
      })),
    };
  }
  
  if (path === "anime" && !options.params?.q) {
    const genres = options.params?.genres ? options.params.genres.split(",") : null;
    const page = options.params?.page || 1;
    const perPage = options.params?.limit || 24;

    const query = `
      query($genres: [String], $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(genre_in: $genres, type: ANIME, sort: POPULARITY_DESC) {
            id
            title { romaji english }
            coverImage { extraLarge }
            averageScore
            genres
            seasonYear
          }
        }
      }
    `;
    
    let variables = { page, perPage };
    if (genres) variables.genres = genres;

    const data = await fetchAniList(query, variables);
    return {
      data: data.Page.media.map((item) => ({
        mal_id: item.id,
        title: item.title.english || item.title.romaji,
        title_english: item.title.english,
        images: { webp: { large_image_url: item.coverImage.extraLarge } },
        score: item.averageScore ? item.averageScore / 10 : null,
        year: item.seasonYear,
        genres: item.genres.map((g) => ({ name: g })),
      })),
    };
  }

  // Slider requests seasons/now directly
  if (path === "/seasons/now") {
    const data = await getAnime("seasons/now");
    return { data };
  }

  // Catalogs logic
  if (path === "genres/anime") {
     const query = `query { GenreCollection }`;
     const data = await fetchAniList(query);
     return {
       data: data.GenreCollection.filter(g => g).map((g, idx) => ({ mal_id: g, name: g }))
     };
  }
  
  if (path === "producers") {
      return { data: [] }; // Mock for producers as it's not strictly needed for UI visually
  }

  throw new Error("Jikan endpoint not mocked: " + path);
};

export const getAnime = async (animepath, options = {}) => {
  let query = "";
  let variables = {};

  if (animepath.includes("filter=airing")) {
    query = `query { Page(perPage: 20) { media(type: ANIME, status: RELEASING, sort: SCORE_DESC) { id seasonYear genres title { romaji english } coverImage { extraLarge } } } }`;
  } else if (animepath.includes("seasons/now")) {
    query = `query { Page(perPage: 20) { media(type: ANIME, status: RELEASING, sort: TRENDING_DESC) { id seasonYear genres title { romaji english } coverImage { extraLarge } } } }`;
  } else if (animepath.includes("seasons/upcoming")) {
    query = `query { Page(perPage: 20) { media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC) { id seasonYear genres title { romaji english } coverImage { extraLarge } } } }`;
  } else if (animepath.includes("filter=bypopularity")) {
    query = `query { Page(perPage: 20) { media(type: ANIME, sort: POPULARITY_DESC) { id seasonYear genres title { romaji english } coverImage { extraLarge } } } }`;
  } else if (animepath.includes("recommendations")) {
    query = `query { Page(perPage: 20) { media(type: ANIME, sort: TRENDING_DESC) { id seasonYear genres title { romaji english } coverImage { extraLarge } } } }`;
  }

  if (!query) return [];

  try {
    const data = await fetchAniList(query, variables);
    return data.Page.media.map((item) => ({
      mal_id: item.id,
      title: item.title.english || item.title.romaji,
      title_english: item.title.english,
      large_image_url: item.coverImage.extraLarge,
      images: { webp: { large_image_url: item.coverImage.extraLarge } },
      year: item.seasonYear,
      genres: item.genres?.map((g) => ({ name: g })) || [],
    }));
  } catch (error) {
    console.warn("Anime fetch failed:", error.message);
    return [];
  }
};

export const fetchAniListCatalog = async (variables = {}) => {
  const query = `
    query Catalog(
      $page: Int
      $perPage: Int
      $genres: [String]
      $season: MediaSeason
      $seasonYear: Int
      $format: MediaFormat
      $status: MediaStatus
      $sort: [MediaSort]
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          currentPage
          lastPage
          hasNextPage
          total
        }
        media(
          type: ANIME
          genre_in: $genres
          season: $season
          seasonYear: $seasonYear
          format: $format
          status: $status
          sort: $sort
        ) {
          id
          title { romaji english }
          coverImage { extraLarge }
          averageScore
          genres
          seasonYear
          episodes
        }
      }
    }
  `;

  try {
    const data = await fetchAniList(query, variables);
    return {
      pageInfo: data.Page.pageInfo,
      data: data.Page.media.map((item) => ({
        mal_id: item.id,
        title: item.title.english || item.title.romaji,
        title_english: item.title.english,
        large_image_url: item.coverImage.extraLarge,
        images: { webp: { large_image_url: item.coverImage.extraLarge } },
        score: item.averageScore ? item.averageScore / 10 : null,
        year: item.seasonYear,
        episodes: item.episodes,
        genres: item.genres?.map((g) => ({ name: g })) || [],
      })),
    };
  } catch (error) {
    console.warn("Catalog fetch failed:", error.message);
    return { pageInfo: { lastPage: 1 }, data: [] };
  }
};
