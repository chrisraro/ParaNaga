import type { MetadataRoute } from "next";

// Web app manifest: name, colours and the Lunad icons for "Add to Home screen".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lunad · Know your ride in Naga City",
    short_name: "Lunad",
    description:
      "Where to wait, which jeepney to take, where to transfer and when to say Para! Step-by-step commuting in Naga City, Camarines Sur.",
    id: "/app",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    // Landscape is supported (spec 6.6; the app gate follows the device, not the width).
    orientation: "any",
    background_color: "#0B6B52",
    theme_color: "#0B6B52",
    lang: "en",
    categories: ["navigation", "travel"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
