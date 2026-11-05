import "@fontsource-variable/overpass";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Crewline: run your field crew like a transit line",
  description: "A live dispatch board for field teams, with a map, automatic arrival tracking, a customer link and an Expo field app. Demo with a made-up crew.",
};

export const viewport: Viewport = { themeColor: "#0e1412", width: "device-width", initialScale: 1 };

// Applies the saved theme before first paint, so dark mode doesn't flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("crewline-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-CA" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
