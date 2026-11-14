const VIDEO_URL = "https://cdn-wp.valio.fi/valio-wp-network/sites/2/2025/06/ValioAimo_MainFilm28s_1920x632_valioaimofi_edit_2025-06.mp4";

export function HeroVideo() {
  return (
    <video
      className="page-hero-video"
      src={VIDEO_URL}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
    />
  );
}
