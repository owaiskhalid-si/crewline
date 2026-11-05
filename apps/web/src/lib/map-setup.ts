import { setWorkerUrl } from "maplibre-gl";

// Served from public/, by scripts/copy-map-worker.mjs. Import this before creating a map.
setWorkerUrl("/maplibre-gl-worker.mjs");
