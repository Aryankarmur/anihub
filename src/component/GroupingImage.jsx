const FALLBACK_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 400'%3E%3Crect width='300' height='400' fill='%231c1c26'/%3E%3Cpath d='M104 136h92a16 16 0 0 1 16 16v96a16 16 0 0 1-16 16h-92a16 16 0 0 1-16-16v-96a16 16 0 0 1 16-16Zm0 16v76l25-28 20 21 25-31 22 25v-63h-92Zm64 22a12 12 0 1 0 0-24 12 12 0 0 0 0 24Z' fill='%236e6e7d'/%3E%3Ctext x='150' y='302' text-anchor='middle' fill='%23b8b8c4' font-family='Arial,sans-serif' font-size='18'%3ENo cover%3C/text%3E%3C/svg%3E";

const GroupingImage = ({ src, alt, className = "" }) => {
  const handleError = (event) => {
    if (event.currentTarget.dataset.fallbackApplied === "true") return;
    event.currentTarget.dataset.fallbackApplied = "true";
    event.currentTarget.src = FALLBACK_IMAGE;
  };

  return (
    <img
      className={className}
      src={src || FALLBACK_IMAGE}
      alt={alt}
      onError={handleError}
      data-fallback={!src ? "true" : "false"}
    />
  );
};

export default GroupingImage;
