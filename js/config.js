// Site configuration. Nothing here is secret: the Supabase anon key is meant to be public,
// and what it may do is limited by the row-level-security rules in supabase/schema.sql.
export const CONFIG = {
  // Leave both empty to run in "this device only" mode: bus-seen and fare reports are kept
  // in the browser and are not shared with other riders. Fill them in to go live.
  supabaseUrl: "",
  supabaseAnonKey: "",

  // Map tiles. The public OpenStreetMap server is fine for a trial but not for real traffic
  // (see https://operations.osmfoundation.org/policies/tiles/). Point this at a self-hosted
  // tile source before launch, e.g. "https://maps.example.org/tiles/{z}/{x}/{y}.png".
  // OpenStreetMap's public tile server: fine for a trial, against their policy at real traffic
  // (https://operations.osmfoundation.org/policies/tiles/). Point tileUrl at a self-hosted or paid
  // tile source (MapTiler, Stadia, Protomaps…) before launch. {s} and {r} are optional placeholders.
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  tileUrlDark: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  tileAttribution: "© OpenStreetMap contributors",
  tileAttributionUrl: "https://www.openstreetmap.org/copyright",

  // Contact / feedback address shown on the About page (optional).
  contact: "",
};
