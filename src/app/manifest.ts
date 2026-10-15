import type { MetadataRoute } from "next";

// Web app manifest: name, colours and the Route N icons for "Add to Home screen".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ParaNaga · Know your ride in Naga City",
    short_name: "ParaNaga",
    description:
      "Where to wait, which jeepney to take, where to transfer and when to say Para! Step-by-step commuting in Naga City, Camarines Sur.",
    id: "/app",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f1e3d",
    theme_color: "#0f1e3d",
    lang: "en",
    categories: ["navigation", "travel"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
