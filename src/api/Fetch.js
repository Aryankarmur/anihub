export const getAnime = async (animepath) => {
  if (!animepath) return [];

  try {
    const resp = await fetch(`https://api.jikan.moe/v4/${animepath}`);
    const result = await resp.json();

    if (animepath.includes("watch")) {
      return [
        ...new Map(
          result.data
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
          result.data
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
        result.data.map((item) => [
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
    console.log(error);
    return [];
  }
};
