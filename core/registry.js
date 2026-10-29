export const tracks = [
  { id: 1, title: "Shape of the Earth", blurb: "Find a place on the real Earth, before you draw a map." },
  { id: 2, title: "Light, cone, cylinder", blurb: "Make a flat map from the round globe." },
  { id: 3, title: "Distortion and choice", blurb: "See what each map gets wrong, and choose a map." },
  { id: 4, title: "Lines on the sphere", blurb: "Draw lines, edges and time zones on a round Earth." },
  { id: 5, title: "Grids on the globe", blurb: "Cut the Earth into cells and tiles that have names." },
  { id: 6, title: "The array is the map", blurb: "Keep a map as a grid of numbers in a file." },
  { id: 7, title: "Seen from above", blurb: "See the Earth from a hill, a camera or a satellite." },
];

const L = (id, title, track, order, mode, keywords) => ({
  id, title, track, order, mode, keywords,
  loader: () => import(`@/lessons/${id}.js`),
});

export const lessons = [
  L("start", "Course contents", 1, 0, "2d", ["start", "contents", "course", "lessons"]),
  L("graticule", "Latitude and longitude", 1, 1, "3d", ["graticule", "longitude", "latitude", "meridian"]),
  L("ellipsoid", "The shape of the Earth", 1, 2, "3d", ["flattening", "ellipsoid", "WGS84", "radius"]),
  L("geoid", "Sea level and the geoid", 1, 3, "3d", ["EGM96", "gravity", "sea level", "undulation"]),
  L("vertical-datums", "Measuring height", 1, 4, "2d", ["orthometric", "ellipsoidal", "chart datum", "height"]),
  L("datums-helmert", "Datums", 1, 5, "3d", ["datum", "Helmert", "transform", "ED50"]),
  L("geodesic-distance", "Measuring distance", 1, 6, "3d", ["geodesic", "great circle", "distance", "sphere"]),
  L("lon-lat-order", "Coordinate order", 1, 7, "2d", ["axis order", "longitude", "latitude", "GeoJSON"]),
  L("epsg-anatomy", "EPSG codes", 1, 8, "2d", ["EPSG", "CRS", "UTM", "projection parameters"]),
  L("north-three-ways", "True, grid and magnetic north", 1, 9, "2d", ["convergence", "declination", "compass", "north"]),

  L("light-and-plane", "Azimuthal maps", 2, 1, "3d", ["gnomonic", "stereographic", "orthographic", "azimuthal"]),
  L("compass-and-string", "Azimuthal maps by rule", 2, 2, "3d", ["equidistant", "equal-area", "azimuthal", "Lambert"]),
  L("cylinder-unroll", "Cylindrical maps", 2, 3, "3d", ["cylinder", "Mercator", "unroll", "seam"]),
  L("cone-unroll", "Conic maps", 2, 4, "3d", ["conic", "standard parallel", "Lambert", "sector"]),
  L("one-family", "Angles, area or distance", 2, 5, "2d", ["conformal", "equal-area", "equidistant", "family"]),
  L("turn-the-cylinder", "Transverse and oblique maps", 2, 6, "3d", ["transverse", "oblique", "cylinder", "aspect"]),
  L("no-light", "World maps from formulas", 2, 7, "2d", ["Mollweide", "Robinson", "pseudocylindrical", "morph"]),
  L("world-in-a-square", "A world map in a square", 2, 8, "both", ["Adams", "square", "conformal", "ocean"]),

  L("tissot", "Circles that tell the truth", 3, 1, "both", ["Tissot", "indicatrix", "distortion", "ellipse"]),
  L("scale-factor-field", "Scale is a number at every point", 3, 2, "2d", ["scale factor", "h", "k", "field"]),
  L("true-size", "Drag a country across the map", 3, 3, "2d", ["Mercator", "area", "drag", "true size"]),
  L("chooser", "Which projection?", 3, 4, "2d", ["choose", "decision", "property", "extent"]),
  L("stereographic-circles", "Circles stay circles", 3, 5, "both", ["stereographic", "circle", "conformal", "small circle"]),
  L("range-rings", "Distance from one point", 3, 6, "2d", ["azimuthal equidistant", "rings", "distance", "antipode"]),
  L("equirectangular-parallel", "Plate carrée is a choice", 3, 7, "2d", ["equirectangular", "plate carrée", "standard parallel", "aspect"]),
  L("compromise-maps", "Sharing the error", 3, 8, "2d", ["Robinson", "Winkel tripel", "Equal Earth", "compromise"]),
  L("interrupted", "Cut where it hurts least", 3, 9, "2d", ["interrupted", "Goode", "lobes", "gores"]),
  L("map-arguments", "Why people argue about maps", 3, 10, "2d", ["Mercator", "Gall-Peters", "Equal Earth", "Dymaxion"]),

  L("great-circle-vs-rhumb", "Straight depends on the map", 4, 1, "both", ["great circle", "rhumb", "loxodrome", "gnomonic"]),
  L("sphere-hull", "Hull, Delaunay, Voronoi", 4, 3, "3d", ["convex hull", "Delaunay", "Voronoi", "sphere"]),
  L("catastrophes", "The seam, the poles, the winding", 4, 4, "both", ["antimeridian", "seam", "pole", "winding"]),
  L("time-and-longitude", "The projection of time", 4, 5, "both", ["time zones", "terminator", "subsolar", "longitude"]),

  L("utm-zones", "Sixty cylinders", 5, 1, "3d", ["UTM", "zone", "transverse Mercator", "k0"]),
  L("mgrs-sentinel", "Letters for squares", 5, 2, "2d", ["MGRS", "Sentinel", "tile", "100 km square"]),
  L("regional-grid", "One grid for one region", 5, 3, "2d", ["Lambert conformal conic", "regional", "standard parallels", "grid"]),
  L("s2-cells", "A cube around the globe", 5, 4, "3d", ["S2", "cube", "Hilbert", "cell"]),
  L("h3-cells", "Hexagons from an icosahedron", 5, 5, "3d", ["H3", "hexagon", "icosahedron", "pentagon"]),
  L("geohash", "Letters by halving", 5, 6, "2d", ["geohash", "bits", "base32", "halving"]),
  L("web-tiles", "Web map tiles", 5, 7, "2d", ["tiles", "zoom", "quadkey", "Web Mercator"]),
  L("l3-bins", "Equal-area rows for the ocean", 5, 8, "3d", ["L3", "bins", "equal-area", "rows"]),
  L("polar-grids", "Grids for the poles", 5, 9, "2d", ["polar stereographic", "EPSG:3413", "EPSG:3031", "pole"]),
  L("dggs-compare", "Cells side by side", 5, 10, "2d", ["DGGS", "S2", "H3", "geohash"]),

  L("affine", "Six numbers place every pixel", 6, 1, "2d", ["affine", "geotransform", "pixel", "origin"]),
  L("pixel-area-or-point", "Half a pixel matters", 6, 2, "2d", ["pixel is area", "pixel is point", "half pixel", "registration"]),
  L("regular-in-what", "Regular in which coordinates?", 6, 3, "3d", ["geostationary", "scan angle", "regular grid", "satellite"]),
  L("model-grids", "Bent rectangles", 6, 4, "3d", ["rotated pole", "tripolar", "cubed sphere", "model grid"]),
  L("zarr-chunks", "Regular and rectilinear chunks", 6, 7, "2d", ["Zarr", "chunks", "rectilinear", "array"]),
  L("rasterize", "Centre in, or exact fraction", 6, 8, "2d", ["rasterize", "coverage", "all touched", "fraction"]),
  L("resampling", "Nearest, bilinear, cubic", 6, 9, "2d", ["resampling", "nearest", "bilinear", "cubic"]),
  L("nodata-masks", "Holes in the data", 6, 10, "2d", ["nodata", "mask", "clouds", "fill"]),
  L("band-math", "Numbers from two bands", 6, 11, "2d", ["NDVI", "bands", "index", "ratio"]),
  L("scale-and-resolution", "Pixels get smaller with latitude", 6, 12, "2d", ["resolution", "Web Mercator", "ground sample", "latitude"]),
  L("texture-uv", "What the GPU does with a map", 6, 13, "split", ["texture", "UV", "mesh", "GPU"]),

  L("viewshed-shadow", "What an eye can see", 7, 1, "3d", ["viewshed", "line of sight", "terrain", "shadow"]),
  L("orthorectify", "Relief displacement", 7, 2, "3d", ["orthorectify", "relief displacement", "camera", "DEM"]),
  L("orbit-ground-track", "Where the satellite goes", 7, 3, "3d", ["orbit", "ground track", "inclination", "period"]),
  L("sun-synchronous", "Always the same local time", 7, 4, "3d", ["sun-synchronous", "J2", "precession", "local time"]),
  L("pushbroom-whiskbroom", "How a sensor sweeps", 7, 5, "3d", ["pushbroom", "whiskbroom", "sensor", "swath"]),
];

const index = new Map();
for (const l of lessons) index.set(l.id, l);

export function byId(id) {
  return index.get(id) || null;
}

export function trackOf(lesson) {
  return tracks.find((t) => t.id === lesson.track) || { id: 0, title: "Demo", blurb: "" };
}

export function lessonsOfTrack(trackId) {
  return lessons.filter((l) => l.track === trackId).sort((a, b) => a.order - b.order);
}

export function neighbours(id) {
  const i = lessons.findIndex((l) => l.id === id);
  if (i < 0) return { prev: null, next: null, index: -1 };
  return { prev: lessons[i - 1] || null, next: lessons[i + 1] || null, index: i };
}

export const first = lessons[0];
