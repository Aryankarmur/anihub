const BASE_URL = "https://api.jikan.moe/v4";
const CACHE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;
const requestCache = new Map();
const inFlightRequests = new Map();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildUrl = (path, params = {}) => {
  const url = new URL(
    path.startsWith("http") ? path : `${BASE_URL}/${path.replace(/^\/+/, "")}`,
  );

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
};

export const fetchJikan = async (path, options = {}) => {
  if (!path) {
    throw new Error("No Jikan path provided");
  }

  const cacheKey = options.cacheKey || buildUrl(path, options.params || {});
  const cached = requestCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < (options.ttl ?? CACHE_TTL_MS)) {
    return cached.data;
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const requestPromise = (async () => {
    let lastError;
    const maxRetries = options.retries ?? 1;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        options.timeout ?? DEFAULT_TIMEOUT_MS,
      );

      try {
        const response = await fetch(buildUrl(path, options.params || {}), {
          headers: {
            Accept: "application/json",
            "User-Agent": "Anihub/1.0",
            ...(options.headers || {}),
          },
          signal: controller.signal,
        });

        if (response.status === 429) {
          const retryAfter =
            Number(response.headers.get("retry-after")) || (attempt + 1) * 1100;

          if (attempt === maxRetries) {
            throw new Error(
              "Jikan is rate limiting requests. Please wait a moment and try again.",
            );
          }

          await wait(retryAfter + 250 * attempt);
          continue;
        }

        if (!response.ok) {
          if (response.status >= 500 && attempt < maxRetries) {
            await wait(600 * (attempt + 1));
            continue;
          }
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data = await response.json();
        requestCache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
      } catch (error) {
        lastError = error;

        if (error.name === "AbortError") {
          throw error;
        }

        if (
          attempt < maxRetries &&
          (error.message.includes("429") ||
            error.message.includes("rate limiting") ||
            error.message.includes("fetch") ||
            error.message.includes("504"))
        ) {
          await wait(700 * (attempt + 1));
          continue;
        }

        break;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new Error("Request failed");
  })();

  inFlightRequests.set(cacheKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
};

export const getAnime = async (animepath, options = {}) => {
  if (!animepath) return [];

  try {
    const result = await fetchJikan(animepath.replace(/^\/+/, ""), options);
    const data = Array.isArray(result?.data) ? result.data : [];

    if (animepath.includes("watch")) {
      return [
        ...new Map(
          data
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
      ].slice(0, 20);
    }

    if (animepath.includes("recommendations")) {
      return [
        ...new Map(
          data
            .filter(
              (item) =>
                item.entry[0]?.images?.webp?.large_image_url !==
                "https://cdn.myanimelist.net/images/icon-banned-youtube-rect.png",
            )
            .map((item) => [
              item.entry[0]?.mal_id,
              {
                mal_id: item.entry[0]?.mal_id,
                large_image_url: item.entry[0]?.images?.webp?.large_image_url,
                title: item.entry[0]?.title,
                title_english: item.entry[0]?.title,
              },
            ]),
        ).values(),
      ].slice(0, 20);
    }

    return [
      ...new Map(
        data.map((item) => [
          item.mal_id,
          {
            mal_id: item.mal_id,
            large_image_url: item.images?.webp?.large_image_url,
            title: item.title,
            title_english: item.title_english,
          },
        ]),
      ).values(),
    ].slice(0, 20);
  } catch (error) {
    console.warn("Anime fetch failed:", error.message);
    return [];
  }
};
