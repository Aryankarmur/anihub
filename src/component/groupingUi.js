export const getAnimeId = (anime) => String(anime?.animeId ?? anime?.id ?? anime?.mal_id ?? "");

export const getAnimeTitle = (anime) => (
  anime?.title_english || anime?.title || "Untitled anime"
);

export const getAnimeImage = (anime) => (
  anime?.image || anime?.large_image_url || anime?.images?.jpg?.large_image_url || ""
);

export const toCardAnime = (anime) => ({
  mal_id: getAnimeId(anime),
  title: getAnimeTitle(anime),
  large_image_url: getAnimeImage(anime) || "/anihub.svg",
  score: anime?.score,
  episodes: anime?.type || anime?.episodes,
  year: anime?.year
});

export const getGroupId = (group) => String(group?.groupId ?? group?.id ?? "");

export const getGroupThumbnailMember = (group, members = []) => {
  const thumbnailId = String(group?.thumbnailAnimeId ?? "");
  return members.find((anime) => getAnimeId(anime) === thumbnailId) || members[0] || null;
};
