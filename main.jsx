/* VERSION 5.0 - Widget Architecture: Modern Dashboard with Hiking OS Vision */
import "./style.css";

const app = document.querySelector("#app");
app.innerHTML = `<h1>Loading…</h1>`;

// --------------------
// STATE
// --------------------
const state = {
  trailsIndex: [],
  currentTrailUrl: null,
  currentTrailData: null,
  currentStages: [],
  selectedStageIndex: 0,
  expandedStageIndex: null, // Track which stage detail is open

  // View management
  currentView: 'home', // 'home' | 'dashboard' | 'planner'
  selectedTrailId: null, // Which trail is selected for dashboard view

  // User's trails (saved trails with progress)
  userTrails: [], // Array of { id, jsonUrl, status: 'active'|'planned'|'completed', progress: { currentStage, completedStages[] }, addedAt }

  // Widget states
  widgetStates: {}, // { widgetId: { collapsed: bool, pinned: bool, order: number } }

  // Dashboard edit mode
  dashboardEditMode: false, // When true, show drag handles and hide buttons

  // Home view filter
  homeStatusFilter: '', // '' = all, or 'saved', 'wishlist', 'planned', 'active', 'completed'

  // mini planner
  targetPerDay: 22,
  planMode: "official", // "official" | "custom"
  isReversed: false, // Track direction
  startDate: null, // ISO date string or null
  restDays: {}, // Object: { stageIndex: numberOfRestDays }, e.g., { 3: 2, 7: 1 }

  // Partial trail selection
  startStage: null, // For official mode: stage index to start from (null = first stage)
  endStage: null, // For official mode: stage index to end at (null = last stage)
  startKm: null, // For custom mode: km to start from (null = 0)
  endKm: null, // For custom mode: km to end at (null = total)

  // Map-based selection for custom mode
  mapSelectionMode: false, // Toggle for clicking on map to select start/end
  mapSelectionStep: null, // 'start' or 'end' - which point we're selecting next
  startMarker: null, // L.marker for start point
  endMarker: null, // L.marker for end point

  // Custom stage endpoint adjustments
  // Format: { stageIndex: { endKm: number, reason: 'map'|'camping'|'hotel'|etc, poiLabel?: string } }
  customStageAdjustments: {},
  editingStageIndex: null, // Which stage endpoint is being edited

  // Route stops (waypoints to visit along the route)
  // Format: { stageIndex: [ { lat, lon, name, type, km, detourRoute, detourFromTrailPoint } ] }
  routeStops: {},

  // POI search settings
  maxPoiDistanceKm: 0.5, // Default: search within 0.5 km (close to route)

  // POI filter preferences (remember user's checkbox selections)
  inlinePoiFilterPrefs: ['camping', 'hotel', 'station', 'supermarket', 'water', 'bakery'], // Default enabled POI types

  // POI details cache (fetched from OSM Overpass API)
  poiDetailsCache: new Map(), // key: "lat,lon", value: { address, phone, website, etc. }

  // Map style preference
  mapStyle: 'osm', // 'osm' (OpenStreetMap) or 'topo' (OpenTopoMap)

  // Debug mode (press Ctrl+Shift+D to toggle)
  debugMode: false,

  isFullDetail: false,

  // GPX cache per trail json-url
  gpxCache: new Map(), // key: trailJsonUrl, value: { points, cumKm, totalKm, gpxUrl, waypoints } | null

  // Map instance (Leaflet)
  map: null,
  tileLayer: null, // Current tile layer (for switching between OSM/Topo)
  previewMap: null,
  fullTrackLayer: null,
  stageLayerGroup: L.layerGroup(), // For stage-specific layers
  poiLayerGroup: L.layerGroup(), // For POI markers

  // Modal map for selection
  modalMap: null,
  modalStartMarker: null,
  modalEndMarker: null,
  modalRouteLayer: null, // Layer group for route segments

  // Full map modal filter preferences
  fullMapModalFilters: {
    enabledTypes: ['camping', 'hotel', 'station'],
    maxDistance: 1500, // in meters
  },
};

// ============================================
// THEME MANAGER - ADDED BY CLAUDE
// ============================================
const ThemeManager = {
  init() {
    const savedTheme = localStorage.getItem('hike5_theme');
    const systemPreference = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const initialTheme = savedTheme || systemPreference;
    
    this.setTheme(initialTheme);
    
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('hike5_theme')) {
        this.setTheme(e.matches ? 'dark' : 'light');
      }
    });
  },
  
  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('hike5_theme', theme);
    
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'dark' ? '#0F1410' : '#F8FAF9');
    }
  },
  
  toggle() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    this.setTheme(newTheme);
    
    // Re-render to update icon
    if (typeof renderApp === 'function' && state.trailsIndex) {
      renderApp(state.trailsIndex);
    }
  },
  
  getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }
};

// lijst: streng (alleen echt nabij)
const WAYPOINT_LIST_KM = 1.2;

// detail: ruimer (toon "dichtstbijzijnde" als het verder is)
const WAYPOINT_DETAIL_MAX_KM = 5.0;

// --------------------
// DEBUG HELPER
// --------------------
function debug(...args) {
  if (state.debugMode) {
    console.log(...args);
  }
}

// Always log errors and warnings
function debugError(...args) {
  console.error(...args);
}

function debugWarn(...args) {
  console.warn(...args);
}

// --------------------
// LOCALSTORAGE HELPERS
// --------------------
const STORAGE_KEYS = {
  MAP_STYLE: 'hike5_mapStyle',
  POI_FILTERS: 'hike5_poiFilters',
  MAX_POI_DISTANCE: 'hike5_maxPoiDistance',
  DEBUG_MODE: 'hike5_debugMode',
  TARGET_PER_DAY: 'hike5_targetPerDay',
  USER_TRAILS: 'hike5_userTrails',
  WIDGET_STATES: 'hike5_widgetStates',
};

function savePreferences() {
  try {
    localStorage.setItem(STORAGE_KEYS.MAP_STYLE, state.mapStyle);
    localStorage.setItem(STORAGE_KEYS.POI_FILTERS, JSON.stringify(state.inlinePoiFilterPrefs));
    localStorage.setItem(STORAGE_KEYS.MAX_POI_DISTANCE, state.maxPoiDistanceKm.toString());
    localStorage.setItem(STORAGE_KEYS.DEBUG_MODE, state.debugMode.toString());
    localStorage.setItem(STORAGE_KEYS.TARGET_PER_DAY, state.targetPerDay.toString());
    localStorage.setItem(STORAGE_KEYS.USER_TRAILS, JSON.stringify(state.userTrails));
    localStorage.setItem(STORAGE_KEYS.WIDGET_STATES, JSON.stringify(state.widgetStates));
  } catch (e) {
    debugError('Failed to save preferences:', e);
  }
}

function loadPreferences() {
  try {
    const mapStyle = localStorage.getItem(STORAGE_KEYS.MAP_STYLE);
    if (mapStyle) state.mapStyle = mapStyle;

    const poiFilters = localStorage.getItem(STORAGE_KEYS.POI_FILTERS);
    if (poiFilters) state.inlinePoiFilterPrefs = JSON.parse(poiFilters);

    const maxPoiDistance = localStorage.getItem(STORAGE_KEYS.MAX_POI_DISTANCE);
    if (maxPoiDistance) state.maxPoiDistanceKm = parseFloat(maxPoiDistance);

    const debugMode = localStorage.getItem(STORAGE_KEYS.DEBUG_MODE);
    if (debugMode) state.debugMode = debugMode === 'true';

    const targetPerDay = localStorage.getItem(STORAGE_KEYS.TARGET_PER_DAY);
    if (targetPerDay) state.targetPerDay = parseInt(targetPerDay);

    const userTrails = localStorage.getItem(STORAGE_KEYS.USER_TRAILS);
    if (userTrails) state.userTrails = JSON.parse(userTrails);

    // Migrate: add journal property to existing userTrails
    state.userTrails.forEach(trail => {
      if (!trail.journal) {
        trail.journal = { entries: [] };
      }
    });

    const widgetStates = localStorage.getItem(STORAGE_KEYS.WIDGET_STATES);
    if (widgetStates) {
      state.widgetStates = JSON.parse(widgetStates);

      // Migrate: add journal widget to existing layouts
      Object.keys(state.widgetStates).forEach(key => {
        if (key.endsWith('_layout')) {
          const layout = state.widgetStates[key];
          const allWidgets = [...(layout.column0 || []), ...(layout.column1 || []), ...(layout.column2 || [])];
          if (!allWidgets.includes('journal')) {
            layout.column1 = layout.column1 || [];
            layout.column1.push('journal');
          }
        }
      });
    }

    // Save migrated data
    savePreferences();
  } catch (e) {
    debugError('Failed to load preferences:', e);
  }
}

// --------------------
// LOADERS
// --------------------
async function loadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  return res.text();
}

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  return res.json();
}

async function loadTrailsIndex() {
  return loadJson("/data/trails/index.json");
}

// --------------------
// HELPERS
// --------------------
function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

function addDays(dateStr, days) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

function calculateDayDates(startDate, stages, restDays) {
  if (!startDate) return [];

  const dates = [];
  let currentDate = startDate;
  let dayCounter = 0;

  for (let i = 0; i < stages.length; i++) {
    dates.push({
      type: 'stage',
      index: i,
      date: currentDate,
      displayDate: formatDate(currentDate)
    });

    currentDate = addDays(currentDate, 1);
    dayCounter++;

    // Check if there are rest days after this stage
    const numRestDays = restDays[i] || 0;
    for (let r = 0; r < numRestDays; r++) {
      dates.push({
        type: 'rest',
        afterStageIndex: i,
        restDayNumber: r + 1, // 1st, 2nd, 3rd rest day, etc.
        date: currentDate,
        displayDate: formatDate(currentDate)
      });
      currentDate = addDays(currentDate, 1);
      dayCounter++;
    }
  }

  return dates;
}

// Country flags emoji mapping
const countryFlags = {
  'NL': '🇳🇱',
  'BE': '🇧🇪',
  'DE': '🇩🇪',
  'FR': '🇫🇷',
  'ES': '🇪🇸',
  'PT': '🇵🇹',
  'IT': '🇮🇹',
  'CH': '🇨🇭',
  'AT': '🇦🇹',
  'LU': '🇱🇺',
  'UK': '🇬🇧',
  'GB': '🇬🇧',
  'IE': '🇮🇪',
  'NO': '🇳🇴',
  'SE': '🇸🇪',
  'DK': '🇩🇰',
  'PL': '🇵🇱',
  'CZ': '🇨🇿',
};

// Country name to code mapping
const countryNameToCodes = {
  'netherlands': 'NL',
  'nederland': 'NL',
  'belgium': 'BE',
  'belgië': 'BE',
  'belgie': 'BE',
  'germany': 'DE',
  'duitsland': 'DE',
  'france': 'FR',
  'frankrijk': 'FR',
  'spain': 'ES',
  'spanje': 'ES',
  'portugal': 'PT',
  'italy': 'IT',
  'italië': 'IT',
  'italie': 'IT',
  'switzerland': 'CH',
  'zwitserland': 'CH',
  'austria': 'AT',
  'oostenrijk': 'AT',
  'united kingdom': 'GB',
  'uk': 'GB',
  'england': 'GB',
  'engeland': 'GB',
  'ireland': 'IE',
  'ierland': 'IE',
  'norway': 'NO',
  'noorwegen': 'NO',
  'sweden': 'SE',
  'zweden': 'SE',
  'denmark': 'DK',
  'denemarken': 'DK',
  'poland': 'PL',
  'polen': 'PL',
  'czech republic': 'CZ',
  'tsjechië': 'CZ',
  'tsjechie': 'CZ',
};

function normalizeCountryCode(country) {
  if (!country) return '';
  const clean = String(country).trim();

  // If already 2-letter code, return uppercase
  if (clean.length === 2) {
    return clean.toUpperCase();
  }

  // Try to convert full name to code
  const code = countryNameToCodes[clean.toLowerCase()];
  if (code) {
    return code;
  }

  // Fallback: first 2 letters uppercase
  return clean.toUpperCase().slice(0, 2);
}

function removeCountryCodeFromName(name, countries) {
  if (!name || !countries || !countries.length) return name;

  let cleanName = name;

  countries.forEach(country => {
    const code = normalizeCountryCode(country);
    const pattern = new RegExp(`^${code}\\s+`, 'i');
    cleanName = cleanName.replace(pattern, '');
  });

  return cleanName;
}

function getCountryFlags(countries) {
  if (!Array.isArray(countries) || !countries.length) return '';

  return countries
    .map(c => {
      const code = normalizeCountryCode(c);
      return countryFlags[code] || code;
    })
    .join(' ');
}

function seasonsToMonths(seasons) {
  if (!Array.isArray(seasons) || !seasons.length) return '';

  const seasonMap = {
    'Voorjaar': ['Mrt', 'Apr', 'Mei'],
    'Lente': ['Mrt', 'Apr', 'Mei'],
    'Spring': ['Mar', 'Apr', 'May'],
    'Zomer': ['Jun', 'Jul', 'Aug'],
    'Summer': ['Jun', 'Jul', 'Aug'],
    'Herfst': ['Sep', 'Okt', 'Nov'],
    'Autumn': ['Sep', 'Oct', 'Nov'],
    'Fall': ['Sep', 'Oct', 'Nov'],
    'Winter': ['Dec'],
  };

  const allMonths = [];
  seasons.forEach(season => {
    const months = seasonMap[season];
    if (months) {
      allMonths.push(...months);
    }
  });

  // Remove duplicates and get first/last
  const unique = [...new Set(allMonths)];
  if (unique.length === 0) return seasons.join(', ');
  if (unique.length === 1) return unique[0];

  return `${unique[0]}-${unique[unique.length - 1]}`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toNumber(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;

  const s = String(val)
    .replace(/[^0-9.,-]/g, "")
    .replace(",", ".")
    .trim();

  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function formatKm(val) {
  const n = toNumber(val);
  if (n === null) return String(val ?? "");
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Reverse geocode to get place name with caching and rate limiting
 */
const geocodeCache = new Map();
let lastGeocodeTime = 0;
const GEOCODE_DELAY = 1100; // Nominatim requires 1 request per second

async function getPlaceName(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;

  // Check cache first
  if (geocodeCache.has(key)) {
    return geocodeCache.get(key);
  }

  try {
    // Rate limiting: wait if needed
    const now = Date.now();
    const timeSinceLastCall = now - lastGeocodeTime;
    if (timeSinceLastCall < GEOCODE_DELAY) {
      await new Promise(resolve => setTimeout(resolve, GEOCODE_DELAY - timeSinceLastCall));
    }
    lastGeocodeTime = Date.now();

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'Hike5-BYO-Planner/1.0' // Required by Nominatim usage policy
        }
      }
    );

    if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);

    const data = await res.json();

    // Prioriteer stad/dorp, fallback op hamlet/suburb/village
    const place = 
      data.address?.city ||
      data.address?.town ||
      data.address?.village ||
      data.address?.hamlet ||
      data.address?.suburb ||
      data.address?.municipality ||
      null;

    // Cache result
    geocodeCache.set(key, place);
    return place;
  } catch (err) {
    console.warn("Geocoding error:", err);
    geocodeCache.set(key, null); // Cache failures too
    return null;
  }
}

function sumStageKm(stages) {
  let sum = 0;
  let ok = false;
  for (const s of stages) {
    const n = toNumber(s?.km);
    if (n !== null) {
      sum += n;
      ok = true;
    }
  }
  return ok ? sum : null;
}

function renderErrorCard(title, err, extra = "") {
  const msg = err?.message ? err.message : String(err);
  return `
    <div class="basicDetail">
      <h2 class="detailTitle">${escapeHtml(title)}</h2>
      ${extra ? `<p class="desc">${escapeHtml(extra)}</p>` : ""}
      <details class="raw" open>
        <summary>Details</summary>
        <pre>${escapeHtml(msg)}</pre>
      </details>
    </div>
  `;
}

// --------------------
// GEO / GPX DISTANCE
// --------------------
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const toRad = d => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function findClosestPointIndex(points, lat, lon) {
  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < points.length; i++) {
    const d = haversineKm(points[i].lat, points[i].lon, lat, lon);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  return { index: bestIdx, distance: bestDist };
}

// --------------------
// ROUTING API (OSRM)
// --------------------

// --------------------
// DETOUR ROUTE CALCULATION
// --------------------

// Helper function to check if a detour route overlaps with the trail
// Call OSRM API to get walking route between two points
// Note: OSRM uses OpenStreetMap data and may prefer roads over footpaths
// This is a limitation of the free public OSRM server and the OSM data quality
async function getWalkingRoute(fromLat, fromLon, toLat, toLon) {
  try {
    // OSRM expects lon,lat format (not lat,lon!)
    // Use 'alternatives=true' to get multiple route options
    // Profile 'foot' allows footpaths, pedestrian areas, steps, etc.
    const url = `https://router.project-osrm.org/route/v1/foot/${fromLon},${fromLat};${toLon},${toLat}?geometries=geojson&overview=full&alternatives=true&steps=true`;

    console.log('🚶 Calling OSRM for walking route...');
    console.log(`From: ${fromLat}, ${fromLon} → To: ${toLat}, ${toLon}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`OSRM API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      console.error('OSRM response:', data);
      throw new Error('No route found');
    }

    // Use the first (shortest) route
    const route = data.routes[0];

    // Convert GeoJSON coordinates to our format (lat, lon)
    const coordinates = route.geometry.coordinates.map(coord => ({
      lat: coord[1],
      lon: coord[0]
    }));

    // Distance is in meters, convert to km
    const distanceKm = route.distance / 1000;

    console.log(`✅ OSRM route found: ${distanceKm.toFixed(2)} km with ${coordinates.length} points`);

    if (data.routes.length > 1) {
      console.log(`   (${data.routes.length} alternative routes available)`);
    }

    return {
      coordinates,
      distanceKm,
      durationSeconds: route.duration
    };
  } catch (error) {
    console.error('❌ OSRM routing error:', error);
    return null;
  }
}

function parseGpxXml(gpxText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(gpxText, "application/xml");
  if (xml.querySelector("parsererror")) {
    throw new Error("GPX parse error (invalid XML).");
  }
  return xml;
}

function parseGpxTrackPoints(xml) {
  let nodes = Array.from(xml.querySelectorAll("trkpt"));
  if (!nodes.length) nodes = Array.from(xml.querySelectorAll("rtept"));

  const points = [];
  for (const n of nodes) {
    const lat = toNumber(n.getAttribute("lat"));
    const lon = toNumber(n.getAttribute("lon"));
    if (lat === null || lon === null) continue;

    // Parse elevation if available
    const eleNode = n.querySelector("ele");
    const ele = eleNode ? toNumber(eleNode.textContent) : null;

    points.push({ lat, lon, ele });
  }
  return points;
}

function parseGpxWaypoints(xml) {
  const nodes = Array.from(xml.querySelectorAll("wpt"));
  const waypoints = [];

  for (const n of nodes) {
    const lat = toNumber(n.getAttribute("lat"));
    const lon = toNumber(n.getAttribute("lon"));
    if (lat === null || lon === null) continue;

    const name = (n.querySelector("name")?.textContent ?? "").trim();
    const desc = (n.querySelector("desc")?.textContent ?? "").trim();

    const label = name || desc || "Waypoint";
    waypoints.push({ lat, lon, label, name, desc });
  }

  return waypoints;
}

function buildCumulativeKm(points) {
  const cumKm = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      cumKm.push(0);
      points[i].distanceKm = 0; // ADD distanceKm to each point
      continue;
    }
    const a = points[i - 1];
    const b = points[i];
    total += haversineKm(a.lat, a.lon, b.lat, b.lon);
    cumKm.push(total);
    points[i].distanceKm = total; // ADD distanceKm to each point
  }
  return { cumKm, totalKm: total };
}

function findNearestIndexByKm(cumKm, targetKm) {
  let lo = 0;
  let hi = cumKm.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cumKm[mid] < targetKm) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  const prev = Math.max(0, i - 1);
  if (i === 0) return 0;
  if (i >= cumKm.length) return cumKm.length - 1;

  const d1 = Math.abs(cumKm[i] - targetKm);
  const d0 = Math.abs(cumKm[prev] - targetKm);
  return d0 <= d1 ? prev : i;
}

// --------------------
// ELEVATION PROFILE HELPER
// --------------------
function updateElevationProfilePOIs(idx, gpxProfile, selectedStage, enabledTypes, maxDistanceKm = null) {
  const canvasId = `elevationProfile-${idx}`;
  const canvas = document.getElementById(canvasId);
  if (!canvas || !gpxProfile || !gpxProfile.points) return;

  // Determine point indices for this stage
  let eleStartIdx = 0;
  let eleEndIdx = gpxProfile.points.length - 1;

  if (selectedStage.type === 'custom') {
    if (selectedStage.startIndex !== null && selectedStage.startIndex !== undefined) {
      eleStartIdx = selectedStage.startIndex;
    }
    if (selectedStage.endIndex !== null && selectedStage.endIndex !== undefined) {
      eleEndIdx = selectedStage.endIndex;
    }
  } else {
    // Official stage - find km range
    const allOfficialStages = state.currentTrailData?.stages ?? state.currentTrailData?.etappes ?? [];
    let stageStartKm = 0;
    let stageEndKm = 0;
    let cumulativeKm = 0;

    for (let i = 0; i < allOfficialStages.length; i++) {
      const stageKm = parseFloat(allOfficialStages[i]?.km ?? allOfficialStages[i]?.distance_km ?? 0);
      const isOurStage = (i + 1) === selectedStage.index || 
                         (allOfficialStages[i].from === selectedStage.from && 
                          allOfficialStages[i].to === selectedStage.to);
      if (isOurStage) {
        stageStartKm = cumulativeKm;
        stageEndKm = cumulativeKm + stageKm;
        break;
      }
      cumulativeKm += stageKm;
    }

    if (state.isReversed && gpxProfile.totalKm) {
      const temp = stageStartKm;
      stageStartKm = gpxProfile.totalKm - stageEndKm;
      stageEndKm = gpxProfile.totalKm - temp;
    }

    eleStartIdx = gpxProfile.points.findIndex(p => (p.distanceKm || 0) >= stageStartKm);
    eleEndIdx = gpxProfile.points.findIndex(p => (p.distanceKm || 0) >= stageEndKm);

    if (eleStartIdx === -1) eleStartIdx = 0;
    if (eleEndIdx === -1) eleEndIdx = gpxProfile.points.length - 1;
  }

  const eleStageStartKm = gpxProfile.points[eleStartIdx]?.distanceKm || 0;
  const eleStageEndKm = gpxProfile.points[eleEndIdx]?.distanceKm || 0;

  // Use provided maxDistance or get from state for this map
  const effectiveMaxDistance = maxDistanceKm !== null ? maxDistanceKm : (state[`inlinePoiDistance_${idx}`] || state.maxPoiDistanceKm);

  // Filter waypoints based on enabled types AND distance
  const stagePois = (gpxProfile.waypoints || []).filter(wp => {
    const wpKm = wp.km || wp.distanceKm;
    const wpType = (wp.type || '').toLowerCase();
    const wpDistanceToRoute = wp.distanceToRoute || 0; // in km

    return wpType !== 'plaats' && 
           wpKm >= eleStageStartKm && 
           wpKm <= eleStageEndKm &&
           enabledTypes.includes(wpType) &&
           wpDistanceToRoute <= effectiveMaxDistance;
  });

  // Add route stops (always show these)
  const routeStopsForElevation = (state.routeStops[idx] || []).map(stop => ({
    ...stop,
    km: stop.trailKm,
    distanceKm: stop.trailKm,
    isRouteStop: true
  }));

  const allPoisForProfile = [...stagePois, ...routeStopsForElevation];

  console.log(`Updating elevation profile with ${stagePois.length} POIs + ${routeStopsForElevation.length} route stops`);
  renderElevationProfile(canvasId, gpxProfile.points, eleStartIdx, eleEndIdx, allPoisForProfile);
}

// --------------------
// ELEVATION PROFILE
// --------------------

// POI colors for elevation profile
const poiColors = {
  'water': '#3498db',      // Blue
  'supermarket': '#e74c3c', // Red
  'restaurant': '#e67e22',  // Orange
  'picnic': '#27ae60',      // Green
  'cafe': '#9b59b6',        // Purple
  'camping': '#16a085',     // Teal
  'hotel': '#8e44ad',       // Violet
  'station': '#34495e',     // Dark grey
  'toilet': '#7f8c8d',      // Grey
  'parking': '#95a5a6',     // Light grey
  'viewpoint': '#f39c12',   // Gold
  'bakery': '#d35400',      // Dark orange
  'pharmacy': '#c0392b',    // Dark red
  'bench': '#1abc9c',       // Turquoise
  'default': '#bdc3c7'      // Silver
};

const poiLabels = {
  'water': '💧',
  'supermarket': '🛒',
  'restaurant': '🍽️',
  'picnic': '🧺',
  'cafe': '☕',
  'camping': '⛺',
  'hotel': '🏨',
  'station': '🚂',
  'toilet': '🚻',
  'parking': '🅿️',
  'viewpoint': '👁️',
  'bakery': '🥖',
  'pharmacy': '💊',
  'bench': '🪑'
};

function renderElevationProfile(canvasId, points, startIdx = 0, endIdx = null, pois = null) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !points || points.length < 2) return;

  // Get segment of points
  const segmentEnd = endIdx !== null ? Math.min(endIdx, points.length - 1) : points.length - 1;
  const segmentPoints = points.slice(startIdx, segmentEnd + 1);

  if (segmentPoints.length < 2) return;

  // Filter points with valid elevation
  const elePoints = segmentPoints.filter(p => p.ele !== null && p.ele !== undefined);

  // Get container and compute available size
  const container = canvas.parentElement;
  const containerRect = container.getBoundingClientRect();
  const style = window.getComputedStyle(container);
  const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);

  // Use container width minus padding, fallback to reasonable default
  const displayWidth = Math.max(300, containerRect.width - paddingX);
  const displayHeight = 160; // Height including space for POI icons

  // Set canvas internal resolution (for sharp rendering)
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(displayWidth * dpr);
  canvas.height = Math.round(displayHeight * dpr);

  // Set canvas CSS size to match
  canvas.style.width = displayWidth + 'px';
  canvas.style.height = displayHeight + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Use display dimensions for drawing
  const width = displayWidth;
  const height = displayHeight;

  if (elePoints.length < 2) {
    // No elevation data - show message
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#999';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Geen hoogtedata beschikbaar', width / 2, height / 2);
    return;
  }

  const padding = { top: 30, right: 20, bottom: 30, left: 50 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  // Calculate min/max elevation with padding
  const elevations = elePoints.map(p => p.ele);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);
  const actualRange = maxEle - minEle;

  // Minimum range of 50m to prevent flat terrain from looking exaggerated
  const minRange = 50;
  const eleRange = Math.max(actualRange, minRange);

  // Center the data if we're using minimum range
  let displayMin, displayMax;
  if (actualRange < minRange) {
    // Center the actual data in the display range
    const midPoint = (minEle + maxEle) / 2;
    displayMin = Math.max(0, midPoint - minRange / 2);
    displayMax = displayMin + minRange;
  } else {
    // Normal case - add 10% padding
    const elePadding = eleRange * 0.1;
    displayMin = Math.max(0, minEle - elePadding);
    displayMax = maxEle + elePadding;
  }
  const displayRange = displayMax - displayMin;

  // Get distance range
  const startKm = segmentPoints[0].distanceKm || 0;
  const endKm = segmentPoints[segmentPoints.length - 1].distanceKm || 0;
  const distanceRange = endKm - startKm || 1;

  // Clear canvas
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, width, height);

  // Draw grid lines
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;

  // Horizontal grid lines (elevation)
  const numHLines = 4;
  for (let i = 0; i <= numHLines; i++) {
    const y = padding.top + (graphHeight * i / numHLines);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    // Elevation label
    const ele = displayMax - (displayRange * i / numHLines);
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(ele)}m`, padding.left - 8, y + 4);
  }

  // Draw POI markers BEFORE the elevation line (so they're behind)
  if (pois && pois.length > 0) {
    // Filter POIs within this stage's km range
    const stagePois = pois.filter(poi => {
      const poiKm = poi.distanceKm || poi.km;
      return poiKm >= startKm && poiKm <= endKm;
    });

    // Group POIs by approximate position to avoid overlap
    const poiGroups = {};
    stagePois.forEach(poi => {
      const poiKm = poi.distanceKm || poi.km;
      const x = padding.left + ((poiKm - startKm) / distanceRange) * graphWidth;
      const groupKey = Math.round(x / 15) * 15; // Group within 15px
      if (!poiGroups[groupKey]) poiGroups[groupKey] = [];
      poiGroups[groupKey].push(poi);
    });

    // Draw POI lines and icons
    Object.values(poiGroups).forEach(group => {
      const poi = group[0]; // Use first POI for position
      const poiKm = poi.distanceKm || poi.km;
      const x = padding.left + ((poiKm - startKm) / distanceRange) * graphWidth;

      // Check if this is a route stop (added to route)
      const isRouteStop = group.some(p => p.isRouteStop);

      // Get color based on POI type
      const poiType = (poi.type || poi.category || 'default').toLowerCase();
      const color = isRouteStop ? '#27ae60' : (poiColors[poiType] || poiColors['default']);

      // Draw vertical line (thicker for route stops)
      ctx.strokeStyle = color;
      ctx.lineWidth = isRouteStop ? 3 : 2;
      ctx.globalAlpha = isRouteStop ? 0.9 : 0.6;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + graphHeight);
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Draw icon(s) at top
      ctx.font = isRouteStop ? 'bold 14px sans-serif' : '12px sans-serif';
      ctx.textAlign = 'center';

      // For route stops, draw a green circle background
      if (isRouteStop) {
        ctx.fillStyle = '#27ae60';
        ctx.beginPath();
        ctx.arc(x, padding.top - 10, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Show up to 3 icons if multiple POIs at same location
      const icons = group.slice(0, 3).map(p => {
        const t = (p.type || p.category || 'default').toLowerCase();
        return poiLabels[t] || '📍';
      });
      ctx.fillStyle = isRouteStop ? 'white' : 'black';
      ctx.fillText(icons.join(''), x, isRouteStop ? padding.top - 6 : padding.top - 8);
    });
  }

  // Draw elevation area (filled)
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top + graphHeight);

  for (let i = 0; i < elePoints.length; i++) {
    const p = elePoints[i];
    const km = (p.distanceKm || 0) - startKm;
    const x = padding.left + (km / distanceRange) * graphWidth;
    const y = padding.top + graphHeight - ((p.ele - displayMin) / displayRange) * graphHeight;
    ctx.lineTo(x, y);
  }

  // Close the path
  ctx.lineTo(padding.left + graphWidth, padding.top + graphHeight);
  ctx.closePath();

  // Fill with gradient
  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + graphHeight);
  gradient.addColorStop(0, 'rgba(91, 124, 153, 0.6)');
  gradient.addColorStop(1, 'rgba(91, 124, 153, 0.1)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw elevation line
  ctx.beginPath();
  for (let i = 0; i < elePoints.length; i++) {
    const p = elePoints[i];
    const km = (p.distanceKm || 0) - startKm;
    const x = padding.left + (km / distanceRange) * graphWidth;
    const y = padding.top + graphHeight - ((p.ele - displayMin) / displayRange) * graphHeight;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = '#5B7C99';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Distance labels on X-axis (relative to stage start, not absolute)
  ctx.fillStyle = '#666';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';

  const distanceSteps = Math.min(6, Math.ceil(distanceRange));
  for (let i = 0; i <= distanceSteps; i++) {
    const km = (distanceRange * i / distanceSteps);
    const x = padding.left + (km / distanceRange) * graphWidth;
    ctx.fillText(`${km.toFixed(1)}`, x, height - 8);
  }

  // Axis label
  ctx.fillStyle = '#333';
  ctx.font = '11px sans-serif';
  ctx.fillText('km', width - 12, height - 8);

  // Stats box (top left inside graph area)
  const totalClimb = calculateTotalClimb(elePoints);
  const totalDescent = calculateTotalDescent(elePoints);

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillRect(padding.left + 8, padding.top + 8, 100, 42);
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.strokeRect(padding.left + 8, padding.top + 8, 100, 42);

  ctx.fillStyle = '#2E7D32';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`↑ ${Math.round(totalClimb)}m`, padding.left + 14, padding.top + 24);

  ctx.fillStyle = '#C62828';
  ctx.fillText(`↓ ${Math.round(totalDescent)}m`, padding.left + 14, padding.top + 40);

  ctx.fillStyle = '#666';
  ctx.font = '10px sans-serif';
  ctx.fillText(`${Math.round(minEle)}-${Math.round(maxEle)}m`, padding.left + 60, padding.top + 32);

  console.log(`Elevation profile rendered: ${displayWidth}x${displayHeight}px, ${elePoints.length} points, ${pois ? pois.length : 0} POIs`);

  // Store base image for interactive overlay
  const baseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Store profile data for mouse interaction
  canvas.elevationData = {
    points: elePoints,
    padding,
    graphWidth,
    graphHeight,
    displayMin,
    displayRange,
    startKm,
    distanceRange,
    dpr,
    baseImageData
  };

  // Extract map index from canvas ID (elevationProfile-X)
  const mapIdx = canvasId.replace('elevationProfile-', '');

  // Remove old event listeners if they exist
  if (canvas._mouseMoveHandler) {
    canvas.removeEventListener('mousemove', canvas._mouseMoveHandler);
    canvas.removeEventListener('mouseleave', canvas._mouseLeaveHandler);
    canvas.removeEventListener('touchmove', canvas._touchMoveHandler);
    canvas.removeEventListener('touchend', canvas._mouseLeaveHandler);
  }

  // Mouse move handler
  canvas._mouseMoveHandler = function(e) {
    handleElevationHover(canvas, e, mapIdx);
  };

  // Mouse leave handler
  canvas._mouseLeaveHandler = function() {
    clearElevationHover(canvas, mapIdx);
  };

  // Touch move handler
  canvas._touchMoveHandler = function(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const fakeEvent = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      offsetX: touch.clientX - rect.left,
      offsetY: touch.clientY - rect.top
    };
    handleElevationHover(canvas, fakeEvent, mapIdx);
  };

  // Add event listeners
  canvas.addEventListener('mousemove', canvas._mouseMoveHandler);
  canvas.addEventListener('mouseleave', canvas._mouseLeaveHandler);
  canvas.addEventListener('touchmove', canvas._touchMoveHandler, { passive: false });
  canvas.addEventListener('touchend', canvas._mouseLeaveHandler);
}

// Handle hover on elevation profile
function handleElevationHover(canvas, e, mapIdx) {
  const data = canvas.elevationData;
  if (!data) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const mouseX = (e.clientX - rect.left) * scaleX / data.dpr;

  // Check if mouse is within graph area
  if (mouseX < data.padding.left || mouseX > data.padding.left + data.graphWidth) {
    clearElevationHover(canvas, mapIdx);
    return;
  }

  // Calculate which point we're hovering over
  const graphX = mouseX - data.padding.left;
  const km = data.startKm + (graphX / data.graphWidth) * data.distanceRange;

  // Find closest point
  let closestIdx = 0;
  let closestDist = Infinity;
  for (let i = 0; i < data.points.length; i++) {
    const pointKm = data.points[i].distanceKm || 0;
    const dist = Math.abs(pointKm - km);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  }

  const point = data.points[closestIdx];
  if (!point) return;

  // Calculate Y position on canvas
  const pointKm = (point.distanceKm || 0) - data.startKm;
  const x = data.padding.left + (pointKm / data.distanceRange) * data.graphWidth;
  const y = data.padding.top + data.graphHeight - ((point.ele - data.displayMin) / data.displayRange) * data.graphHeight;

  // Restore base image and draw cursor
  const ctx = canvas.getContext('2d');
  ctx.putImageData(data.baseImageData, 0, 0);
  ctx.scale(data.dpr, data.dpr);

  // Draw vertical line
  ctx.strokeStyle = 'rgba(231, 76, 60, 0.7)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, data.padding.top);
  ctx.lineTo(x, data.padding.top + data.graphHeight);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw circle at point
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw info tooltip (show relative km to stage start)
  const relativeKm = (point.distanceKm || 0) - data.startKm;
  const tooltipText = `${point.ele.toFixed(0)}m @ ${relativeKm.toFixed(1)}km`;
  ctx.font = 'bold 11px sans-serif';
  const textWidth = ctx.measureText(tooltipText).width;
  const tooltipX = Math.min(Math.max(x - textWidth/2 - 6, 5), canvas.width/data.dpr - textWidth - 17);
  const tooltipY = y - 25;

  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(tooltipX, tooltipY, textWidth + 12, 20);
  ctx.fillStyle = 'white';
  ctx.textAlign = 'left';
  ctx.fillText(tooltipText, tooltipX + 6, tooltipY + 14);

  // Reset scale
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Update marker on map
  const map = state[`inlineMap_${mapIdx}`];
  if (map && point.lat && point.lon) {
    // Remove old hover marker
    if (state[`hoverMarker_${mapIdx}`]) {
      map.removeLayer(state[`hoverMarker_${mapIdx}`]);
    }

    // Create pulsing marker
    const hoverIcon = L.divIcon({
      html: `<div style="
        width: 16px;
        height: 16px;
        background: #e74c3c;
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 0 10px rgba(231,76,60,0.8);
        animation: pulse 1s infinite;
      "></div>`,
      className: 'elevation-hover-marker',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    state[`hoverMarker_${mapIdx}`] = L.marker([point.lat, point.lon], { icon: hoverIcon }).addTo(map);
  }
}

// Clear hover effects
function clearElevationHover(canvas, mapIdx) {
  const data = canvas.elevationData;
  if (!data) return;

  // Restore base image
  const ctx = canvas.getContext('2d');
  ctx.putImageData(data.baseImageData, 0, 0);

  // Remove map marker
  const map = state[`inlineMap_${mapIdx}`];
  if (map && state[`hoverMarker_${mapIdx}`]) {
    map.removeLayer(state[`hoverMarker_${mapIdx}`]);
    state[`hoverMarker_${mapIdx}`] = null;
  }
}

function calculateTotalClimb(points) {
  let climb = 0;
  for (let i = 1; i < points.length; i++) {
    const diff = points[i].ele - points[i-1].ele;
    if (diff > 0) climb += diff;
  }
  return climb;
}

function calculateTotalDescent(points) {
  let descent = 0;
  for (let i = 1; i < points.length; i++) {
    const diff = points[i-1].ele - points[i].ele;
    if (diff > 0) descent += diff;
  }
  return descent;
}

// --------------------
// SMART WAYPOINT PICK
// --------------------
function waypointPenaltyKm(label) {
  const s = String(label || "").toLowerCase();

  const poiKeywords = [
    "kasteel",
    "camping",
    "hotel",
    "restaurant",
    "cafe",
    "bar",
    "water",
    "bron",
    "park",
    "uitzicht",
    "viewpoint",
    "station",
    "parkeer",
    "parking",
    "museum",
    "kerk",
    "kapel",
    "brug",
    "veer",
    "pont",
    "molen",
    "fort",
    "ruïne",
    "ruine"
  ];

  const placeKeywords = ["centrum", "centraal", "dorps", "dorp", "stad", "town", "village"];

  let penalty = 0;

  if (poiKeywords.some(k => s.includes(k))) penalty += 2.0;
  if (placeKeywords.some(k => s.includes(k))) penalty -= 0.7;

  if (s.length > 28) penalty += 0.5;

  return penalty;
}

function findBestWaypoint(waypoints, lat, lon) {
  if (!Array.isArray(waypoints) || !waypoints.length) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  let best = null;
  let bestScore = Infinity;

  for (const w of waypoints) {
    const d = haversineKm(lat, lon, w.lat, w.lon);
    const label = w.name || w.label || '';
    const penalty = waypointPenaltyKm(label);
    const score = d + penalty;

    if (score < bestScore) {
      bestScore = score;
      best = { ...w, distanceKm: d, score };
    }
  }

  return best;
}

// Find best waypoint that is a PLACE NAME (not a POI like hotel/camping)
function findBestPlaceWaypoint(waypoints, lat, lon) {
  if (!Array.isArray(waypoints) || !waypoints.length) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  // Define known POI types to exclude
  const poiTypes = ['camping', 'hotel', 'restaurant', 'supermarket', 'bakery', 'pharmacy', 'station', 'water', 'picnic', 'bench'];

  // Filter out POIs - only keep waypoints that are NOT one of the POI types
  const placeWaypoints = waypoints.filter(w => {
    if (!w.type) return true; // No type = place name
    const typeLC = w.type.toLowerCase();
    return !poiTypes.includes(typeLC); // Not a POI type = place name
  });

  if (placeWaypoints.length === 0) return null;

  let best = null;
  let bestScore = Infinity;

  for (const w of placeWaypoints) {
    const d = haversineKm(lat, lon, w.lat, w.lon);
    const label = w.name || w.label || '';
    const penalty = waypointPenaltyKm(label);
    const score = d + penalty;

    if (score < bestScore) {
      bestScore = score;
      best = { ...w, distanceKm: d, score };
    }
  }

  return best;
}

// --------------------
// GPX PROFILE (optional)
// --------------------
async function ensureGpxProfileForCurrentTrail(stageGpxUrl = null) {
  const trail = state.currentTrailData;
  const trailUrl = state.currentTrailUrl;
  if (!trail || !trailUrl) return null;

  // If stage-specific GPX, load that instead
  if (stageGpxUrl) {
    try {
      const gpxText = await loadText(stageGpxUrl);
      const xml = parseGpxXml(gpxText);
      let points = parseGpxTrackPoints(xml);
      if (points.length < 2) return null;

      // Reverse points if needed
      if (state.isReversed) {
        points = points.reverse();
      }

      const waypoints = parseGpxWaypoints(xml);
      const { cumKm, totalKm } = buildCumulativeKm(points);
      return { points, cumKm, totalKm, gpxUrl: stageGpxUrl, waypoints };
    } catch (err) {
      console.warn("Stage GPX load failed:", err);
      return null;
    }
  }

  // Fallback to full trail GPX
  const cacheKey = `${trailUrl}_${state.isReversed ? 'rev' : 'fwd'}`;
  if (state.gpxCache.has(cacheKey)) {
    return state.gpxCache.get(cacheKey);
  }

  let gpxUrl = trail?.gpx ?? trail?.gpxUrl ?? "";

  // Smart GPX detection: handle both flat and nested structures
  if (!gpxUrl && typeof trailUrl === "string" && trailUrl.endsWith(".json")) {
    // Try same directory as JSON file first
    gpxUrl = trailUrl.replace(/\.json$/i, ".gpx");

    // Also prepare fallback: check parent directory if in subfolder
    // e.g., /data/trails/pieterpad/pieterpad.json -> also try /data/trails/pieterpad.gpx
  }

  if (!gpxUrl) {
    state.gpxCache.set(cacheKey, null);
    return null;
  }

  try {
    const gpxText = await loadText(gpxUrl);
    const xml = parseGpxXml(gpxText);

    let points = parseGpxTrackPoints(xml);
    if (points.length < 2) {
      state.gpxCache.set(cacheKey, null);
      return null;
    }

    // Reverse points if needed
    if (state.isReversed) {
      points = points.reverse();
    }

    // Try to load external waypoints file first
    let waypoints = [];
    const waypointsUrl = trailUrl.replace(/\.json$/i, "-waypoints.json");
    try {
      const waypointsData = await loadJson(waypointsUrl);
      if (Array.isArray(waypointsData.waypoints)) {
        waypoints = waypointsData.waypoints.map(w => {
          // Calculate distance to route if we have points
          let distanceToRoute = 0;
          if (points && points.length > 0) {
            let minDist = Infinity;
            // Sample every 10th point for performance
            for (let i = 0; i < points.length; i += 10) {
              const d = haversineKm(w.lat, w.lon, points[i].lat, points[i].lon);
              if (d < minDist) minDist = d;
            }
            distanceToRoute = minDist;
          }

          return {
            lat: w.lat,
            lon: w.lon,
            label: w.name || w.label || "Waypoint",
            name: w.name || "",
            desc: w.description || w.desc || "",
            type: w.type || "",
            km: w.km || null,
            distanceToRoute: distanceToRoute
          };
        });
        console.log(`Loaded ${waypoints.length} waypoints from ${waypointsUrl} with distance calculations`);
      }
    } catch (err) {
      console.log(`No external waypoints file found at ${waypointsUrl}, using GPX waypoints`);
      waypoints = parseGpxWaypoints(xml);
    }

    const { cumKm, totalKm } = buildCumulativeKm(points);

    const profile = { points, cumKm, totalKm, gpxUrl, waypoints };
    state.gpxCache.set(cacheKey, profile);
    return profile;
  } catch (err) {
    console.warn("GPX load failed:", err);
    state.gpxCache.set(cacheKey, null);
    return null;
  }
}

// --------------------
// NORMALIZE DATA
// --------------------
function normalizeTrail(trail) {
  const countriesRaw = trail?.countries ?? "";
  const countries = Array.isArray(countriesRaw)
    ? countriesRaw
    : typeof countriesRaw === "string"
    ? countriesRaw.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  const seasonsRaw = trail?.seasons ?? trail?.season ?? "";
  const seasons = Array.isArray(seasonsRaw)
    ? seasonsRaw
    : typeof seasonsRaw === "string"
    ? seasonsRaw.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  const totalKm =
    trail?.distance_km ??
    trail?.distanceKm ??
    trail?.distance_km_total ??
    trail?.km ??
    "";

  const stageCountRaw =
    trail?.stageCount ??
    trail?.stages_count ??
    trail?.etappes_count ??
    trail?.etappes ??
    trail?.stages ??
    "";

  let stageCount = "";
  if (Array.isArray(stageCountRaw)) {
    stageCount = String(stageCountRaw.length);
  } else {
    const n = toNumber(stageCountRaw);
    if (n !== null) stageCount = String(n);
    else if (typeof stageCountRaw === "string") stageCount = stageCountRaw;
  }

  // Parse images array
  const imagesRaw = trail?.images ?? [];
  const images = Array.isArray(imagesRaw) ? imagesRaw : [];


  return {
    name: trail?.name ?? trail?.slug ?? "Trail",
    slug: trail?.slug ?? "",
    from: trail?.from ?? "",
    to: trail?.to ?? "",
    description: trail?.description ?? "",
    totalKm,
    stageCount,
    countries,
    seasons,
    images
  };
}

function extractStages(trail) {
  const raw =
    trail?.stages ??
    trail?.etappes ??
    trail?.stage_list ??
    trail?.stageList ??
    [];

  if (!Array.isArray(raw)) return [];

  const stages = raw.map((s, idx) => ({
    type: "official",
    index: idx + 1,
    from: s?.from ?? s?.start ?? "",
    to: s?.to ?? s?.end ?? "",
    km: s?.km ?? s?.distance_km ?? s?.distanceKm ?? "",
    gpx: s?.gpx ?? "", // Add support for per-stage GPX
    _raw: s
  }));

  // Reverse if needed
  if (state.isReversed) {
    return stages.reverse().map((s, idx) => ({
      ...s,
      index: idx + 1,
      from: s.to,
      to: s.from,
    }));
  }

  return stages;
}

function filterOfficialStages(stages) {
  if (!stages.length) return stages;

  const startIdx = state.startStage !== null ? state.startStage : 0;
  const endIdx = state.endStage !== null ? state.endStage : stages.length - 1;

  // Make sure startIdx <= endIdx
  if (startIdx > endIdx) return [];

  return stages.slice(startIdx, endIdx + 1);
}

// --------------------
// CUSTOM "X KM/DAY" STAGES + GPX snap + best/near waypoint
// --------------------
async function buildCustomStages(totalKmNum, targetPerDay, gpxProfile) {
  if (!Number.isFinite(totalKmNum) || totalKmNum <= 0) return [];
  const t = Math.max(1, Number(targetPerDay) || 1);

  // Apply km range filter
  const actualStartKm = state.startKm !== null && state.startKm >= 0 ? state.startKm : 0;
  const overallEndKm = state.endKm !== null && state.endKm > actualStartKm ? state.endKm : totalKmNum;

  // Calculate range length
  const rangeKm = overallEndKm - actualStartKm;
  if (rangeKm <= 0) return [];

  // Build stages with adjustments
  const out = [];
  let currentKm = actualStartKm;
  let stageIndex = 0;

  while (currentKm < overallEndKm && stageIndex < 100) { // Safety limit
    const targetEndKm = Math.min(overallEndKm, currentKm + t);

    // Check if this stage has an adjustment
    const adjustment = state.customStageAdjustments[stageIndex];
    let stageEndKm = adjustment ? adjustment.endKm : targetEndKm;

    // Make sure we don't go past the overall end
    stageEndKm = Math.min(stageEndKm, overallEndKm);

    // Calculate actual distance for this stage
    const stageDistance = stageEndKm - currentKm;

    // Skip stages that would be too short (less than 1 km)
    if (stageDistance < 1 && stageIndex > 0) {
      break;
    }

    const stage = {
      type: "custom",
      index: stageIndex + 1,
      from: `Dag ${stageIndex + 1}`,
      to: "",
      km: stageDistance,
      rangeStartKm: currentKm,
      rangeEndKm: stageEndKm,

      // GPX endpoint (optional)
      lat: null,
      lon: null,
      trackKm: null,
      trackPointIndex: null,

      // For map segment
      startIndex: null,
      endIndex: null,

      // list hint (only when truly near)
      nearLabel: null,
      nearDistanceKm: null,
      nearLat: null,
      nearLon: null,

      // detail fallback
      bestLabel: null,
      bestDistanceKm: null,
      bestLat: null,
      bestLon: null,

      // Locations for display
      fromLocation: null,
      toLocation: null,

      // Detour info (if POI is off-route)
      detourDistanceKm: 0,
      hasDetour: false,
    };

    // Snap to GPX if available
    if (gpxProfile?.points?.length && gpxProfile.cumKm?.length) {
      // Find GPX point for stage end
      const endIdx = gpxProfile.cumKm.findIndex(km => km >= stageEndKm);
      if (endIdx >= 0) {
        const endPoint = gpxProfile.points[endIdx];
        stage.lat = endPoint.lat;
        stage.lon = endPoint.lon;
        stage.trackKm = gpxProfile.cumKm[endIdx];
        stage.trackPointIndex = endIdx;
        stage.endIndex = endIdx;
      }

      // Find GPX point for stage start
      const startIdx = gpxProfile.cumKm.findIndex(km => km >= currentKm);
      if (startIdx >= 0) {
        stage.startIndex = startIdx;
      }

      // Get location name for endpoint
      if (adjustment && adjustment.poiLabel) {
        // Use POI label if available from adjustment
        stage.toLocation = adjustment.poiLabel;
        stage.nearLabel = adjustment.poiLabel;

        console.log(`Stage ${stageIndex} has adjustment:`, adjustment);
        console.log(`Original stageEndKm: ${stageEndKm.toFixed(1)} km`);

        // If there's a detour, set the stage endpoint to the detour starting point
        if (adjustment.detourFromTrailPoint && adjustment.detourFromTrailPoint.index !== undefined) {
          const detourStartIndex = adjustment.detourFromTrailPoint.index;
          const detourStartKm = gpxProfile.cumKm[detourStartIndex];

          console.log(`Detour starts at index ${detourStartIndex}, km ${detourStartKm.toFixed(1)}`);

          // Always use the detour point as the stage endpoint (can be before or after original endpoint)
          stage.endIndex = detourStartIndex;
          stage.lat = adjustment.detourFromTrailPoint.lat;
          stage.lon = adjustment.detourFromTrailPoint.lon;
          stage.trackKm = detourStartKm;

          // Recalculate stage distance based on actual trail distance to detour point
          stage.km = detourStartKm - currentKm;

          console.log(`🔴 Stage ${stageIndex} endpoint set to detour point at ${detourStartKm.toFixed(1)} km (original was ${stageEndKm.toFixed(1)} km)`);
          console.log(`   Stage distance: ${stage.km.toFixed(1)} km`);

          // Override stageEndKm for the next stage calculation
          stageEndKm = detourStartKm;
        } else {
          console.log(`⚠️ Stage ${stageIndex}: NO detour extension (no detourFromTrailPoint or index)`);
        }

        // Add detour info if available
        if (adjustment.detourDistanceKm) {
          stage.detourDistanceKm = adjustment.detourDistanceKm;
          stage.hasDetour = true;
        }

        // Add route stops detour distance
        const stopsForStage = state.routeStops[stageIndex] || [];
        if (stopsForStage.length > 0) {
          const stopsDetourKm = stopsForStage.reduce((sum, stop) => sum + (stop.totalDetourKm || 0), 0);
          stage.detourDistanceKm = (stage.detourDistanceKm || 0) + stopsDetourKm;
          stage.hasDetour = true;
          stage.routeStopsCount = stopsForStage.length;
        }
      } else if (stage.lat && stage.lon) {
        // Try to find a nearby PLACE NAME waypoint for the endpoint (not POI)
        const waypoints = gpxProfile.waypoints || [];
        const nearestWaypoint = findBestPlaceWaypoint(waypoints, stage.lat, stage.lon);
        const nearestDist = nearestWaypoint ? nearestWaypoint.distanceKm : Infinity;

        // Only use waypoint if it's reasonably close (within 2 km)
        if (nearestWaypoint && nearestDist < 2) {
          stage.nearLabel = nearestWaypoint.label;
          stage.nearDistanceKm = nearestDist;
          stage.nearLat = nearestWaypoint.lat;
          stage.nearLon = nearestWaypoint.lon;
          stage.toLocation = nearestWaypoint.label;
        } else {
          // Fallback: try reverse geocoding or use best available waypoint
          stage.bestLabel = nearestWaypoint?.label || null;
          stage.bestDistanceKm = nearestDist;
          stage.bestLat = nearestWaypoint?.lat || null;
          stage.bestLon = nearestWaypoint?.lon || null;
        }

        // Check for route stops even without endpoint adjustment
        const stopsForStage = state.routeStops[stageIndex] || [];
        if (stopsForStage.length > 0) {
          const stopsDetourKm = stopsForStage.reduce((sum, stop) => sum + (stop.totalDetourKm || 0), 0);
          stage.detourDistanceKm = (stage.detourDistanceKm || 0) + stopsDetourKm;
          stage.hasDetour = true;
          stage.routeStopsCount = stopsForStage.length;
        }
      }

      // Get location for start point (from previous stage or first point)
      if (stageIndex === 0 && stage.startIndex !== null) {
        // First stage - try to find PLACE NAME location for start (not POI)
        const startPoint = gpxProfile.points[stage.startIndex];
        const waypoints = gpxProfile.waypoints || [];
        const nearestWaypoint = findBestPlaceWaypoint(waypoints, startPoint.lat, startPoint.lon);
        const nearestDist = nearestWaypoint ? nearestWaypoint.distanceKm : Infinity;

        if (nearestWaypoint && nearestDist < 2) {
          stage.fromLocation = nearestWaypoint.label;
        }
      } else if (stageIndex > 0 && out.length > 0) {
        // Use previous stage's endpoint as this stage's start
        stage.fromLocation = out[out.length - 1].toLocation;
      }

      // Check if previous stage ended at a POI - if so, we need to return to trail
      if (stageIndex > 0 && out.length > 0) {
        const prevStageIdx = stageIndex - 1;
        const prevAdjustment = state.customStageAdjustments[prevStageIdx];

        if (prevAdjustment && prevAdjustment.detourRoute && prevAdjustment.poiLat && prevAdjustment.poiLon) {
          console.log(`🔙 Stage ${stageIndex} needs to return from POI at previous stage`);

          // The return route is the same as the detour route but in reverse
          // We already have it stored, just need to reverse the coordinates
          const returnRoute = {
            coordinates: [...prevAdjustment.detourRoute.coordinates].reverse(),
            distanceKm: prevAdjustment.detourRoute.distanceKm,
            durationSeconds: prevAdjustment.detourRoute.durationSeconds
          };

          // Add return route info to this stage
          stage.returnFromPOI = {
            poiLabel: prevAdjustment.poiLabel,
            poiLat: prevAdjustment.poiLat,
            poiLon: prevAdjustment.poiLon,
            returnRoute: returnRoute,
            returnDistanceKm: returnRoute.distanceKm,
            returnToTrailPoint: prevAdjustment.detourFromTrailPoint
          };

          // Update fromLocation to show we start at the POI
          stage.fromLocation = prevAdjustment.poiLabel;

          // Add return distance to this stage's total distance
          stage.km += returnRoute.distanceKm;

          console.log(`   Added ${returnRoute.distanceKm.toFixed(2)} km return route to stage ${stageIndex}`);
          console.log(`   Stage total distance: ${stage.km.toFixed(1)} km`);
        }
      }
    }

    out.push(stage);

    // Move to next stage
    // If this stage has a detour, start next stage from the detour point
    if (adjustment && adjustment.detourFromTrailPoint) {
      currentKm = gpxProfile.cumKm[adjustment.detourFromTrailPoint.index];
      console.log(`Next stage starts at ${currentKm.toFixed(1)} km (detour point)`);
    } else {
      currentKm = stageEndKm;
    }
    stageIndex++;
  }

  return out;
}

// --------------------
// MAP INTEGRATION (Leaflet + GPX)
// --------------------
function cleanupMap() {
  // Check if the map container still exists in DOM
  const mapEl = document.getElementById("trailMap");

  if (state.map && !mapEl) {
    // Container was removed, destroy the map completely
    state.map.remove();
    state.map = null;
    state.fullTrackLayer = null;
    state.stageLayerGroup = L.layerGroup();
    state.poiLayerGroup = L.layerGroup();
  } else if (state.map) {
    // Container exists, just clear the layers
    if (state.fullTrackLayer) {
      state.map.removeLayer(state.fullTrackLayer);
    }
    state.stageLayerGroup.clearLayers();
    state.poiLayerGroup.clearLayers();
    state.fullTrackLayer = null;
  }
}

// --------------------
// POI RENDERING HELPERS
// --------------------

// POI type styles
const POI_STYLES = {
  'camping': { color: '#2ecc71', icon: '⛺', label: 'Camping' },
  'hotel': { color: '#3498db', icon: '🏨', label: 'Hotel' },
  'restaurant': { color: '#e74c3c', icon: '🍽️', label: 'Restaurant' },
  'supermarket': { color: '#f39c12', icon: '🛒', label: 'Supermarkt' },
  'bakery': { color: '#e67e22', icon: '🥐', label: 'Bakkerij' },
  'pharmacy': { color: '#e91e63', icon: '💊', label: 'Apotheek' },
  'station': { color: '#9b59b6', icon: '🚂', label: 'Station' },
  'water': { color: '#00bcd4', icon: '💧', label: 'Water' },
  'picnic': { color: '#8bc34a', icon: '🧺', label: 'Picknick' },
  'bench': { color: '#795548', icon: '🪑', label: 'Bankje' },
  'cafe': { color: '#6f4e37', icon: '☕', label: 'Café' },
  'viewpoint': { color: '#00796b', icon: '👁️', label: 'Uitkijkpunt' },
};

// Helper to get POI style with fallback
function getPOIStyle(type) {
  return POI_STYLES[(type || '').toLowerCase()] || { color: '#666', icon: '📍', label: 'POI' };
}


function getEnabledPOITypes() {
  // Get enabled types from checkboxes if they exist
  const checkboxes = document.querySelectorAll('.poi-type-filter');
  if (checkboxes.length > 0) {
    const enabled = [];
    checkboxes.forEach(cb => {
      if (cb.checked) enabled.push(cb.value);
    });
    // Return whatever is checked, even if empty!
    return enabled;
  }
  // Only use default if no checkboxes exist at all
  return ['camping', 'hotel', 'station'];
}

function renderPOIMarkers(map, layerGroup, gpxProfile, enabledTypes = null, maxDistanceKm = null, stageIndex = null) {
  if (!gpxProfile?.waypoints?.length || !gpxProfile?.points?.length) return 0;

  const types = enabledTypes || getEnabledPOITypes();

  // Use provided maxDistance or fall back to state
  const maxDistance = maxDistanceKm !== null ? maxDistanceKm : state.maxPoiDistanceKm;

  // ALWAYS clear layers first, even if types is empty
  layerGroup.clearLayers();

  // If no types selected, we're done (markers are already cleared)
  if (types.length === 0) return 0;

  // Filter and enhance waypoints with distance info
  const filteredWaypoints = gpxProfile.waypoints
    .map(w => {
      if (!w.type || !types.includes(w.type.toLowerCase())) return null;

      // Calculate distance from POI to nearest point on route
      let minDist = Infinity;
      // Sample every 10th point for speed
      for (let i = 0; i < gpxProfile.points.length; i += 10) {
        const p = gpxProfile.points[i];
        const dist = haversineKm(w.lat, w.lon, p.lat, p.lon);
        if (dist < minDist) minDist = dist;
      }

      // Store distance in waypoint object
      const enhancedWaypoint = { ...w, distanceToRoute: minDist };

      // Special case: bench is always within 0.1km from scraper
      if (w.type.toLowerCase() === 'bench') {
        return minDist <= 0.1 ? enhancedWaypoint : null;
      }

      // Filter based on maxDistance
      return minDist <= maxDistance ? enhancedWaypoint : null;
    })
    .filter(w => w !== null);

  filteredWaypoints.forEach(w => {
    const name = w.name || w.label || 'POI';
    const style = getPOIStyle(w.type);

    // Calculate distance to route (already done in filter, so get from waypoint if available)
    let distanceToRoute = null;
    if (w.distanceToRoute !== undefined) {
      distanceToRoute = w.distanceToRoute;
    } else {
      // Recalculate if not available
      let minDist = Infinity;
      for (let i = 0; i < gpxProfile.points.length; i += 10) {
        const p = gpxProfile.points[i];
        const dist = haversineKm(w.lat, w.lon, p.lat, p.lon);
        if (dist < minDist) minDist = dist;
      }
      distanceToRoute = minDist;
    }

    // Create enhanced custom icon with shadow and border
    const customIcon = L.divIcon({
      html: `
        <div class="poi-marker-icon" style="
          background: linear-gradient(135deg, ${style.color}E6 0%, ${adjustColorBrightness(style.color, -20)}E6 100%);
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 2px solid white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          box-shadow: 
            0 2px 6px rgba(0,0,0,0.3), 
            0 1px 2px rgba(0,0,0,0.2);
          cursor: pointer;
          position: relative;
        ">${style.icon}</div>
      `,
      className: 'custom-poi-marker',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    // Build enhanced popup content with placeholder for details
    const distanceText = distanceToRoute !== null 
      ? `<div style="color: #666; font-size: 12px; margin-top: 4px;">📍 ${(distanceToRoute * 1000).toFixed(0)}m van route</div>`
      : '';

    let popupContent = `
      <div style="min-width: 200px;">
        <div style="
          display: flex;
          align-items: center;
          gap: 8px;
          padding-bottom: 8px;
          margin-bottom: 8px;
          border-bottom: 2px solid ${style.color};
        ">
          <span style="font-size: 24px;">${style.icon}</span>
          <div style="flex: 1;">
            <div style="font-weight: 700; font-size: 16px; color: #2c3e50;">${name}</div>
            <div style="
              display: inline-block;
              background: ${style.color};
              color: white;
              padding: 2px 8px;
              border-radius: 12px;
              font-size: 11px;
              font-weight: 600;
              margin-top: 4px;
            ">${style.label}</div>
          </div>
        </div>
        ${distanceText}
        <div class="poi-extra-details" style="margin-top: 8px;">
          <div style="color: #999; font-size: 12px; font-style: italic;">
            ⏳ Extra info ophalen...
          </div>
        </div>
      </div>
    `;

    // Add "End stage here" button for custom stages and endpoint POI types
    const isEndpointType = ['hotel', 'camping', 'station'].includes(w.type.toLowerCase());
    const isCustomStage = stageIndex !== null && state.currentStages?.[stageIndex]?.type === 'custom';

    if (isCustomStage && isEndpointType) {
      popupContent += `
        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e0e0;">
          <button 
            class="endStageHereBtn" 
            data-stage-idx="${stageIndex}"
            data-poi-lat="${w.lat}"
            data-poi-lon="${w.lon}"
            data-poi-type="${w.type}"
            data-poi-name="${escapeHtml(name)}"
            style="
              width: 100%;
              padding: 10px 16px;
              background: linear-gradient(135deg, #5B7C99 0%, #4A6B88 100%);
              color: white;
              border: none;
              border-radius: 8px;
              cursor: pointer;
              font-weight: 700;
              font-size: 14px;
              transition: all 0.3s ease;
              box-shadow: 0 2px 6px rgba(91, 124, 153, 0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
            "
            onmouseover="
              this.style.background='linear-gradient(135deg, #4A6B88 0%, #3A5B78 100%)';
              this.style.transform='translateY(-2px)';
              this.style.boxShadow='0 4px 12px rgba(91, 124, 153, 0.4)';
            "
            onmouseout="
              this.style.background='linear-gradient(135deg, #5B7C99 0%, #4A6B88 100%)';
              this.style.transform='translateY(0)';
              this.style.boxShadow='0 2px 6px rgba(91, 124, 153, 0.3)';
            "
          >
            <span style="font-size: 16px;">🏁</span>
            <span>Eindig etappe hier</span>
          </button>
        </div>
      `;
    }

    // Add "Add to route" button for non-endpoint POI types (as waypoint stops)
    const isWaypointType = ['restaurant', 'supermarket', 'water', 'bakery', 'pharmacy', 'picnic', 'bench', 'cafe', 'viewpoint'].includes(w.type.toLowerCase());

    if (isCustomStage && isWaypointType) {
      // Check if this POI is already added as a stop
      const existingStops = state.routeStops[stageIndex] || [];
      const isAlreadyAdded = existingStops.some(stop => 
        Math.abs(stop.lat - w.lat) < 0.0001 && Math.abs(stop.lon - w.lon) < 0.0001
      );

      if (isAlreadyAdded) {
        popupContent += `
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e0e0;">
            <div style="
              display: flex;
              align-items: center;
              gap: 8px;
              padding: 8px 12px;
              background: #e8f5e9;
              border-radius: 8px;
              color: #2e7d32;
              font-size: 13px;
            ">
              <span>✓</span>
              <span>Toegevoegd aan route</span>
            </div>
            <button 
              class="removeFromRouteBtn" 
              data-stage-idx="${stageIndex}"
              data-poi-lat="${w.lat}"
              data-poi-lon="${w.lon}"
              style="
                width: 100%;
                margin-top: 8px;
                padding: 8px 12px;
                background: #ffebee;
                color: #c62828;
                border: 1px solid #ffcdd2;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s;
              "
              onmouseover="this.style.background='#ffcdd2'"
              onmouseout="this.style.background='#ffebee'"
            >
              ✕ Verwijder van route
            </button>
          </div>
        `;
      } else {
        popupContent += `
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e0e0;">
            <button 
              class="addToRouteBtn" 
              data-stage-idx="${stageIndex}"
              data-poi-lat="${w.lat}"
              data-poi-lon="${w.lon}"
              data-poi-type="${w.type}"
              data-poi-name="${escapeHtml(name)}"
              data-poi-km="${w.km || 0}"
              style="
                width: 100%;
                padding: 10px 16px;
                background: linear-gradient(135deg, #27ae60 0%, #219a52 100%);
                color: white;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 700;
                font-size: 14px;
                transition: all 0.3s ease;
                box-shadow: 0 2px 6px rgba(39, 174, 96, 0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
              "
              onmouseover="
                this.style.background='linear-gradient(135deg, #219a52 0%, #1a8044 100%)';
                this.style.transform='translateY(-2px)';
                this.style.boxShadow='0 4px 12px rgba(39, 174, 96, 0.4)';
              "
              onmouseout="
                this.style.background='linear-gradient(135deg, #27ae60 0%, #219a52 100%)';
                this.style.transform='translateY(0)';
                this.style.boxShadow='0 2px 6px rgba(39, 174, 96, 0.3)';
              "
            >
              <span style="font-size: 16px;">➕</span>
              <span>Voeg toe aan route</span>
            </button>
          </div>
        `;
      }
    }

    const marker = L.marker([w.lat, w.lon], { icon: customIcon })
      .addTo(layerGroup)
      .bindPopup(popupContent, {
        maxWidth: 300,
        className: 'enhanced-poi-popup'
      });

    // Fetch additional details when popup opens
    marker.on('popupopen', async (e) => {
      const detailsDiv = e.popup.getElement().querySelector('.poi-extra-details');
      if (!detailsDiv) return;

      // Check if we have pre-fetched details from enriched JSON
      if (w.details) {
        console.log('📦 Using pre-fetched POI details (offline data)');
        renderPOIDetails(detailsDiv, w.details);
        return;
      }

      // Fallback: Fetch details from API (online)
      console.log('🌐 Fetching POI details from API (online)...');
      const details = await fetchPOIDetails(w.lat, w.lon);

      if (!details) {
        detailsDiv.innerHTML = `
          <div style="color: #999; font-size: 12px; font-style: italic;">
            ℹ️ Geen info beschikbaar
          </div>
        `;
        return;
      }

      renderPOIDetails(detailsDiv, details);
    });
  });

  return filteredWaypoints.length;
}

// Render POI details HTML
function renderPOIDetails(container, details) {
  // Build details HTML
  let detailsHTML = '';

  // Photo (if available)
  if (details.photo) {
    detailsHTML += `
      <div style="margin-top: 8px; margin-bottom: 8px; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
        <img src="${details.photo}" alt="Photo" style="width: 100%; height: auto; display: block; max-height: 200px; object-fit: cover;">
      </div>
    `;
  }

  // Address
  if (details.address) {
    detailsHTML += `
      <div style="margin-top: 8px; padding: 8px; background: #f8f9fa; border-radius: 6px; font-size: 13px;">
        <div style="color: #2c3e50;">📍 ${escapeHtml(details.address)}</div>
      </div>
    `;
  }

  // Contact info
  if (details.phone) {
    detailsHTML += `
      <div style="margin-top: 6px; font-size: 13px;">
        <a href="tel:${details.phone}" style="color: #5B7C99; text-decoration: none; display: flex; align-items: center; gap: 6px;">
          <span>📞</span>
          <span>${escapeHtml(details.phone)}</span>
        </a>
      </div>
    `;
  }

  if (details.website) {
    const websiteUrl = details.website.startsWith('http') ? details.website : `https://${details.website}`;
    const displayUrl = details.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

    detailsHTML += `
      <div style="margin-top: 6px; font-size: 13px;">
        <a href="${websiteUrl}" target="_blank" rel="noopener" style="color: #5B7C99; text-decoration: none; display: flex; align-items: center; gap: 6px;">
          <span>🌐</span>
          <span>${escapeHtml(displayUrl)}</span>
        </a>
      </div>
    `;
  }

  if (details.email) {
    detailsHTML += `
      <div style="margin-top: 6px; font-size: 13px;">
        <a href="mailto:${details.email}" style="color: #5B7C99; text-decoration: none; display: flex; align-items: center; gap: 6px;">
          <span>✉️</span>
          <span>${escapeHtml(details.email)}</span>
        </a>
      </div>
    `;
  }

  // Opening hours
  if (details.openingHours) {
    detailsHTML += `
      <div style="margin-top: 8px; padding: 6px 8px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 4px; font-size: 12px;">
        <div style="font-weight: 600; color: #856404;">⏰ Openingstijden</div>
        <div style="color: #856404; margin-top: 2px;">${escapeHtml(details.openingHours)}</div>
      </div>
    `;
  }

  // Stars (for hotels)
  if (details.stars) {
    const starCount = parseInt(details.stars, 10);
    if (starCount > 0 && starCount <= 5) {
      detailsHTML += `
        <div style="margin-top: 6px; font-size: 13px; color: #f39c12;">
          ${'⭐'.repeat(starCount)}
        </div>
      `;
    }
  }

  // Description
  if (details.description) {
    detailsHTML += `
      <div style="margin-top: 8px; padding: 6px 8px; background: #e8f4f8; border-left: 3px solid #5B7C99; border-radius: 4px; font-size: 12px; color: #2c3e50;">
        ${escapeHtml(details.description)}
      </div>
    `;
  }

  // Update the popup content
  if (detailsHTML) {
    container.innerHTML = detailsHTML;
  } else {
    container.innerHTML = `
      <div style="color: #999; font-size: 12px; font-style: italic;">
        ℹ️ Geen info beschikbaar
      </div>
    `;
  }
}

// Helper function to adjust color brightness
function adjustColorBrightness(color, percent) {
  // Convert hex to RGB
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  // Adjust brightness
  const newR = Math.max(0, Math.min(255, r + percent));
  const newG = Math.max(0, Math.min(255, g + percent));
  const newB = Math.max(0, Math.min(255, b + percent));

  // Convert back to hex
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

// Fetch additional POI details from OpenStreetMap Overpass API
async function fetchPOIDetails(lat, lon) {
  const cacheKey = `${lat.toFixed(6)},${lon.toFixed(6)}`;

  // Check cache first
  if (state.poiDetailsCache.has(cacheKey)) {
    return state.poiDetailsCache.get(cacheKey);
  }

  try {
    // Query Overpass API for nodes/ways near this coordinate
    const query = `
      [out:json][timeout:10];
      (
        node(around:50,${lat},${lon});
        way(around:50,${lat},${lon});
      );
      out body;
      >;
      out skel qt;
    `;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!response.ok) {
      throw new Error('Overpass API request failed');
    }

    const data = await response.json();

    // Find the closest element with the most tags
    let bestMatch = null;
    let minDistance = Infinity;

    for (const element of data.elements) {
      if (element.type === 'node' && element.lat && element.lon) {
        const dist = haversineKm(lat, lon, element.lat, element.lon);

        // Prefer elements with names and amenity tags
        const hasName = element.tags?.name;
        const hasAmenity = element.tags?.amenity || element.tags?.tourism;
        const score = dist - (hasName ? 0.01 : 0) - (hasAmenity ? 0.01 : 0);

        if (score < minDistance && element.tags) {
          minDistance = score;
          bestMatch = element;
        }
      }
    }

    if (!bestMatch || !bestMatch.tags) {
      // No data found, cache empty result
      state.poiDetailsCache.set(cacheKey, null);
      return null;
    }

    const tags = bestMatch.tags;

    // Extract useful information (FLAT structure to match enriched JSON)
    const details = {};

    // Address (as single string)
    const addressParts = [];
    if (tags['addr:street'] || tags['addr:housenumber']) {
      addressParts.push([tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '));
    }
    if (tags['addr:postcode'] || tags['addr:city']) {
      addressParts.push([tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' '));
    }
    if (addressParts.length > 0) {
      details.address = addressParts.join(', ');
    }

    // Contact info (flat)
    if (tags.phone || tags['contact:phone']) {
      details.phone = tags.phone || tags['contact:phone'];
    }
    if (tags.website || tags['contact:website']) {
      details.website = tags.website || tags['contact:website'];
    }
    if (tags.email || tags['contact:email']) {
      details.email = tags.email || tags['contact:email'];
    }

    // Other info
    if (tags.opening_hours) {
      details.openingHours = tags.opening_hours;
    }
    if (tags.stars) {
      details.stars = tags.stars;
    }
    if (tags.operator) {
      details.operator = tags.operator;
    }
    if (tags.description) {
      details.description = tags.description;
    }

    // Cache the result
    state.poiDetailsCache.set(cacheKey, details);

    console.log('📍 Fetched POI details from API:', details);

    return details;

  } catch (error) {
    console.error('Error fetching POI details:', error);
    // Cache null to prevent repeated failed requests
    state.poiDetailsCache.set(cacheKey, null);
    return null;
  }
}

// --------------------
// MAP TILE LAYER HELPER
// --------------------

function createTileLayer() {
  if (state.mapStyle === 'topo') {
    // OpenTopoMap - Great for hiking with contour lines and trails
    return L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) | Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 17
    });
  } else {
    // OpenStreetMap - Default
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    });
  }
}

async function initMap(gpxProfile) {
  const mapEl = document.getElementById("trailMap");
  if (!mapEl) return;

  // Always create a fresh map (the container was recreated by innerHTML)
  state.map = L.map("trailMap").setView([52.37, 4.89], 7);

  // Add tile layer and store reference
  state.tileLayer = createTileLayer().addTo(state.map);

  // Add map style switcher control
  const styleControl = L.control({ position: 'bottomleft' });
  styleControl.onAdd = function() {
    const div = L.DomUtil.create('div', 'map-style-control');
    div.style.background = 'white';
    div.style.padding = '6px 10px';
    div.style.borderRadius = '4px';
    div.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    div.style.cursor = 'pointer';
    div.style.fontWeight = '600';
    div.style.fontSize = '13px';
    div.innerHTML = state.mapStyle === 'topo' ? '🗺️ OSM' : '🏔️ Topo';

    L.DomEvent.disableClickPropagation(div);

    div.onclick = function() {
      // Toggle map style
      state.mapStyle = state.mapStyle === 'osm' ? 'topo' : 'osm';
      console.log('Switched to map style:', state.mapStyle);
      savePreferences(); // Save preference

      // Remove old tile layer from main map
      if (state.tileLayer) {
        state.map.removeLayer(state.tileLayer);
      }

      // Add new tile layer to main map
      state.tileLayer = createTileLayer().addTo(state.map);

      // Update button label
      div.innerHTML = state.mapStyle === 'topo' ? '🗺️ OSM' : '🏔️ Topo';

      // Also update all inline maps
      Object.keys(state).forEach(key => {
        if (key.startsWith('inlineMap_') && state[key]) {
          const idx = key.replace('inlineMap_', '');
          const inlineMap = state[key];
          const oldTileLayer = state[`tileLayer_inline_${idx}`];

          if (oldTileLayer) {
            inlineMap.removeLayer(oldTileLayer);
          }

          state[`tileLayer_inline_${idx}`] = createTileLayer().addTo(inlineMap);
        }
      });

      // Update all inline map control labels
      document.querySelectorAll('.map-style-control').forEach(btn => {
        btn.innerHTML = state.mapStyle === 'topo' ? '🗺️ OSM' : '🏔️ Topo';
      });

      console.log('✅ All maps switched to', state.mapStyle);
    };

    return div;
  };
  styleControl.addTo(state.map);

  // Add layer groups
  state.stageLayerGroup.addTo(state.map);
  state.poiLayerGroup.addTo(state.map);

  if (gpxProfile?.points?.length) {
    // Determine which part of the track to show based on mode and selection
    let trackPoints;

    if (state.planMode === "official") {
      // For official mode, calculate km range from selected stages
      if (state.startStage !== null || state.endStage !== null) {
        const allStages = extractStages(state.currentTrailData);
        const startIdx = state.startStage !== null ? state.startStage : 0;
        const endIdx = state.endStage !== null ? state.endStage : allStages.length - 1;

        // Calculate km positions (rough approximation)
        const totalStages = allStages.length;
        const totalKm = gpxProfile.totalKm || gpxProfile.cumKm[gpxProfile.cumKm.length - 1];
        const kmPerStage = totalKm / totalStages;

        const startKm = startIdx * kmPerStage;
        const endKm = (endIdx + 1) * kmPerStage;

        // Find corresponding points
        const startPointIdx = gpxProfile.cumKm.findIndex(km => km >= startKm);
        const endPointIdx = gpxProfile.cumKm.findIndex(km => km >= endKm);

        trackPoints = gpxProfile.points.slice(
          Math.max(0, startPointIdx),
          endPointIdx > 0 ? endPointIdx : gpxProfile.points.length
        ).map(p => [p.lat, p.lon]);
      } else {
        trackPoints = gpxProfile.points.map(p => [p.lat, p.lon]);
      }
    } else {
      // For custom mode, use km range
      const actualStartKm = state.startKm !== null && state.startKm >= 0 ? state.startKm : 0;
      const totalKm = gpxProfile.totalKm || gpxProfile.cumKm[gpxProfile.cumKm.length - 1];
      const actualEndKm = state.endKm !== null && state.endKm > actualStartKm ? state.endKm : totalKm;

      if (actualStartKm > 0 || actualEndKm < totalKm) {
        const startPointIdx = gpxProfile.cumKm.findIndex(km => km >= actualStartKm);
        const endPointIdx = gpxProfile.cumKm.findIndex(km => km >= actualEndKm);

        trackPoints = gpxProfile.points.slice(
          Math.max(0, startPointIdx),
          endPointIdx > 0 ? endPointIdx : gpxProfile.points.length
        ).map(p => [p.lat, p.lon]);
      } else {
        trackPoints = gpxProfile.points.map(p => [p.lat, p.lon]);
      }
    }

    // Draw the selected portion of the track
    state.fullTrackLayer = L.polyline(trackPoints, {
      color: '#8B4513',
      weight: 4,
      opacity: 0.7,
      dashArray: '8, 8',
      interactive: true, // Make sure the polyline can receive clicks
    }).addTo(state.map);

    // Add click handler directly to the polyline for map-based selection
    // NOTE: This is no longer used since we use the modal, but kept for backwards compatibility
    state.fullTrackLayer.on('click', function(e) {
      if (!state.mapSelectionMode || state.planMode !== 'custom') {
        return;
      }

      // Get the current gpxProfile from cache
      const direction = state.isReversed ? 'rev' : 'fwd';
      const cacheKey = `${state.currentTrailUrl}_${direction}`;
      const currentGpxProfile = state.gpxCache.get(cacheKey);

      if (!currentGpxProfile?.points?.length || !currentGpxProfile.cumKm) {
        return;
      }

      const clickLat = e.latlng.lat;
      const clickLon = e.latlng.lng;

      // Find closest point on the track
      const closest = findClosestPointIndex(currentGpxProfile.points, clickLat, clickLon);
      const clickedKm = currentGpxProfile.cumKm[closest.index];

      // Round to 1 decimal for cleaner display
      const roundedKm = Math.round(clickedKm * 10) / 10;

      // Determine if this is start or end selection
      if (state.startKm === null || (state.startKm !== null && state.endKm !== null)) {
        // Setting start point (or resetting both)
        state.startKm = roundedKm;
        state.endKm = null;

        // Remove old markers
        if (state.startMarker) state.map.removeLayer(state.startMarker);
        if (state.endMarker) state.map.removeLayer(state.endMarker);

        // Add start marker
        state.startMarker = L.marker([currentGpxProfile.points[closest.index].lat, currentGpxProfile.points[closest.index].lon], {
          icon: L.divIcon({
            className: 'start-marker',
            html: '🚶',
            iconSize: [60, 60],
          })
        }).addTo(state.map).bindPopup(`Start: ${formatKm(roundedKm)} km`);

        // DON'T re-render yet, just update the UI text
        const instructionEl = document.querySelector('.mapInstruction');
        if (instructionEl) {
          instructionEl.textContent = '👆 Klik op de route voor eindpunt';
        }

      } else if (state.startKm !== null && state.endKm === null) {
        // Setting end point
        state.endKm = roundedKm;

        // Make sure start < end, swap if needed
        if (state.startKm > state.endKm) {
          const tmp = state.startKm;
          state.startKm = state.endKm;
          state.endKm = tmp;
        }

        // Add end marker
        state.endMarker = L.marker([currentGpxProfile.points[closest.index].lat, currentGpxProfile.points[closest.index].lon], {
          icon: L.divIcon({
            className: 'end-marker',
            html: '🏁',
            iconSize: [60, 60],
          })
        }).addTo(state.map).bindPopup(`Einde: ${formatKm(roundedKm)} km`);

        // NOW re-render with both points set
        renderFullDetail();
      }
    });

    // Change cursor when hovering over the route in map selection mode
    if (state.mapSelectionMode && state.planMode === 'custom') {
      state.fullTrackLayer.on('mouseover', function() {
        this.setStyle({ weight: 5, opacity: 0.8 });
      });
      state.fullTrackLayer.on('mouseout', function() {
        this.setStyle({ weight: 3, opacity: 0.6 });
      });
    }

    // Fit map to track
    state.map.fitBounds(state.fullTrackLayer.getBounds());

    // Restore markers if they exist from previous selection
    if (state.mapSelectionMode && state.startKm !== null && gpxProfile?.points?.length) {
      // Find point indices for start/end km
      const startIdx = gpxProfile.cumKm.findIndex(km => km >= state.startKm);
      if (startIdx >= 0) {
        const startPoint = gpxProfile.points[startIdx];
        state.startMarker = L.marker([startPoint.lat, startPoint.lon], {
          icon: L.divIcon({
            className: 'start-marker',
            html: '🚶',
            iconSize: [60, 60],
          })
        }).addTo(state.map).bindPopup(`Start: ${formatKm(state.startKm)} km`);
      }

      if (state.endKm !== null) {
        const endIdx = gpxProfile.cumKm.findIndex(km => km >= state.endKm);
        if (endIdx >= 0) {
          const endPoint = gpxProfile.points[endIdx];
          state.endMarker = L.marker([endPoint.lat, endPoint.lon], {
            icon: L.divIcon({
              className: 'end-marker',
              html: '🏁',
              iconSize: [60, 60],
            })
          }).addTo(state.map).bindPopup(`Einde: ${formatKm(state.endKm)} km`);
        }
      }
    }

    // POI markers are disabled - they clutter the map
    // Uncomment below if you want to re-enable them:
    // state.poiLayerGroup.clearLayers();
    // (gpxProfile.waypoints || []).forEach(w => {
    //   L.marker([w.lat, w.lon]).addTo(state.poiLayerGroup).bindPopup(w.label);
    // });
  }

  // Layer control
  const overlays = {
    "Geselecteerde etappe": state.stageLayerGroup,
  };
  if (state.fullTrackLayer) {
    overlays["Volledige route"] = state.fullTrackLayer;
  }

  const layerControl = L.control.layers({}, overlays).addTo(state.map);

  // Add custom POI filter controls
  const poiFilterControl = L.control({ position: 'topright' });

  poiFilterControl.onAdd = function(map) {
    const div = L.DomUtil.create('div', 'poi-filter-control');
    div.style.background = 'white';
    div.style.padding = '10px';
    div.style.borderRadius = '8px';
    div.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    div.style.maxWidth = '200px';
    div.style.maxHeight = '400px';
    div.style.overflowY = 'auto';

    div.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px;">🗺️ POI Filter</div>
      <div style="font-size: 12px; margin-bottom: 8px; color: #666;">Vink aan om te tonen:</div>
      <label style="display: flex; align-items: center; margin: 6px 0; cursor: pointer; font-size: 13px;">
        <input type="checkbox" class="poi-type-filter" value="camping" checked style="margin-right: 6px;"> ⛺ Camping
      </label>
      <label style="display: flex; align-items: center; margin: 6px 0; cursor: pointer; font-size: 13px;">
        <input type="checkbox" class="poi-type-filter" value="hotel" checked style="margin-right: 6px;"> 🏨 Hotel
      </label>
      <label style="display: flex; align-items: center; margin: 6px 0; cursor: pointer; font-size: 13px;">
        <input type="checkbox" class="poi-type-filter" value="station" checked style="margin-right: 6px;"> 🚂 Station
      </label>
      <hr style="margin: 8px 0; border: none; border-top: 1px solid #ddd;">
      <label style="display: flex; align-items: center; margin: 6px 0; cursor: pointer; font-size: 13px;">
        <input type="checkbox" class="poi-type-filter" value="restaurant" style="margin-right: 6px;"> 🍽️ Restaurant
      </label>
      <label style="display: flex; align-items: center; margin: 6px 0; cursor: pointer; font-size: 13px;">
        <input type="checkbox" class="poi-type-filter" value="supermarket" style="margin-right: 6px;"> 🛒 Supermarkt
      </label>
      <label style="display: flex; align-items: center; margin: 6px 0; cursor: pointer; font-size: 13px;">
        <input type="checkbox" class="poi-type-filter" value="water" style="margin-right: 6px;"> 💧 Water
      </label>
      <label style="display: flex; align-items: center; margin: 6px 0; cursor: pointer; font-size: 13px;">
        <input type="checkbox" class="poi-type-filter" value="bakery" style="margin-right: 6px;"> 🥐 Bakkerij
      </label>
      <label style="display: flex; align-items: center; margin: 6px 0; cursor: pointer; font-size: 13px;">
        <input type="checkbox" class="poi-type-filter" value="pharmacy" style="margin-right: 6px;"> 💊 Apotheek
      </label>
      <label style="display: flex; align-items: center; margin: 6px 0; cursor: pointer; font-size: 13px;">
        <input type="checkbox" class="poi-type-filter" value="picnic" style="margin-right: 6px;"> 🧺 Picknick
      </label>
      <label style="display: flex; align-items: center; margin: 6px 0; cursor: pointer; font-size: 13px;">
        <input type="checkbox" class="poi-type-filter" value="bench" style="margin-right: 6px;"> 🪑 Bankje
      </label>
    `;

    // Stop clicks and scroll from propagating to map
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    return div;
  };

  poiFilterControl.addTo(state.map);

  // Listen for POI filter changes
  state.map.on('overlayadd', function(e) {
    if (e.layer === state.poiLayerGroup) {
      console.log('POI layer activated - redrawing markers');
      updateMapForStage(gpxProfile, null);
    }
  });

  state.map.on('overlayremove', function(e) {
    if (e.layer === state.poiLayerGroup) {
      console.log('POI layer deactivated');
    }
  });

  // Handle POI filter checkbox changes
  document.addEventListener('change', function(e) {
    if (e.target.classList.contains('poi-type-filter')) {
      console.log('POI filter changed - preserving view');
      updateMapForStage(gpxProfile, null, true); // preserveView = true
    }
  });

  // Initial render of POI markers
  updateMapForStage(gpxProfile, null);
}

function updateMapForStage(gpxProfile, selectedStage = null, preserveView = false) {
  if (!state.map) return;

  state.stageLayerGroup.clearLayers();

  // Update POI layer using helper
  const numMarkers = renderPOIMarkers(state.map, state.poiLayerGroup, gpxProfile);
  console.log('POI markers rendered:', numMarkers);

  // If preserveView is true, don't change the zoom/center
  if (preserveView) {
    return;
  }

  let bounds = null;
  let setZoomCenter = false;

  if (selectedStage) {
    if (selectedStage.gpx) {
      // Official stage: Load per-stage GPX manually
      try {
        const stageLayer = new L.GPX(selectedStage.gpx, {
          async: true,
          marker_options: {
            startIconUrl: false,
            endIconUrl: false,
            shadowUrl: false,
          },
          polyline_options: {
            color: '#2980b9',
            weight: 6,
          },
        }).on("loaded", function (e) {
          e.target.addTo(state.stageLayerGroup);
          state.map.fitBounds(e.target.getBounds());
          console.log("Official stage loaded");
        }).on("error", function (err) {
          console.warn("Official stage GPX error:", err);
        });
      } catch (err) {
        console.warn("Official stage GPX failed:", err);
      }
    } else if (selectedStage.type === "custom" && selectedStage.startIndex !== null && selectedStage.endIndex !== null && gpxProfile?.points?.length) {
      // Custom stage: Extract segment points and show as polyline
      const segmentPoints = gpxProfile.points.slice(selectedStage.startIndex, selectedStage.endIndex + 1).map(p => [p.lat, p.lon]);
      if (segmentPoints.length > 1) {
        const polyline = L.polyline(segmentPoints, {
          color: '#2980b9',
          weight: 6,
        }).addTo(state.stageLayerGroup);
        bounds = polyline.getBounds();

        // Add start/end markers
        L.marker(segmentPoints[0]).addTo(state.stageLayerGroup).bindPopup(`Start dag ${selectedStage.index}`);
        L.marker(segmentPoints[segmentPoints.length - 1]).addTo(state.stageLayerGroup).bindPopup(`Einde dag ${selectedStage.index}`);
        console.log("Custom segment added with", segmentPoints.length, "points");
      } else {
        console.warn("Custom stage has no valid segment points. Falling back to marker.");
        if (selectedStage.lat && selectedStage.lon) {
          L.marker([selectedStage.lat, selectedStage.lon]).addTo(state.stageLayerGroup).bindPopup(`Einde dag ${selectedStage.index}`);
          setZoomCenter = true;
        }
      }
    }
  }

  // Fit to stage bounds if available
  if (bounds) {
    state.map.fitBounds(bounds);
  } else if (setZoomCenter && selectedStage?.lat && selectedStage?.lon) {
    state.map.setView([selectedStage.lat, selectedStage.lon], 12);
  } else if (state.fullTrackLayer) {
    const b = state.fullTrackLayer.getBounds();
    if (b && b.isValid()) {
      state.map.fitBounds(b);
    }
  }
}

// --------------------
// RENDER: TRAILS LIST (OVERVIEW)
// --------------------
// ====================
// WIDGET SYSTEM
// ====================
const WIDGET_DEFAULTS = {
  map: { collapsed: false, pinned: true, order: 0 },
  stats: { collapsed: false, pinned: true, order: 1 },
  description: { collapsed: false, pinned: false, order: 2 },
  stages: { collapsed: false, pinned: true, order: 3 },
  planner: { collapsed: false, pinned: false, order: 4 },
  journal: { collapsed: false, pinned: false, order: 5 },
  weather: { collapsed: true, pinned: false, order: 6 },
  tools: { collapsed: false, pinned: false, order: 7 },
};

function getWidgetState(trailId, widgetId) {
  const key = `${trailId}_${widgetId}`;
  return state.widgetStates[key] || WIDGET_DEFAULTS[widgetId] || { collapsed: true, pinned: false, order: 99, hidden: false };
}

function setWidgetState(trailId, widgetId, updates) {
  const key = `${trailId}_${widgetId}`;
  state.widgetStates[key] = { ...getWidgetState(trailId, widgetId), ...updates };
  savePreferences();
}

function toggleWidgetCollapsed(trailId, widgetId) {
  const current = getWidgetState(trailId, widgetId);
  setWidgetState(trailId, widgetId, { collapsed: !current.collapsed });
}

function toggleWidgetHidden(trailId, widgetId) {
  const current = getWidgetState(trailId, widgetId);
  setWidgetState(trailId, widgetId, { hidden: !current.hidden });
}

// Default widget layout: which widgets in which column and order
const DEFAULT_WIDGET_LAYOUT = {
  column0: ['map', 'stages', 'journal'],
  column1: ['planner', 'description', 'photos'],
  column2: ['stats', 'tools']
};

function getWidgetLayout(trailId) {
  const key = `${trailId}_layout`;
  let layout = state.widgetStates[key];

  if (!layout) {
    return JSON.parse(JSON.stringify(DEFAULT_WIDGET_LAYOUT));
  }

  // Migration: add journal widget if it's missing from existing layouts
  const allWidgets = [...(layout.column0 || []), ...(layout.column1 || []), ...(layout.column2 || [])];
  if (!allWidgets.includes('journal')) {
    // Add journal to column1 (middle column, after planner)
    layout.column1 = layout.column1 || [];
    layout.column1.push('journal');
    state.widgetStates[key] = layout;
    savePreferences();
  }

  // Migration: add photos widget if it's missing from existing layouts
  const allWidgets2 = [...(layout.column0 || []), ...(layout.column1 || []), ...(layout.column2 || [])];
  if (!allWidgets2.includes('photos')) {
    // Add photos to column1 (middle column, at the end)
    layout.column1 = layout.column1 || [];
    layout.column1.push('photos');
    state.widgetStates[key] = layout;
    savePreferences();
  }

  // Migration: move journal to column0 if it's in column1
  const journalInCol1 = (layout.column1 || []).includes('journal');
  const journalInCol0 = (layout.column0 || []).includes('journal');
  if (journalInCol1 && !journalInCol0) {
    layout.column1 = layout.column1.filter(w => w !== 'journal');
    layout.column0 = layout.column0 || [];
    layout.column0.push('journal');
    state.widgetStates[key] = layout;
    savePreferences();
  }

  return layout;
}

function setWidgetLayout(trailId, layout) {
  const key = `${trailId}_layout`;
  state.widgetStates[key] = layout;
  savePreferences();
}

function moveWidget(trailId, widgetId, fromCol, toCol, toIndex) {
  const layout = getWidgetLayout(trailId);

  // Remove from source column
  layout[fromCol] = layout[fromCol].filter(w => w !== widgetId);

  // Add to target column at specific index
  layout[toCol].splice(toIndex, 0, widgetId);

  setWidgetLayout(trailId, layout);
}

// Render all widget columns dynamically
function renderWidgetColumns(trailId, gpxProfile, norm) {
  const layout = getWidgetLayout(trailId);


  // Widget render functions map
  const widgetRenderers = {
    map: () => renderMapWidget(trailId, gpxProfile, norm),
    stats: () => renderRouteStatsWidget(trailId, norm, gpxProfile),
    description: () => renderRouteDescriptionWidget(trailId, norm),
    stages: () => renderStagesWidget(trailId, norm),
    planner: () => renderPlannerWidget(trailId, norm),
    tools: () => renderToolsWidget(trailId),
    journal: () => renderJournalWidget(trailId, norm),
    photos: () => renderPhotosWidget(trailId, norm)
  };

  // Render each column
  return ['column0', 'column1', 'column2'].map((colKey, colIndex) => {
    const widgets = layout[colKey] || [];
    const widgetHtml = widgets
      .map(widgetId => widgetRenderers[widgetId] ? widgetRenderers[widgetId]() : '')
      .filter(html => html) // Remove empty (hidden widgets)
      .join('');

    return `<div class="widget-column" data-column="${colIndex}">${widgetHtml}</div>`;
  }).join('');
}

// Helper to render widget header with drag handle and menu
function renderWidgetHeader(trailId, widgetId, icon, title, extraButtons = '') {
  // In edit mode: show drag handle and hide button
  // In normal mode: only show chevron for collapse
  const editModeControls = `
    <div class="widget-drag-handle" draggable="true" data-drag-widget="${widgetId}" title="Sleep om te verplaatsen">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="9" cy="6" r="2"></circle>
        <circle cx="15" cy="6" r="2"></circle>
        <circle cx="9" cy="12" r="2"></circle>
        <circle cx="15" cy="12" r="2"></circle>
        <circle cx="9" cy="18" r="2"></circle>
        <circle cx="15" cy="18" r="2"></circle>
      </svg>
    </div>
  `;

  const editModeActions = `
    <button class="widget-hide-btn" data-hide-widget="${widgetId}" data-trail="${trailId}" title="Verbergen">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
    </button>
  `;

  return `
    <div class="widget-header" data-toggle-widget="${widgetId}">
      ${editModeControls}
      <div class="widget-icon">${icon}</div>
      <h3 class="widget-title">${title}</h3>
      <div class="widget-actions">
        ${extraButtons}
        ${editModeActions}
        <span class="widget-chevron">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 9l6 6 6-6"></path>
          </svg>
        </span>
      </div>
    </div>
  `;
}

// ====================
// USER TRAILS MANAGEMENT
// ====================
function addUserTrail(jsonUrl, trailData) {
  const id = `trail_${Date.now()}`;
  const userTrail = {
    id,
    jsonUrl,
    name: trailData.name || trailData.title,
    image: trailData.image || null, // Store hero image
    status: 'saved', // 'saved' | 'wishlist' | 'planned' | 'active' | 'completed'
    progress: {
      currentStage: 0,
      completedStages: [],
    },
    journal: {
      entries: [], // Array of journal entries per stage
    },
    addedAt: new Date().toISOString(),
  };
  state.userTrails.push(userTrail);
  savePreferences();
  return userTrail;
}

function removeUserTrail(trailId) {
  state.userTrails = state.userTrails.filter(t => t.id !== trailId);
  savePreferences();
}

function updateUserTrailStatus(trailId, status) {
  const trail = state.userTrails.find(t => t.id === trailId);
  if (trail) {
    trail.status = status;
    savePreferences();
  }
}

function getUserTrailByJsonUrl(jsonUrl) {
  return state.userTrails.find(t => t.jsonUrl === jsonUrl);
}

// ====================
// JOURNAL MANAGEMENT
// ====================
function getJournalEntry(trailId, stageIndex) {
  const trail = state.userTrails.find(t => t.id === trailId);
  if (!trail || !trail.journal) return null;
  return trail.journal.entries.find(e => e.stageIndex === stageIndex);
}

function saveJournalEntry(trailId, stageIndex, entryData) {
  const trail = state.userTrails.find(t => t.id === trailId);
  if (!trail) return;

  // Initialize journal if needed
  if (!trail.journal) {
    trail.journal = { entries: [] };
  }

  // Find existing entry or create new
  const existingIdx = trail.journal.entries.findIndex(e => e.stageIndex === stageIndex);

  const entry = {
    stageIndex,
    date: entryData.date || new Date().toISOString().split('T')[0],
    summary: entryData.summary || '',
    story: entryData.story || '',
    mood: entryData.mood || null,
    weather: entryData.weather || null,
    cumulativeKm: entryData.cumulativeKm || 0,
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    trail.journal.entries[existingIdx] = entry;
  } else {
    trail.journal.entries.push(entry);
  }

  savePreferences();
}

function deleteJournalEntry(trailId, stageIndex) {
  const trail = state.userTrails.find(t => t.id === trailId);
  if (!trail || !trail.journal) return;

  trail.journal.entries = trail.journal.entries.filter(e => e.stageIndex !== stageIndex);
  savePreferences();
}

function getJournalStats(trailId) {
  const trail = state.userTrails.find(t => t.id === trailId);
  if (!trail || !trail.journal) return { entryCount: 0, totalKm: 0 };

  const entries = trail.journal.entries || [];
  return {
    entryCount: entries.length,
    lastEntry: entries.length > 0 ? entries[entries.length - 1] : null,
  };
}

// ====================
// STAGE COMPLETION MANAGEMENT
// ====================
function isStageCompleted(trailId, stageIndex) {
  const trail = state.userTrails.find(t => t.id === trailId);
  if (!trail || !trail.progress) return false;
  return trail.progress.completedStages?.includes(stageIndex) || false;
}

function toggleStageCompleted(trailId, stageIndex) {
  const trail = state.userTrails.find(t => t.id === trailId);
  if (!trail) return;

  // Initialize progress if needed
  if (!trail.progress) {
    trail.progress = { currentStage: 0, completedStages: [] };
  }
  if (!trail.progress.completedStages) {
    trail.progress.completedStages = [];
  }

  const idx = trail.progress.completedStages.indexOf(stageIndex);
  if (idx >= 0) {
    // Remove from completed
    trail.progress.completedStages.splice(idx, 1);
  } else {
    // Add to completed
    trail.progress.completedStages.push(stageIndex);
    trail.progress.completedStages.sort((a, b) => a - b);
  }

  // Update current stage to last completed + 1
  if (trail.progress.completedStages.length > 0) {
    trail.progress.currentStage = Math.max(...trail.progress.completedStages) + 1;
  } else {
    trail.progress.currentStage = 0;
  }

  savePreferences();
}

function getCompletedStages(trailId) {
  const trail = state.userTrails.find(t => t.id === trailId);
  return trail?.progress?.completedStages || [];
}

function getCompletedStagesCount(trailId) {
  return getCompletedStages(trailId).length;
}

// ====================
// RENDER: APP SHELL
// ====================
async function renderApp(trails) {
  state.currentView = 'home';

  app.innerHTML = `
    <div class="app-shell">
      <!-- Top Navigation -->
      <header class="app-header">
        <div class="header-left">
          <div class="app-logo">
            <span class="logo-icon">🥾</span>
            <span class="logo-text">Trail Companion</span>
          </div>
        </div>
        <div class="header-right">
          <button class="header-btn" id="searchBtn" title="Zoeken">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
          </button>
          <button class="header-btn" id="settingsBtn" title="Instellingen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
            </svg>
          <button class="header-btn" id="settingsBtn" title="Instellingen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
            </svg>
          </button>
          <button class="header-btn" onclick="ThemeManager.toggle()" title="Toggle theme">
            ${ThemeManager.getCurrentTheme() === 'light' ? '🌙' : '☀️'}
          </button>
          <button class="header-btn profile-btn" id="profileBtn" title="Profiel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </button>
        </div>
      </header>

      <!-- Main Content -->
      <main class="app-main" id="appMain">
        ${renderHomeView(trails)}
      </main>
    </div>
  `;
}

// ====================
// RENDER: HOME VIEW (My Trails)
// ====================
function renderHomeView(trails) {
  const userTrails = state.userTrails;

  // Get current filter
  const statusFilter = state.homeStatusFilter || '';

  // Filter trails based on status
  const filteredTrails = statusFilter 
    ? userTrails.filter(t => t.status === statusFilter)
    : userTrails;

  // Status filter options
  const statusOptions = [
    { key: '', label: 'Alle trails', icon: '📚' },
    { key: 'saved', label: 'Bewaard', icon: '🔖' },
    { key: 'wishlist', label: 'Wensenlijst', icon: '📋' },
    { key: 'planned', label: 'Gepland', icon: '🎯' },
    { key: 'active', label: 'Bezig', icon: '🥾' },
    { key: 'completed', label: 'Voltooid', icon: '✅' },
  ];

  const currentFilter = statusOptions.find(s => s.key === statusFilter) || statusOptions[0];

  return `
    <div class="home-view">
      <div class="home-header">
        <h1 class="home-title">Mijn trails</h1>
        <div class="home-header-actions">
          <div class="home-filter-wrapper">
            <button class="home-filter-btn" id="homeFilterBtn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"></path>
              </svg>
              <span class="home-filter-label">${currentFilter.icon} ${currentFilter.label}</span>
              <svg class="home-filter-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"></path>
              </svg>
            </button>
            <div class="home-filter-dropdown" id="homeFilterDropdown">
              ${statusOptions.map(s => `
                <button class="home-filter-item ${s.key === statusFilter ? 'home-filter-item--active' : ''}" 
                        data-home-filter="${s.key}">
                  <span class="home-filter-item-icon">${s.icon}</span>
                  <span class="home-filter-item-label">${s.label}</span>
                  ${s.key === statusFilter ? '<span class="home-filter-item-check">✓</span>' : ''}
                </button>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="trails-grid" id="trailsGrid">
        ${filteredTrails.map((ut, index) => {
          const trailInfo = trails.find(t => t.json === ut.jsonUrl);
          if (!trailInfo) return '';
          return renderTrailCard(ut, trailInfo, index);
        }).join('')}

        <!-- Add Trail Card -->
        <button class="trail-card trail-card--add" id="addTrailBtn">
          <div class="add-trail-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12h14"></path>
            </svg>
          </div>
          <span class="add-trail-text">Voeg trail toe</span>
        </button>
      </div>

      <!-- Trail Picker Modal (hidden by default) -->
      <div class="modal-overlay" id="trailPickerModal" style="display: none;">
        <div class="modal-content trail-picker-modal">
          <div class="modal-header">
            <h2>Kies een trail</h2>
            <button class="modal-close" id="closeTrailPicker">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6 6 18M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <!-- Filters -->
          <div class="trail-picker-filters">
            <div class="filter-group">
              <label class="filter-label">Land</label>
              <select class="filter-select" id="filterCountry">
                <option value="">Alle landen</option>
                ${[...new Set(trails.flatMap(t => {
                  const countries = Array.isArray(t.countries) ? t.countries : 
                    (typeof t.countries === 'string' ? t.countries.split(',').map(s => s.trim()) : []);
                  return countries.map(c => normalizeCountryCode(c));
                }))].sort().map(c => `<option value="${c}">${countryFlags[c] || ''} ${c}</option>`).join('')}
              </select>
            </div>
            <div class="filter-group">
              <label class="filter-label">Afstand</label>
              <select class="filter-select" id="filterDistance">
                <option value="">Alle afstanden</option>
                <option value="0-100">Kort (< 100 km)</option>
                <option value="100-300">Middel (100-300 km)</option>
                <option value="300-600">Lang (300-600 km)</option>
                <option value="600+">Zeer lang (> 600 km)</option>
              </select>
            </div>
            <div class="filter-group">
              <label class="filter-label">Seizoen</label>
              <select class="filter-select" id="filterSeason">
                <option value="">Alle seizoenen</option>
                <option value="Voorjaar">🌸 Voorjaar</option>
                <option value="Zomer">☀️ Zomer</option>
                <option value="Herfst">🍂 Herfst</option>
                <option value="Winter">❄️ Winter</option>
              </select>
            </div>
          </div>

          <!-- Trail Grid -->
          <div class="trail-picker-grid" id="trailPickerGrid">
            ${trails.map(t => renderPickerCard(t)).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPickerCard(trail) {
  const isAdded = getUserTrailByJsonUrl(trail.json);
  const countries = Array.isArray(trail.countries) ? trail.countries : 
    (typeof trail.countries === 'string' ? trail.countries.split(',').map(s => s.trim()) : []);
  const displayName = removeCountryCodeFromName(trail.name || '', countries);
  const flags = countries.map(c => countryFlags[normalizeCountryCode(c).replace(/[^\w]/g, '')] || '🏳️').join(' ');
  const distance = trail.distance_km || trail.totalKm || '';
  const seasons = trail.seasons || [];

  return `
    <button class="picker-card ${isAdded ? 'picker-card--added' : ''}" 
            data-json="${escapeHtml(trail.json)}"
            data-countries="${countries.map(c => normalizeCountryCode(c)).join(',')}"
            data-distance="${distance}"
            data-seasons="${seasons.join(',')}"
            ${isAdded ? 'disabled' : ''}>
      ${trail.image ? `
        <div class="picker-card-image" style="background-image: url('${escapeHtml(trail.image)}')">
          <div class="picker-card-overlay"></div>
          ${isAdded ? '<span class="picker-card-badge">✓ Toegevoegd</span>' : ''}
        </div>
      ` : `
        <div class="picker-card-image picker-card-image--placeholder">
          <div class="picker-card-overlay"></div>
          ${isAdded ? '<span class="picker-card-badge">✓ Toegevoegd</span>' : ''}
        </div>
      `}
      <div class="picker-card-content">
        <h3 class="picker-card-title">${escapeHtml(displayName)}</h3>
        ${trail.from && trail.to ? `
          <p class="picker-card-route">${escapeHtml(trail.from)} → ${escapeHtml(trail.to)}</p>
        ` : ''}
      </div>
      <div class="picker-card-footer">
        <span class="picker-card-flags">${flags}</span>
        ${distance ? `<span class="picker-card-distance">${distance} km</span>` : ''}
      </div>
    </button>
  `;
}

function applyTrailPickerFilters() {
  const countryFilter = document.getElementById('filterCountry')?.value || '';
  const distanceFilter = document.getElementById('filterDistance')?.value || '';
  const seasonFilter = document.getElementById('filterSeason')?.value || '';

  const cards = document.querySelectorAll('.picker-card');

  cards.forEach(card => {
    const countries = (card.dataset.countries || '').split(',');
    const distance = parseFloat(card.dataset.distance) || 0;
    const seasons = (card.dataset.seasons || '').split(',');

    let show = true;

    // Country filter
    if (countryFilter && !countries.includes(countryFilter)) {
      show = false;
    }

    // Distance filter
    if (distanceFilter) {
      if (distanceFilter === '0-100' && distance >= 100) show = false;
      if (distanceFilter === '100-300' && (distance < 100 || distance >= 300)) show = false;
      if (distanceFilter === '300-600' && (distance < 300 || distance >= 600)) show = false;
      if (distanceFilter === '600+' && distance < 600) show = false;
    }

    // Season filter
    if (seasonFilter && !seasons.includes(seasonFilter)) {
      show = false;
    }

    card.classList.toggle('picker-card--hidden', !show);
  });
}

// ====================
// RENDER: TRAIL CARD
// ====================
function renderTrailCard(userTrail, trailInfo, index = 0) {
  const countries = Array.isArray(trailInfo.countries) ? trailInfo.countries : 
    (typeof trailInfo.countries === 'string' ? trailInfo.countries.split(',').map(s => s.trim()) : []);
  const displayName = removeCountryCodeFromName(trailInfo.name || '', countries);
  const flags = countries.map(c => countryFlags[normalizeCountryCode(c).replace(/[^\w]/g, '')] || '🏳️').join(' ');

  // Status config with 5 options
  const statusConfig = {
    saved: { label: 'Bewaard', icon: '🔖', class: 'status--saved' },
    wishlist: { label: 'Wensenlijst', icon: '📋', class: 'status--wishlist' },
    planned: { label: 'Gepland', icon: '🎯', class: 'status--planned' },
    active: { label: 'Bezig', icon: '🥾', class: 'status--active' },
    completed: { label: 'Voltooid', icon: '✅', class: 'status--completed' },
  };
  const currentStatus = statusConfig[userTrail.status] || statusConfig.saved;

  // Calculate stage count
  let stageDisplay = '';
  const officialStages = trailInfo.stages?.length || trailInfo.stageCount;
  const distanceKm = trailInfo.distance_km || trailInfo.totalKm;

  if (officialStages) {
    stageDisplay = `${officialStages} etappes`;
  } else if (distanceKm) {
    const estimatedStages = Math.round(distanceKm / 22); // ~22km per dag
    stageDisplay = `~${estimatedStages} etappes`;
  } else {
    stageDisplay = '? etappes';
  }

  // Progress info
  const completedCount = userTrail.progress?.completedStages?.length || 0;
  if (completedCount > 0) {
    const totalStages = officialStages || Math.round(distanceKm / 22) || '?';
    stageDisplay = `${completedCount} van ${totalStages} etappes`;
  }

  // Get image from userTrail first, then trailInfo
  const imageUrl = userTrail.image || trailInfo.image;

  // Build status dropdown options
  const statusOptions = Object.entries(statusConfig).map(([key, val]) => `
    <button class="status-dropdown-item ${key === userTrail.status ? 'status-dropdown-item--active' : ''}" 
            data-set-status="${key}" data-trail-id="${userTrail.id}">
      <span class="status-dropdown-icon">${val.icon}</span>
      <span class="status-dropdown-label">${val.label}</span>
      ${key === userTrail.status ? '<span class="status-dropdown-check">✓</span>' : ''}
    </button>
  `).join('');

  return `
    <div class="trail-card" 
         data-trail-id="${userTrail.id}" 
         data-json="${escapeHtml(userTrail.jsonUrl)}"
         data-index="${index}"
         draggable="true">
      <div class="trail-card-drag-handle" title="Sleep om te verplaatsen">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="2"></circle>
          <circle cx="15" cy="6" r="2"></circle>
          <circle cx="9" cy="12" r="2"></circle>
          <circle cx="15" cy="12" r="2"></circle>
          <circle cx="9" cy="18" r="2"></circle>
          <circle cx="15" cy="18" r="2"></circle>
        </svg>
      </div>
      ${imageUrl ? `
        <div class="trail-card-image" style="background-image: url('${escapeHtml(imageUrl)}')">
          <div class="trail-card-overlay"></div>
          <button class="trail-card-menu" data-trail-menu="${userTrail.id}" title="Opties">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2"></circle>
              <circle cx="12" cy="12" r="2"></circle>
              <circle cx="12" cy="19" r="2"></circle>
            </svg>
          </button>
          <div class="trail-card-dropdown" id="dropdown-${userTrail.id}">
            <button class="dropdown-item dropdown-item--danger" data-remove-trail="${userTrail.id}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
              </svg>
              Verwijderen
            </button>
          </div>
        </div>
      ` : `
        <div class="trail-card-image trail-card-image--placeholder">
          <div class="trail-card-overlay"></div>
          <button class="trail-card-menu" data-trail-menu="${userTrail.id}" title="Opties">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2"></circle>
              <circle cx="12" cy="12" r="2"></circle>
              <circle cx="12" cy="19" r="2"></circle>
            </svg>
          </button>
          <div class="trail-card-dropdown" id="dropdown-${userTrail.id}">
            <button class="dropdown-item dropdown-item--danger" data-remove-trail="${userTrail.id}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
              </svg>
              Verwijderen
            </button>
          </div>
        </div>
      `}

      <div class="trail-card-content">
        <h3 class="trail-card-title">${escapeHtml(displayName)}</h3>
        ${trailInfo.from && trailInfo.to ? `
          <p class="trail-card-route">${escapeHtml(trailInfo.from)} → ${escapeHtml(trailInfo.to)}</p>
        ` : ''}
      </div>

      <div class="trail-card-footer">
        <div class="trail-card-meta">
          <span class="trail-card-flags">${flags}</span>
          <div class="trail-card-status-wrapper">
            <button class="trail-card-status ${currentStatus.class}" data-status-toggle="${userTrail.id}">
              <span class="status-icon">${currentStatus.icon}</span>
              <span class="status-label">${currentStatus.label}</span>
              <svg class="status-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 9l6 6 6-6"></path>
              </svg>
            </button>
            <div class="status-dropdown" id="status-dropdown-${userTrail.id}">
              ${statusOptions}
            </div>
          </div>
        </div>
        <div class="trail-card-progress">
          ${stageDisplay}
        </div>
      </div>
    </div>
  `;
}

// ====================
// RENDER: TRAIL DASHBOARD
// ====================
async function renderTrailDashboard(userTrail, trailData) {
  state.currentView = 'dashboard';
  state.selectedTrailId = userTrail.id;
  state.currentTrailData = trailData;
  state.currentTrailUrl = userTrail.jsonUrl;

  const norm = normalizeTrail(trailData);
  // Add stages to norm object for widgets
  const officialStages = extractStages(trailData);
  norm.stages = officialStages;
  // Update stageCount if we have actual stages
  if (norm.stages.length > 0) {
    norm.stageCount = String(norm.stages.length);
  }

  const countries = norm.countries;
  const displayName = removeCountryCodeFromName(norm.name, countries);
  const flags = countries.map(c => countryFlags[normalizeCountryCode(c).replace(/[^\w]/g, '')] || '🏳️').join(' ');

  // Load GPX for map widget
  const gpxProfile = await ensureGpxProfileForCurrentTrail();

  // Store gpxProfile in state for modal access
  state.gpxProfile = gpxProfile;

  // Calculate stages based on mode (for widget display)
  if (state.planMode === 'custom' && gpxProfile) {
    // Calculate custom stages based on km per day
    const totalKm = gpxProfile.totalKm || toNumber(norm.totalKm) || 0;
    const customStages = await buildCustomStages(totalKm, state.targetPerDay, gpxProfile);
    state.currentStages = customStages;
  } else {
    // Use official stages with any filters applied
    const filteredStages = filterOfficialStages(officialStages);
    state.currentStages = filteredStages;
  }

  const mainEl = document.getElementById('appMain');
  mainEl.innerHTML = `
    <div class="dashboard-view ${state.dashboardEditMode ? 'dashboard-view--edit-mode' : ''}">
      <!-- Edit Mode Bar -->
      <div class="edit-mode-bar ${state.dashboardEditMode ? 'edit-mode-bar--visible' : ''}">
        <div class="edit-mode-bar-content">
          <span class="edit-mode-title">✏️ Dashboard bewerken</span>
          <p class="edit-mode-hint">Sleep kaarten om te verplaatsen, klik 👁 om te verbergen</p>
        </div>
        <div class="edit-mode-actions">
          <button class="edit-mode-restore-btn" data-open-restore-modal>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            Verborgen kaarten
          </button>
          <button class="edit-mode-done-btn" data-exit-edit-mode>Gereed</button>
        </div>
      </div>

      <!-- Dashboard Header -->
      <div class="dashboard-header">
        <button class="back-btn" id="backToHome">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"></path>
          </svg>
        </button>
        <div class="dashboard-title-section">
          <h1 class="dashboard-title">
            <span class="dashboard-flags">${flags}</span>
            ${escapeHtml(displayName)}
          </h1>
          ${norm.from && norm.to ? `
            <p class="dashboard-subtitle">${escapeHtml(norm.from)} → ${escapeHtml(norm.to)}</p>
          ` : ''}
        </div>
        <div class="dashboard-actions">
          <button class="action-btn" id="editDashboardBtn" title="Kaarten aanpassen" ${state.dashboardEditMode ? 'style="display:none;"' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
          </button>
          <button class="action-btn" id="trailSettingsBtn" title="Trail instellingen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="12" cy="5" r="1"></circle>
              <circle cx="12" cy="19" r="1"></circle>
            </svg>
          </button>
        </div>
      </div>

      <!-- Context Banner (Today's stage) -->
      ${renderContextBanner(userTrail, norm)}

      <!-- Widget Grid - 3 Columns -->
      <div class="widget-grid">
        ${renderWidgetColumns(userTrail.id, gpxProfile, norm)}
      </div>
    </div>
  `;

  // Initialize map after DOM is ready
  setTimeout(() => {
    initDashboardMap(gpxProfile);
  }, 100);
}

// ====================
// RENDER: CONTEXT BANNER
// ====================
function renderContextBanner(userTrail, norm) {
  // If active and has a current stage, show today's info
  if (userTrail.status === 'active' && state.startDate) {
    const stages = norm.stages || [];
    const currentStageIdx = userTrail.progress?.currentStage || 0;
    const stage = stages[currentStageIdx];

    if (stage) {
      const dayNum = currentStageIdx + 1;
      return `
        <div class="context-banner">
          <div class="context-icon">📍</div>
          <div class="context-info">
            <span class="context-label">Vandaag: Dag ${dayNum}</span>
            <span class="context-route">${escapeHtml(stage.from || '')} → ${escapeHtml(stage.to || '')} · ${stage.km || '?'} km</span>
          </div>
          <button class="context-action" id="viewTodayStage">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"></path>
            </svg>
          </button>
        </div>
      `;
    }
  }

  return '';
}

// ====================
// RENDER: MAP WIDGET
// ====================
function renderMapWidget(trailId, gpxProfile, norm) {
  const ws = getWidgetState(trailId, 'map');

  if (ws.hidden) return '';

  const expandBtn = `
    <button class="widget-expand-btn" data-expand-widget="map" title="Volledig scherm">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
      </svg>
    </button>
  `;

  return `
    <div class="widget widget--large widget--map ${ws.collapsed ? 'widget--collapsed' : ''}" data-widget="map" data-trail="${trailId}" ${ws.collapsed ? 'style="height: auto;"' : ''}>
      ${renderWidgetHeader(trailId, 'map', '🗺️', 'Routekaart', expandBtn)}
      <div class="widget-body">
        <div class="dashboard-map-wrapper" id="dashboardMapWrapper">
          <div class="dashboard-map" id="dashboardMap"></div>
        </div>
      </div>
    </div>
  `;
}

// ====================
// RENDER: ROUTE STATS WIDGET
// ====================
function renderRouteStatsWidget(trailId, norm, gpxProfile) {
  const ws = getWidgetState(trailId, 'stats');

  if (ws.hidden) return '';

  // Calculate some stats
  const totalKm = norm.totalKm || gpxProfile?.totalKm || '?';
  const stageCount = norm.stageCount || '?';
  const countries = norm.countries || [];
  const seasons = norm.seasons || [];

  // Calculate elevation if available
  let totalAscent = 0;
  let totalDescent = 0;
  if (gpxProfile?.points) {
    for (let i = 1; i < gpxProfile.points.length; i++) {
      const diff = (gpxProfile.points[i].ele || 0) - (gpxProfile.points[i-1].ele || 0);
      if (diff > 0) totalAscent += diff;
      else totalDescent += Math.abs(diff);
    }
  }

  const countryFlag = countries.length > 0 
    ? countries.map(c => countryFlags[normalizeCountryCode(c).replace(/[^\w]/g, '')] || '🏳️').join(' ')
    : '';

  return `
    <div class="widget widget--large widget--stats ${ws.collapsed ? 'widget--collapsed' : ''}" data-widget="stats" data-trail="${trailId}" ${ws.collapsed ? 'style="height: auto;"' : ''}>
      ${renderWidgetHeader(trailId, 'stats', '📊', 'Statistieken')}
      <div class="widget-body">
        <div class="stats-grid">
          <div class="stats-item">
            <span class="stats-value">${typeof totalKm === 'number' ? formatKm(totalKm) : totalKm}</span>
            <span class="stats-label">kilometer</span>
          </div>
          <div class="stats-item">
            <span class="stats-value">${stageCount}</span>
            <span class="stats-label">etappes</span>
          </div>
          ${totalAscent > 0 ? `
          <div class="stats-item">
            <span class="stats-value">↑ ${Math.round(totalAscent)}</span>
            <span class="stats-label">m stijging</span>
          </div>
          ` : ''}
          ${totalDescent > 0 ? `
          <div class="stats-item">
            <span class="stats-value">↓ ${Math.round(totalDescent)}</span>
            <span class="stats-label">m daling</span>
          </div>
          ` : ''}
          ${norm.from ? `
          <div class="stats-item">
            <span class="stats-value">🚩 ${escapeHtml(norm.from)}</span>
            <span class="stats-label">startpunt</span>
          </div>
          ` : ''}
          ${norm.to ? `
          <div class="stats-item">
            <span class="stats-value">🏁 ${escapeHtml(norm.to)}</span>
            <span class="stats-label">eindpunt</span>
          </div>
          ` : ''}
          ${countryFlag ? `
          <div class="stats-item">
            <span class="stats-value">${countryFlag}</span>
            <span class="stats-label">${countries.length === 1 ? '1 land' : countries.length + ' landen'}</span>
          </div>
          ` : ''}
          ${seasons.length > 0 ? `
          <div class="stats-item">
            <span class="stats-value">🌤️ ${seasonsToMonths(seasons)}</span>
            <span class="stats-label">beste periode</span>
          </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

// ====================
// RENDER: ROUTE DESCRIPTION WIDGET
// ====================
function renderRouteDescriptionWidget(trailId, norm) {
  const ws = getWidgetState(trailId, 'description');

  if (ws.hidden) return '';

  const description = norm.description || state.currentTrailData?.description || '';
  const descriptionFull = state.currentTrailData?.description_full || '';

  if (!description) return ''; // Don't show widget if no description

  const hasFullDescription = descriptionFull.length > 0;

  return `
    <div class="widget widget--large widget--description ${ws.collapsed ? 'widget--collapsed' : ''}" data-widget="description" data-trail="${trailId}" ${ws.collapsed ? 'style="height: auto;"' : ''}>
      ${renderWidgetHeader(trailId, 'description', '📝', 'Over deze route')}
      <div class="widget-body">
        <p class="description-text ${hasFullDescription ? 'description-text--clickable' : ''}" ${hasFullDescription ? 'data-open-description-modal' : ''}>${escapeHtml(description)}</p>
        ${hasFullDescription ? '<p class="description-read-more" data-open-description-modal>Lees meer →</p>' : ''}
      </div>
    </div>
  `;
}

// ====================
// DESCRIPTION MODAL
// ====================
function openDescriptionModal() {
  const descriptionFull = state.currentTrailData?.description_full || '';
  const trailName = state.currentTrailData?.name || 'Route';

  if (!descriptionFull) return;

  // Parse markdown-like formatting
  const formattedText = formatDescriptionText(descriptionFull);

  const modal = document.createElement('div');
  modal.className = 'description-modal-overlay';
  modal.innerHTML = `
    <div class="description-modal">
      <div class="description-modal-header">
        <h2 class="description-modal-title">${escapeHtml(trailName)}</h2>
        <button class="description-modal-close" data-close-modal>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div class="description-modal-body">
        ${formattedText}
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  // Animate in
  requestAnimationFrame(() => {
    modal.classList.add('description-modal-overlay--visible');
  });

  // Close handlers
  modal.querySelector('[data-close-modal]').addEventListener('click', closeDescriptionModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeDescriptionModal();
  });
  document.addEventListener('keydown', handleModalEscape);
}

function closeDescriptionModal() {
  const modal = document.querySelector('.description-modal-overlay');
  if (!modal) return;

  modal.classList.remove('description-modal-overlay--visible');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleModalEscape);

  setTimeout(() => modal.remove(), 300);
}

function handleModalEscape(e) {
  if (e.key === 'Escape') closeDescriptionModal();
}

function formatDescriptionText(text) {
  // Split into paragraphs
  const paragraphs = text.split('\n').filter(p => p.trim());

  let html = '';
  let inList = false;

  for (const p of paragraphs) {
    const trimmed = p.trim();

    // Check for headers (lines ending with specific patterns or all caps short lines)
    if (trimmed.match(/^[A-Z][^.!?]*[A-Za-z]$/) && trimmed.length < 60 && !trimmed.startsWith('*')) {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      html += `<h3 class="modal-heading">${escapeHtml(trimmed)}</h3>`;
    }
    // Check for list items
    else if (trimmed.startsWith('*')) {
      if (!inList) {
        html += '<ul class="modal-list">';
        inList = true;
      }
      const content = trimmed.slice(1).trim();
      // Check for bold prefix (text before colon)
      if (content.includes(':')) {
        const [bold, ...rest] = content.split(':');
        html += `<li><strong>${escapeHtml(bold)}:</strong>${escapeHtml(rest.join(':'))}</li>`;
      } else {
        html += `<li>${escapeHtml(content)}</li>`;
      }
    }
    // Regular paragraph
    else {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      html += `<p>${escapeHtml(trimmed)}</p>`;
    }
  }

  if (inList) html += '</ul>';

  return html;
}

// ====================
// PHOTO CAROUSEL FUNCTIONS
// ====================
function navigateCarousel(carousel, direction) {
  const track = carousel.querySelector('.carousel-track');
  const slides = carousel.querySelectorAll('.carousel-slide');
  const dots = carousel.querySelectorAll('.carousel-dot');

  if (!track || slides.length === 0) return;

  // Get current slide index
  const slideWidth = slides[0].offsetWidth;
  let currentIndex = Math.round(track.scrollLeft / slideWidth);

  // Calculate new index
  let newIndex = currentIndex + direction;
  if (newIndex < 0) newIndex = slides.length - 1;
  if (newIndex >= slides.length) newIndex = 0;

  // Scroll to new slide
  track.scrollTo({
    left: newIndex * slideWidth,
    behavior: 'smooth'
  });

  // Update dots
  updateCarouselDots(dots, newIndex);
}

function goToSlide(carousel, index) {
  const track = carousel.querySelector('.carousel-track');
  const slides = carousel.querySelectorAll('.carousel-slide');
  const dots = carousel.querySelectorAll('.carousel-dot');

  if (!track || slides.length === 0 || index >= slides.length) return;

  const slideWidth = slides[0].offsetWidth;

  track.scrollTo({
    left: index * slideWidth,
    behavior: 'smooth'
  });

  updateCarouselDots(dots, index);
}

function updateCarouselDots(dots, activeIndex) {
  dots.forEach((dot, idx) => {
    dot.classList.toggle('carousel-dot--active', idx === activeIndex);
  });
}

function openPhotoFullscreen(src, alt) {
  const overlay = document.createElement('div');
  overlay.className = 'photo-fullscreen-overlay';
  overlay.innerHTML = `
    <button class="photo-fullscreen-close">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6 6 18M6 6l12 12"></path>
      </svg>
    </button>
    <img src="${src}" alt="${alt || 'Foto'}" class="photo-fullscreen-img" />
  `;

  // Close on click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.photo-fullscreen-close')) {
      overlay.remove();
    }
  });

  // Close on escape
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('photo-fullscreen-overlay--open'));
}

// ====================
// FULL MAP MODAL (Dashboard)
// ====================
let fullMapInstance = null;
let fullMapPoiLayer = null;

function openFullMapModal() {
  const gpxProfile = state.gpxProfile;
  const trailName = state.currentTrailData?.name || 'Route';

  if (!gpxProfile?.points?.length) {
    console.warn('No gpxProfile available for map modal');
    return;
  }

  // Get saved filter preferences
  const savedFilters = state.fullMapModalFilters;
  const enabledTypes = savedFilters.enabledTypes;
  const maxDistance = savedFilters.maxDistance;
  const distanceDisplay = maxDistance >= 1000 ? `${(maxDistance/1000).toFixed(1)}km` : `${maxDistance}m`;

  // POI types for the filter
  const poiTypes = [
    { key: 'camping', icon: '⛺', label: 'Camping' },
    { key: 'hotel', icon: '🏨', label: 'Hotel' },
    { key: 'station', icon: '🚂', label: 'Station' },
    { key: 'restaurant', icon: '🍽️', label: 'Restaurant' },
    { key: 'supermarket', icon: '🛒', label: 'Supermarkt' },
    { key: 'water', icon: '💧', label: 'Water' },
    { key: 'bakery', icon: '🥐', label: 'Bakkerij' },
    { key: 'pharmacy', icon: '💊', label: 'Apotheek' },
    { key: 'picnic', icon: '🧺', label: 'Picknick' },
    { key: 'bench', icon: '🪑', label: 'Bankje' },
  ];

  const modal = document.createElement('div');
  modal.className = 'map-modal-overlay';
  modal.innerHTML = `
    <div class="map-modal">
      <div class="map-modal-header">
        <h2 class="map-modal-title">🗺️ ${escapeHtml(trailName)}</h2>
        <button class="map-modal-close" data-close-full-map>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div class="map-modal-body">
        <div class="map-modal-map" id="fullMapModalMap"></div>
        <div class="map-modal-sidebar">
          <div class="poi-filter-panel">
            <h3 class="poi-filter-title">📍 POI Types</h3>
            <div class="poi-filter-list">
              ${poiTypes.slice(0, 3).map(p => `
                <label class="poi-filter-item">
                  <input type="checkbox" class="full-map-poi-filter" value="${p.key}" ${enabledTypes.includes(p.key) ? 'checked' : ''}>
                  <span class="poi-filter-icon">${p.icon}</span>
                  <span class="poi-filter-label">${p.label}</span>
                </label>
              `).join('')}
            </div>
            <div class="poi-filter-divider"></div>
            <div class="poi-filter-list">
              ${poiTypes.slice(3).map(p => `
                <label class="poi-filter-item">
                  <input type="checkbox" class="full-map-poi-filter" value="${p.key}" ${enabledTypes.includes(p.key) ? 'checked' : ''}>
                  <span class="poi-filter-icon">${p.icon}</span>
                  <span class="poi-filter-label">${p.label}</span>
                </label>
              `).join('')}
            </div>
            <div class="poi-filter-divider"></div>
            <div class="poi-distance-filter">
              <div class="poi-distance-header">
                <span class="poi-distance-icon">📏</span>
                <span class="poi-distance-label">Max afstand</span>
                <span class="poi-distance-value" id="fullMapDistanceValue">${distanceDisplay}</span>
              </div>
              <input type="range" class="poi-distance-slider" id="fullMapDistanceSlider" min="100" max="5000" value="${maxDistance}" step="100">
              <div class="poi-distance-range">
                <span>100m</span>
                <span>5km</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  // Animate in
  requestAnimationFrame(() => {
    modal.classList.add('map-modal-overlay--visible');
  });

  // Initialize map after modal is visible
  setTimeout(() => {
    initFullMapModal(gpxProfile);
  }, 100);

  // Event handlers
  modal.querySelector('[data-close-full-map]').addEventListener('click', closeFullMapModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeFullMapModal();
  });
  document.addEventListener('keydown', handleFullMapEscape);

  // POI filter handlers - save state on change
  modal.querySelectorAll('.full-map-poi-filter').forEach(cb => {
    cb.addEventListener('change', () => {
      // Update saved filter state
      const enabledTypes = [];
      modal.querySelectorAll('.full-map-poi-filter:checked').forEach(checked => {
        enabledTypes.push(checked.value);
      });
      state.fullMapModalFilters.enabledTypes = enabledTypes;
      updateFullMapPOIs();
    });
  });

  // Distance slider handler - save state on change
  const slider = modal.querySelector('#fullMapDistanceSlider');
  const valueDisplay = modal.querySelector('#fullMapDistanceValue');
  slider.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    valueDisplay.textContent = value >= 1000 ? `${(value/1000).toFixed(1)}km` : `${value}m`;
    state.fullMapModalFilters.maxDistance = value;
    updateFullMapPOIs();
  });
}

// ====================
// WIDGET MANAGER MODAL
// ====================
function openWidgetManagerModal() {
  const trailId = state.selectedTrailId;
  if (!trailId) return;

  // All available widgets
  const widgets = [
    { id: 'map', icon: '🗺️', name: 'Routekaart' },
    { id: 'stats', icon: '📊', name: 'Statistieken' },
    { id: 'description', icon: '📝', name: 'Over deze route' },
    { id: 'stages', icon: '📅', name: 'Reis Kalender' },
    { id: 'planner', icon: '🥾', name: 'Maak je eigen route' },
    { id: 'tools', icon: '🧰', name: 'Tools' },
    { id: 'journal', icon: '📓', name: 'Dagboek' },
    { id: 'photos', icon: '📸', name: "Foto's" },
  ];

  // Check which are hidden
  const widgetStates = widgets.map(w => ({
    ...w,
    hidden: getWidgetState(trailId, w.id).hidden
  }));

  const hiddenCount = widgetStates.filter(w => w.hidden).length;

  // Check if layout is customized
  const layoutKey = `${trailId}_layout`;
  const hasCustomLayout = !!state.widgetStates[layoutKey];

  // Remove existing modal if present
  document.querySelector('.widget-manager-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'widget-manager-modal';
  modal.innerHTML = `
    <div class="widget-manager-content">
      <div class="widget-manager-header">
        <h3>Verborgen kaarten</h3>
        <button class="widget-manager-close" data-close-widget-manager>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div class="widget-manager-body">
        ${hiddenCount > 0 ? `
          <p class="widget-manager-info">Klik om kaarten terug te zetten:</p>
          <div class="widget-manager-list">
            ${widgetStates.filter(w => w.hidden).map(w => `
              <button class="widget-manager-item" data-show-widget="${w.id}" data-trail="${trailId}">
                <span class="widget-manager-icon">${w.icon}</span>
                <span class="widget-manager-name">${w.name}</span>
                <span class="widget-manager-action">Tonen</span>
              </button>
            `).join('')}
          </div>
        ` : `
          <p class="widget-manager-empty">Alle kaarten zijn zichtbaar.</p>
        `}

        ${hasCustomLayout || hiddenCount > 0 ? `
          <div class="widget-manager-footer">
            <button class="widget-manager-reset" data-reset-widgets data-trail="${trailId}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                <path d="M3 3v5h5"></path>
              </svg>
              Reset naar standaard
            </button>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Animation
  requestAnimationFrame(() => {
    modal.classList.add('widget-manager-modal--open');
  });

  // Close handlers
  modal.querySelector('[data-close-widget-manager]').addEventListener('click', closeWidgetManagerModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeWidgetManagerModal();
  });

  // Show widget handlers
  modal.querySelectorAll('[data-show-widget]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const widgetId = btn.dataset.showWidget;
      const trailId = btn.dataset.trail;

      setWidgetState(trailId, widgetId, { hidden: false });

      // Refresh modal to update list
      openWidgetManagerModal();
    });
  });

  // Reset handler
  const resetBtn = modal.querySelector('[data-reset-widgets]');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const trailId = resetBtn.dataset.trail;

      // Reset layout to default
      const layoutKey = `${trailId}_layout`;
      delete state.widgetStates[layoutKey];

      // Reset all widget hidden states
      ['map', 'stats', 'description', 'stages', 'planner', 'tools', 'journal', 'photos'].forEach(widgetId => {
        setWidgetState(trailId, widgetId, { hidden: false });
      });

      savePreferences();
      closeWidgetManagerModal();
    });
  }
}

function closeWidgetManagerModal() {
  const modal = document.querySelector('.widget-manager-modal');
  if (modal) {
    modal.classList.remove('widget-manager-modal--open');
    setTimeout(() => modal.remove(), 200);

    // Re-render dashboard
    const userTrail = state.userTrails.find(t => t.id === state.selectedTrailId);
    if (userTrail && state.currentTrailData) {
      renderTrailDashboard(userTrail, state.currentTrailData);
    }
  }
}

function initFullMapModal(gpxProfile) {
  const mapContainer = document.getElementById('fullMapModalMap');
  if (!mapContainer) return;

  // Create map
  fullMapInstance = L.map('fullMapModalMap', {
    zoomControl: true,
    scrollWheelZoom: true
  });

  // Add tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(fullMapInstance);

  // Create POI layer
  fullMapPoiLayer = L.layerGroup().addTo(fullMapInstance);

  // Draw route
  const coords = gpxProfile.points.map(p => [p.lat, p.lon]);
  const routeLine = L.polyline(coords, {
    color: '#5B7C99',
    weight: 4,
    opacity: 1
  }).addTo(fullMapInstance);

  // Fit bounds
  fullMapInstance.fitBounds(routeLine.getBounds(), { padding: [30, 30] });

  // Add start/end markers
  if (coords.length > 0) {
    L.marker(coords[0], {
      icon: L.divIcon({
        className: 'map-modal-marker map-modal-marker--start',
        html: '🚩',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    }).addTo(fullMapInstance);

    L.marker(coords[coords.length - 1], {
      icon: L.divIcon({
        className: 'map-modal-marker map-modal-marker--end',
        html: '🏁',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    }).addTo(fullMapInstance);
  }

  // Render initial POIs
  updateFullMapPOIs();
}

function updateFullMapPOIs() {
  if (!fullMapInstance || !fullMapPoiLayer) return;

  const gpxProfile = state.gpxProfile;
  if (!gpxProfile) return;

  // Get enabled types
  const enabledTypes = [];
  document.querySelectorAll('.full-map-poi-filter:checked').forEach(cb => {
    enabledTypes.push(cb.value);
  });

  // Get distance
  const slider = document.getElementById('fullMapDistanceSlider');
  const maxDistanceKm = slider ? parseInt(slider.value) / 1000 : 1.5;

  // Render POIs
  renderPOIMarkers(fullMapInstance, fullMapPoiLayer, gpxProfile, enabledTypes, maxDistanceKm);
}

function closeFullMapModal() {
  const modal = document.querySelector('.map-modal-overlay');
  if (!modal) return;

  modal.classList.remove('map-modal-overlay--visible');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleFullMapEscape);

  // Cleanup map
  if (fullMapInstance) {
    fullMapInstance.remove();
    fullMapInstance = null;
    fullMapPoiLayer = null;
  }

  setTimeout(() => modal.remove(), 300);
}

function handleFullMapEscape(e) {
  if (e.key === 'Escape') closeFullMapModal();
}

// ====================
// RENDER: STAGES WIDGET
// ====================
function renderStagesWidget(trailId, norm) {
  const ws = getWidgetState(trailId, 'stages');

  if (ws.hidden) return '';

  const allStages = norm.stages || [];

  // Determine which stages to use based on planner settings
  let plannerStages = allStages;
  let stagesLabel = 'Officieel';

  if (state.planMode === 'custom' && state.currentStages && state.currentStages.length > 0) {
    plannerStages = state.currentStages;
    stagesLabel = 'Eigen etappes';
  } else if (state.startStage !== null || state.endStage !== null) {
    const startIdx = state.startStage !== null ? state.startStage : 0;
    const endIdx = state.endStage !== null ? state.endStage : allStages.length - 1;
    plannerStages = allStages.slice(startIdx, endIdx + 1);
    stagesLabel = 'Selectie';
  }

  const totalStagesCount = plannerStages.length;
  const completedCount = getCompletedStagesCount(trailId);
  const completedStages = getCompletedStages(trailId);

  // Calculate dates for mini calendar
  const startDate = state.startDate || new Date().toISOString().split('T')[0];
  const calendarItems = calculateDayDates(startDate, plannerStages, state.restDays || {});

  // Build mini calendar HTML
  const miniCalendarHtml = renderMiniCalendar(trailId, calendarItems, plannerStages, completedStages);

  const settingsBtn = `
    <button class="widget-settings-btn" data-settings="stages" title="Etappe instellingen">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </svg>
    </button>
  `;

  return `
    <div class="widget widget--large widget--stages ${ws.collapsed ? 'widget--collapsed' : ''}" data-widget="stages" data-trail="${trailId}" ${ws.collapsed ? 'style="height: auto;"' : ''}>
      ${renderWidgetHeader(trailId, 'stages', '📅', 'Reis Kalender', settingsBtn)}
      <div class="widget-body">
        <div class="stages-mode-indicator">
          <span class="stages-mode-label">${stagesLabel}</span>
          <span class="stages-mode-count">${completedCount} / ${totalStagesCount} gelopen</span>
        </div>

        ${miniCalendarHtml}

        <button class="widget-more-btn" data-view-all="stages">
          Bekijk volledige kalender
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"></path>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function renderMiniCalendar(trailId, calendarItems, plannerStages, completedStages) {
  // Group by month
  const months = {};

  calendarItems.forEach((item, idx) => {
    const d = new Date(item.date);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    if (!months[monthKey]) {
      months[monthKey] = {
        year: d.getFullYear(),
        month: d.getMonth(),
        monthName: d.toLocaleDateString('nl-NL', { month: 'short' }),
        days: {}
      };
    }

    const dayOfMonth = d.getDate();

    if (item.type === 'stage') {
      const stage = plannerStages[item.index];
      const realIdx = stage?.index !== undefined ? stage.index - 1 : item.index;
      const isCompleted = completedStages.includes(realIdx);
      const km = stage?.km ? (typeof stage.km === 'number' ? Math.round(stage.km) : stage.km) : '?';

      months[monthKey].days[dayOfMonth] = {
        type: 'stage',
        km: km,
        isCompleted,
        realIndex: realIdx
      };
    } else if (item.type === 'rest') {
      months[monthKey].days[dayOfMonth] = {
        type: 'rest'
      };
    }
  });

  // Render only first 2 months in widget
  const monthKeys = Object.keys(months).sort().slice(0, 2);

  let html = '<div class="mini-calendar"><div class="mini-calendar-months">';

  monthKeys.forEach(monthKey => {
    const monthData = months[monthKey];
    html += renderMiniCalendarMonth(trailId, monthData);
  });

  html += '</div></div>';
  return html;
}

function renderMiniCalendarMonth(trailId, monthData) {
  const { year, month, monthName, days } = monthData;

  // Get first day of month and total days
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const totalDays = lastDay.getDate();

  // Get day of week for first day (Monday = 0)
  let startDayOfWeek = firstDay.getDay() - 1;
  if (startDayOfWeek < 0) startDayOfWeek = 6;

  // Build weeks
  const weeks = [];
  let currentWeek = [];

  // Add empty cells for days before month starts
  for (let i = 0; i < startDayOfWeek; i++) {
    currentWeek.push({ empty: true });
  }

  // Add all days
  for (let day = 1; day <= totalDays; day++) {
    const dayData = days[day] || { type: 'inactive' };
    currentWeek.push({ ...dayData, dayNumber: day });

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  // Fill remaining
  while (currentWeek.length > 0 && currentWeek.length < 7) {
    currentWeek.push({ empty: true });
  }
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  return `
    <div class="mini-calendar-month">
      <div class="mini-calendar-month-label">${monthName}</div>
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 4px;">
        <span style="text-align: center; font-size: 9px; font-weight: 600; color: #888;">M</span>
        <span style="text-align: center; font-size: 9px; font-weight: 600; color: #888;">D</span>
        <span style="text-align: center; font-size: 9px; font-weight: 600; color: #888;">W</span>
        <span style="text-align: center; font-size: 9px; font-weight: 600; color: #888;">D</span>
        <span style="text-align: center; font-size: 9px; font-weight: 600; color: #888;">V</span>
        <span style="text-align: center; font-size: 9px; font-weight: 600; color: #888;">Z</span>
        <span style="text-align: center; font-size: 9px; font-weight: 600; color: #888;">Z</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px;">
        ${weeks.map(week => `
          <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;">
            ${week.map(day => renderMiniCalendarDay(trailId, day)).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderMiniCalendarDay(trailId, day) {
  const baseStyle = "aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 500; border-radius: 4px; min-height: 28px; cursor: pointer;";

  if (day.empty) {
    return `<div style="${baseStyle} background: transparent;"></div>`;
  }

  if (day.type === 'stage') {
    const bgColor = day.isCompleted ? '#5B7C99' : 'rgba(255,255,255,0.7)';
    const textColor = day.isCompleted ? 'white' : '#333';
    const border = day.isCompleted ? 'none' : '1px solid rgba(0,0,0,0.08)';
    return `
      <div style="${baseStyle} background: ${bgColor}; color: ${textColor}; border: ${border};" 
           data-open-stage="${day.realIndex}" data-trail="${trailId}" 
           title="${day.km} km">
        ${day.km}
      </div>
    `;
  }

  if (day.type === 'rest') {
    return `<div style="${baseStyle} background: rgba(255,255,255,0.5); font-size: 12px;" title="Rustdag">😴</div>`;
  }

  // Inactive day
  return `<div style="${baseStyle} background: transparent; color: #ccc; cursor: default;">${day.dayNumber}</div>`;
}

// ====================
// RENDER: BYO PLANNER WIDGET
// ====================
function renderPlannerWidget(trailId, norm) {
  const ws = getWidgetState(trailId, 'planner');

  if (ws.hidden) return '';

  return `
    <div class="widget widget--medium widget--planner ${ws.collapsed ? 'widget--collapsed' : ''}" data-widget="planner" data-trail="${trailId}" ${ws.collapsed ? 'style="height: auto;"' : ''}>
      ${renderWidgetHeader(trailId, 'planner', '🛠️', 'Maak je eigen route')}
      <div class="widget-body">
        <div class="byo-planner-intro">
          <p class="byo-planner-text">
            Pas etappes aan op je eigen tempo, vind overnachtingsplekken en plan stops onderweg.
          </p>
          <ul class="byo-planner-features">
            <li>📏 Eigen dagafstand</li>
            <li>🏕️ Campings & hotels</li>
            <li>😴 Rustdagen inplannen</li>
            <li>📍 Eindpunten aanpassen</li>
            <li>🥐 Bakkers & winkels</li>
            <li>🪑 Pauzeplekken</li>
          </ul>
        </div>
        <button class="widget-action-btn" id="openFullPlanner">
          <span>Start route planner</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"></path>
          </svg>
        </button>
      </div>
    </div>
  `;
}

// ====================
// RENDER: TOOLS WIDGET (Hiking OS)
// ====================
function renderToolsWidget(trailId) {
  const ws = getWidgetState(trailId, 'tools');

  if (ws.hidden) return '';

  return `
    <div class="widget widget--medium widget--tools ${ws.collapsed ? 'widget--collapsed' : ''}" data-widget="tools" data-trail="${trailId}" ${ws.collapsed ? 'style="height: auto;"' : ''}>
      ${renderWidgetHeader(trailId, 'tools', '🧰', 'Tools')}
      <div class="widget-body">
        <div class="tools-grid">
          <button class="tool-btn" data-tool="sos">
            <span class="tool-icon">🆘</span>
            <span class="tool-label">SOS</span>
          </button>
          <button class="tool-btn" data-tool="firstaid">
            <span class="tool-icon">🩹</span>
            <span class="tool-label">EHBO</span>
          </button>
          <button class="tool-btn" data-tool="torch">
            <span class="tool-icon">🔦</span>
            <span class="tool-label">Lamp</span>
          </button>
          <button class="tool-btn" data-tool="compass">
            <span class="tool-icon">🧭</span>
            <span class="tool-label">Kompas</span>
          </button>
          <button class="tool-btn" data-tool="weather">
            <span class="tool-icon">🌤️</span>
            <span class="tool-label">Weer</span>
          </button>
          <button class="tool-btn" data-tool="journal" data-open-journal>
            <span class="tool-icon">📓</span>
            <span class="tool-label">Dagboek</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

// ====================
// RENDER: JOURNAL WIDGET
// ====================
function renderJournalWidget(trailId, norm) {
  const ws = getWidgetState(trailId, 'journal');

  if (ws.hidden) return '';

  const userTrail = state.userTrails.find(t => t.id === trailId);
  const journalStats = getJournalStats(trailId);
  const stages = norm.stages || [];
  const completedCount = getCompletedStagesCount(trailId);

  // Calculate cumulative km up to last entry
  let lastEntryInfo = '';
  if (journalStats.lastEntry) {
    const lastStage = stages[journalStats.lastEntry.stageIndex];
    if (lastStage) {
      lastEntryInfo = `${lastStage.from} → ${lastStage.to}`;
    }
  }

  // How many completed stages still need a story?
  const completedStages = getCompletedStages(trailId);
  const entriesWritten = journalStats.entryCount;
  const needsStory = completedCount - entriesWritten;

  return `
    <div class="widget widget--small widget--journal ${ws.collapsed ? 'widget--collapsed' : ''}" data-widget="journal" data-trail="${trailId}" ${ws.collapsed ? 'style="height: auto;"' : ''}>
      ${renderWidgetHeader(trailId, 'journal', '📓', 'Dagboek')}
      <div class="widget-body">
        <div class="journal-summary">
          <div class="journal-stat">
            <span class="journal-stat-value">${entriesWritten}</span>
            <span class="journal-stat-label">verhalen</span>
          </div>
          <div class="journal-stat">
            <span class="journal-stat-value">${completedCount}</span>
            <span class="journal-stat-label">gelopen</span>
          </div>
        </div>
        ${needsStory > 0 ? `
          <p class="journal-todo">${needsStory} etappe${needsStory > 1 ? 's' : ''} wacht${needsStory > 1 ? 'en' : ''} op een verhaal</p>
        ` : lastEntryInfo ? `
          <p class="journal-last-entry">Laatste: ${escapeHtml(lastEntryInfo)}</p>
        ` : completedCount === 0 ? `
          <p class="journal-empty">Vink eerst etappes aan als gelopen</p>
        ` : `
          <p class="journal-complete">✓ Alle verhalen geschreven!</p>
        `}
        <button class="widget-action-btn" data-open-journal>
          <span>Open dagboek</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"></path>
          </svg>
        </button>
      </div>
    </div>
  `;
}

// ====================
// RENDER: PHOTOS CAROUSEL WIDGET
// ====================
function renderPhotosWidget(trailId, norm) {
  const ws = getWidgetState(trailId, 'photos');


  if (ws.hidden) return '';

  // Get images from trail data - also check state.currentTrailData directly
  let images = norm?.images || [];

  // Fallback: check state.currentTrailData directly
  if (images.length === 0 && state.currentTrailData?.images) {
    images = state.currentTrailData.images;
  }


  // If no images, don't show widget
  if (images.length === 0) {
    return '';
  }

  const imagesHtml = images.map((img, idx) => `
    <div class="carousel-slide" data-slide="${idx}">
      <img src="${img}" alt="Foto ${idx + 1}" loading="lazy" />
    </div>
  `).join('');

  const dotsHtml = images.length > 1 ? `
    <div class="carousel-dots">
      ${images.map((_, idx) => `<button class="carousel-dot ${idx === 0 ? 'carousel-dot--active' : ''}" data-dot="${idx}"></button>`).join('')}
    </div>
  ` : '';

  const widgetHtml = `
    <div class="widget widget--medium widget--photos ${ws.collapsed ? 'widget--collapsed' : ''}" data-widget="photos" data-trail="${trailId}" ${ws.collapsed ? 'style="height: auto;"' : ''}>
      ${renderWidgetHeader(trailId, 'photos', '📸', "Foto's")}
      <div class="widget-body">
        <div class="photos-carousel" data-trail-photos="${trailId}">
          <div class="carousel-track">
            ${imagesHtml}
          </div>
          ${images.length > 1 ? `
            <button class="carousel-btn carousel-btn--prev" data-carousel-prev>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 18l-6-6 6-6"></path>
              </svg>
            </button>
            <button class="carousel-btn carousel-btn--next" data-carousel-next>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"></path>
              </svg>
            </button>
          ` : ''}
          ${dotsHtml}
        </div>
        <p class="photos-count">${images.length} foto${images.length !== 1 ? "'s" : ''}</p>
      </div>
    </div>
  `;

  return widgetHtml;
}

// ====================
// JOURNAL VIEW
// ====================
function renderJournalView() {
  const trailId = state.selectedTrailId;
  const userTrail = state.userTrails.find(t => t.id === trailId);
  const trailData = state.currentTrailData;

  if (!userTrail || !trailData) return;

  const norm = normalizeTrail(trailData);
  // Get stages using extractStages (same as dashboard)
  const stages = extractStages(trailData);
  const journalEntries = userTrail.journal?.entries || [];
  const completedStages = getCompletedStages(trailId);

  // Calculate cumulative km for each stage
  let cumulativeKm = 0;
  const stagesWithCumulative = stages.map((stage, idx) => {
    cumulativeKm += parseFloat(stage.km) || 0;
    const entry = journalEntries.find(e => e.stageIndex === idx);
    const isCompleted = completedStages.includes(idx);
    return {
      ...stage,
      index: idx,
      cumulativeKm: cumulativeKm.toFixed(1),
      hasEntry: !!entry,
      entry,
      isCompleted
    };
  });

  // Split into completed and not-completed
  const completedWithData = stagesWithCumulative.filter(s => s.isCompleted);
  const notCompleted = stagesWithCumulative.filter(s => !s.isCompleted);

  const mainEl = document.getElementById('appMain');
  mainEl.innerHTML = `
    <div class="journal-view">
      <div class="journal-header">
        <button class="back-btn" data-back-to-dashboard>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"></path>
          </svg>
        </button>
        <div class="journal-header-info">
          <h1 class="journal-title">📓 Dagboek</h1>
          <p class="journal-subtitle">${escapeHtml(norm.name)} · ${journalEntries.length} verhalen van ${completedStages.length} gelopen etappes</p>
        </div>
      </div>

      ${completedWithData.length > 0 ? `
        <div class="journal-section">
          <h2 class="journal-section-title">Gelopen etappes</h2>
          <div class="journal-entries">
            ${completedWithData.map(stage => renderJournalEntryCard(trailId, stage)).join('')}
          </div>
        </div>
      ` : `
        <div class="journal-empty-state">
          <div class="journal-empty-icon">🥾</div>
          <h3>Nog geen etappes gelopen</h3>
          <p>Ga naar de Etappes widget en vink aan welke etappes je hebt gelopen. Daarna kun je hier je verhalen schrijven!</p>
          <button class="btn btn--primary" data-back-to-dashboard>
            Terug naar dashboard
          </button>
        </div>
      `}

      ${notCompleted.length > 0 && completedWithData.length > 0 ? `
        <div class="journal-section journal-section--upcoming">
          <h2 class="journal-section-title">Nog te lopen (${notCompleted.length})</h2>
          <div class="journal-entries journal-entries--dimmed">
            ${notCompleted.slice(0, 3).map(stage => renderJournalEntryCard(trailId, stage, true)).join('')}
            ${notCompleted.length > 3 ? `
              <p class="journal-more-stages">+ ${notCompleted.length - 3} meer etappes</p>
            ` : ''}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  state.currentView = 'journal';
}

// ====================
// CALENDAR MODAL
// ====================
function openCalendarModal() {
  const trailId = state.selectedTrailId;
  const userTrail = state.userTrails.find(t => t.id === trailId);
  const trailData = state.currentTrailData;

  if (!userTrail || !trailData) return;

  const norm = normalizeTrail(trailData);
  const stages = extractStages(trailData);
  const completedStages = getCompletedStages(trailId);
  const journalEntries = userTrail.journal?.entries || [];

  // Use current planner stages if in custom mode, otherwise official
  const plannerStages = (state.planMode === 'custom' && state.currentStages?.length > 0) 
    ? state.currentStages 
    : stages;

  // Calculate dates - use startDate or default to today for preview
  const startDate = state.startDate || new Date().toISOString().split('T')[0];
  const calendarItems = calculateDayDates(startDate, plannerStages, state.restDays || {});

  // Calculate total days including rest days
  const totalRestDays = Object.values(state.restDays || {}).reduce((sum, n) => sum + n, 0);

  // Calculate arrival date
  let arrivalDate = null;
  if (calendarItems.length > 0) {
    const lastItem = calendarItems[calendarItems.length - 1];
    arrivalDate = lastItem.date;
  }

  // Enrich stages with completion info
  const enrichedStages = plannerStages.map((stage, idx) => {
    const realIdx = stage.index !== undefined ? stage.index - 1 : idx;
    const isCompleted = completedStages.includes(realIdx);
    const hasJournalEntry = journalEntries.some(e => e.stageIndex === realIdx);
    return {
      ...stage,
      index: idx,
      realIndex: realIdx,
      isCompleted,
      hasJournalEntry
    };
  });

  // Build calendar grid data
  const calendarGridData = buildCalendarGrid(calendarItems, enrichedStages);

  // Remove existing modal
  document.querySelector('.calendar-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'calendar-modal';
  modal.innerHTML = `
    <div class="calendar-modal-content">
      <button class="calendar-modal-close" data-close-calendar>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"></path>
        </svg>
      </button>

      <div class="calendar-modal-header">
        <h1 class="calendar-title">📅 Reis Kalender</h1>
        <p class="calendar-subtitle">${escapeHtml(norm.name)} · ${plannerStages.length} dagen ${totalRestDays > 0 ? `+ ${totalRestDays} rust` : ''}</p>
      </div>

      <!-- Calendar Summary -->
      <div class="calendar-summary" style="display: flex; gap: 24px; margin-bottom: 24px; padding: 16px 20px; background: #f8f8f8; border-radius: 12px; flex-wrap: wrap;">
        <div style="text-align: center;">
          <span style="display: block; font-size: 14px; font-weight: 600; color: #333;">${formatCalendarDateLong(startDate)}</span>
          <span style="display: block; font-size: 11px; color: #888; text-transform: uppercase;">vertrek</span>
        </div>
        <div style="text-align: center;">
          <span style="display: block; font-size: 14px; font-weight: 600; color: #333;">${formatCalendarDateLong(arrivalDate)}</span>
          <span style="display: block; font-size: 11px; color: #888; text-transform: uppercase;">aankomst</span>
        </div>
        <div style="text-align: center;">
          <span style="display: block; font-size: 14px; font-weight: 600; color: #333;">${completedStages.length}/${plannerStages.length}</span>
          <span style="display: block; font-size: 11px; color: #888; text-transform: uppercase;">gelopen</span>
        </div>
      </div>

      ${!state.startDate ? `
        <div style="padding: 12px 16px; background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.3); border-radius: 8px; margin-bottom: 24px;">
          <p style="margin: 0; font-size: 13px; color: #666;">💡 Dit is een preview vanaf vandaag. Stel een startdatum in via de Planner voor je echte planning.</p>
        </div>
      ` : ''}

      <!-- Calendar Months -->
      <div class="calendar-months">
        ${renderCalendarMonths(trailId, calendarGridData)}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Animation
  requestAnimationFrame(() => {
    modal.classList.add('calendar-modal--open');
  });

  // Event handlers
  modal.querySelector('[data-close-calendar]')?.addEventListener('click', closeCalendarModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeCalendarModal();
  });

  // Handle stage clicks within modal - DON'T close calendar, open stage on top
  modal.addEventListener('click', (e) => {
    const stageEl = e.target.closest('[data-open-stage]');
    if (stageEl) {
      e.stopPropagation(); // Prevent closing calendar
      const stageIndex = parseInt(stageEl.dataset.openStage);
      const trailId = stageEl.dataset.trail;
      openStageDetailModal(trailId, stageIndex, true); // true = from calendar
    }
  });
}

function closeCalendarModal() {
  const modal = document.querySelector('.calendar-modal');
  if (modal) {
    modal.classList.remove('calendar-modal--open');
    setTimeout(() => modal.remove(), 200);
  }
}

function buildCalendarGrid(calendarItems, enrichedStages) {
  // Group items by month
  const months = {};

  calendarItems.forEach((item, idx) => {
    const d = new Date(item.date);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    if (!months[monthKey]) {
      months[monthKey] = {
        year: d.getFullYear(),
        month: d.getMonth(),
        monthName: d.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' }),
        days: {}
      };
    }

    const dayOfMonth = d.getDate();

    if (item.type === 'stage') {
      const stage = enrichedStages[item.index];
      months[monthKey].days[dayOfMonth] = {
        type: 'stage',
        date: item.date,
        stage: stage,
        stageNumber: item.index + 1
      };
    } else if (item.type === 'rest') {
      months[monthKey].days[dayOfMonth] = {
        type: 'rest',
        date: item.date,
        afterStageIndex: item.afterStageIndex
      };
    }
  });

  return months;
}

function renderCalendarMonths(trailId, monthsData) {
  let html = '';

  Object.keys(monthsData).sort().forEach(monthKey => {
    const monthData = monthsData[monthKey];
    html += renderCalendarMonth(trailId, monthData);
  });

  return html;
}

function renderCalendarMonth(trailId, monthData) {
  const { year, month, monthName, days } = monthData;

  // Get first day of month and total days
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const totalDays = lastDay.getDate();

  // Get day of week for first day (0 = Sunday, convert to Monday = 0)
  let startDayOfWeek = firstDay.getDay() - 1;
  if (startDayOfWeek < 0) startDayOfWeek = 6; // Sunday becomes 6

  // Build weeks
  const weeks = [];
  let currentWeek = [];

  // Add empty cells for days before month starts
  for (let i = 0; i < startDayOfWeek; i++) {
    currentWeek.push({ empty: true });
  }

  // Add all days of the month
  for (let day = 1; day <= totalDays; day++) {
    const dayData = days[day] || { type: 'empty', date: new Date(year, month, day).toISOString().split('T')[0] };
    currentWeek.push({ ...dayData, dayNumber: day });

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  // Add empty cells for remaining days
  while (currentWeek.length > 0 && currentWeek.length < 7) {
    currentWeek.push({ empty: true });
  }
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  return `
    <div class="calendar-month" style="background: white; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden; margin-bottom: 24px;">
      <div style="padding: 16px 20px; background: #f8f8f8; border-bottom: 1px solid #e0e0e0;">
        <h3 style="font-size: 16px; font-weight: 600; margin: 0; text-transform: capitalize;">${monthName}</h3>
      </div>
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); background: #f8f8f8; border-bottom: 1px solid #e0e0e0; padding: 8px 0;">
        <span style="text-align: center; font-size: 11px; font-weight: 600; color: #888;">Ma</span>
        <span style="text-align: center; font-size: 11px; font-weight: 600; color: #888;">Di</span>
        <span style="text-align: center; font-size: 11px; font-weight: 600; color: #888;">Wo</span>
        <span style="text-align: center; font-size: 11px; font-weight: 600; color: #888;">Do</span>
        <span style="text-align: center; font-size: 11px; font-weight: 600; color: #888;">Vr</span>
        <span style="text-align: center; font-size: 11px; font-weight: 600; color: #888;">Za</span>
        <span style="text-align: center; font-size: 11px; font-weight: 600; color: #888;">Zo</span>
      </div>
      <div style="padding: 8px;">
        ${weeks.map(week => `
          <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 4px;">
            ${week.map(day => renderCalendarDay(trailId, day)).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderCalendarDay(trailId, day) {
  const baseStyle = "min-height: 80px; padding: 6px; border-radius: 8px; display: flex; flex-direction: column; position: relative; transition: all 0.15s ease;";

  if (day.empty) {
    return `<div style="${baseStyle} background: transparent;"></div>`;
  }

  if (day.type === 'stage' && day.stage) {
    const stage = day.stage;
    const isCompleted = stage.isCompleted;
    const realIndex = stage.realIndex !== undefined ? stage.realIndex : stage.index;

    // Shorten place names
    const fromShort = shortenPlaceName(stage.from || stage.fromLocation || '');
    const toShort = shortenPlaceName(stage.to || stage.toLocation || '');
    const km = stage.km ? (typeof stage.km === 'number' ? Math.round(stage.km) : stage.km) : '?';

    const bgColor = isCompleted ? 'linear-gradient(135deg, rgba(91, 124, 153, 0.15), rgba(91, 124, 153, 0.05))' : 'white';
    const borderColor = isCompleted ? '#5B7C99' : '#e0e0e0';

    return `
      <div style="${baseStyle} background: ${bgColor}; border: 1px solid ${borderColor}; cursor: pointer;" 
           data-open-stage="${realIndex}" data-trail="${trailId}">
        <div style="font-size: 12px; font-weight: 600; color: ${isCompleted ? '#5B7C99' : '#888'}; margin-bottom: 4px;">${day.dayNumber}</div>
        <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
          <div style="font-size: 10px; font-weight: 500; color: #333; line-height: 1.3; overflow: hidden;">${escapeHtml(fromShort)} → ${escapeHtml(toShort)}</div>
          <div style="font-size: 11px; font-weight: 600; color: #5B7C99; margin-top: 2px;">${km} km</div>
        </div>
        ${isCompleted ? '<div style="position: absolute; top: 4px; right: 4px; width: 16px; height: 16px; background: #5B7C99; color: white; border-radius: 50%; font-size: 10px; display: flex; align-items: center; justify-content: center;">✓</div>' : ''}
      </div>
    `;
  }

  if (day.type === 'rest') {
    return `
      <div style="${baseStyle} background: #f5f5f5; border: 1px dashed #ddd;">
        <div style="font-size: 12px; font-weight: 600; color: #888; margin-bottom: 4px;">${day.dayNumber}</div>
        <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center;">
          <div style="font-size: 18px;">😴</div>
          <div style="font-size: 10px; color: #888; margin-top: 2px;">Rustdag</div>
        </div>
      </div>
    `;
  }

  // Empty day (not part of trip)
  return `
    <div style="${baseStyle} background: transparent; opacity: 0.3;">
      <div style="font-size: 12px; color: #888;">${day.dayNumber}</div>
    </div>
  `;
}

function shortenPlaceName(name) {
  if (!name) return '';
  // Remove common suffixes and shorten
  return name
    .replace(/\s*\([^)]*\)/g, '') // Remove parentheses
    .replace(/aan de .*/i, '')
    .replace(/bij .*/i, '')
    .split(' ')[0]; // Take first word if still long
}

function formatCalendarDateLong(dateStr) {
  if (!dateStr) return '?';
  const d = new Date(dateStr);
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderStageCard(trailId, stage, status) {
  const statusClass = status === 'completed' ? 'stage-card--completed' : 'stage-card--upcoming';
  const hasJournal = stage.hasJournalEntry;

  return `
    <div class="stage-card ${statusClass}" data-open-stage="${stage.index}" data-trail="${trailId}">
      <div class="stage-card-number">${stage.index + 1}</div>
      <div class="stage-card-content">
        <h3 class="stage-card-route">${escapeHtml(stage.from || '')} → ${escapeHtml(stage.to || '')}</h3>
        <div class="stage-card-meta">
          <span class="stage-card-km">${stage.km} km</span>
          ${stage.ascent ? `<span class="stage-card-elevation">↑${stage.ascent}m</span>` : ''}
          ${status === 'completed' && hasJournal ? '<span class="stage-card-journal">📓</span>' : ''}
          ${status === 'completed' && !hasJournal ? '<span class="stage-card-no-journal">✏️</span>' : ''}
        </div>
      </div>
      <div class="stage-card-arrow">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18l6-6-6-6"></path>
        </svg>
      </div>
    </div>
  `;
}

// ====================
// STAGE DETAIL MODAL
// ====================
function openStageDetailModal(trailId, stageIndex, fromCalendar = false) {
  const userTrail = state.userTrails.find(t => t.id === trailId);
  const trailData = state.currentTrailData;
  if (!userTrail || !trailData) return;

  const stages = extractStages(trailData);
  const stage = stages[stageIndex];
  if (!stage) return;

  const isCompleted = isStageCompleted(trailId, stageIndex);
  const journalEntry = getJournalEntry(trailId, stageIndex);
  const hasJournal = !!journalEntry;

  // Calculate cumulative km
  let cumulativeKm = 0;
  for (let i = 0; i <= stageIndex; i++) {
    cumulativeKm += parseFloat(stages[i]?.km) || 0;
  }

  // Remove existing modal
  document.querySelector('.stage-detail-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'stage-detail-modal';
  // Higher z-index if opened from calendar modal
  if (fromCalendar) {
    modal.style.zIndex = '10001';
  }
  modal.dataset.fromCalendar = fromCalendar ? 'true' : 'false';

  modal.innerHTML = `
    <div class="stage-detail-content">
      <button class="stage-detail-close" data-close-stage-modal>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"></path>
        </svg>
      </button>

      <div class="stage-detail-header ${isCompleted ? 'stage-detail-header--completed' : ''}">
        <div class="stage-detail-number">Etappe ${stageIndex + 1}</div>
        <h2 class="stage-detail-route">${escapeHtml(stage.from || '')} ⇒ ${escapeHtml(stage.to || '')}</h2>
        <div class="stage-detail-status">
          ${isCompleted ? `
            <span class="stage-status-badge stage-status-badge--completed">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              Gelopen
            </span>
          ` : `
            <span class="stage-status-badge stage-status-badge--upcoming">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
              </svg>
              Te lopen
            </span>
          `}
        </div>
      </div>

      <div class="stage-detail-stats">
        <div class="stage-detail-stat">
          <span class="stage-detail-stat-value">${stage.km}</span>
          <span class="stage-detail-stat-label">kilometer</span>
        </div>
        <div class="stage-detail-stat">
          <span class="stage-detail-stat-value">${cumulativeKm.toFixed(0)}</span>
          <span class="stage-detail-stat-label">km totaal</span>
        </div>
        ${stage.ascent ? `
          <div class="stage-detail-stat">
            <span class="stage-detail-stat-value">↑${stage.ascent}</span>
            <span class="stage-detail-stat-label">m stijgen</span>
          </div>
        ` : ''}
        ${stage.descent ? `
          <div class="stage-detail-stat">
            <span class="stage-detail-stat-value">↓${stage.descent}</span>
            <span class="stage-detail-stat-label">m dalen</span>
          </div>
        ` : ''}
      </div>

      ${stage.description ? `
        <div class="stage-detail-description">
          <p>${escapeHtml(stage.description)}</p>
        </div>
      ` : ''}

      ${isCompleted && hasJournal ? `
        <div class="stage-detail-journal-preview">
          <div class="stage-detail-journal-header">
            <span class="stage-detail-journal-icon">📓</span>
            <span>Dagboek entry</span>
          </div>
          ${journalEntry.summary ? `
            <p class="stage-detail-journal-summary">${escapeHtml(journalEntry.summary)}</p>
          ` : ''}
          <p class="stage-detail-journal-date">${formatJournalDate(journalEntry.date)}</p>
        </div>
      ` : ''}

      <div class="stage-detail-actions">
        <!-- Toggle completed status -->
        <button class="stage-detail-btn stage-detail-btn--toggle" data-toggle-stage-modal="${stageIndex}" data-trail="${trailId}">
          ${isCompleted ? `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"></path>
            </svg>
            Markeer als niet gelopen
          ` : `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Markeer als gelopen
          `}
        </button>

        ${isCompleted ? `
          <!-- Go to journal -->
          <button class="stage-detail-btn stage-detail-btn--primary" data-goto-journal="${stageIndex}" data-trail="${trailId}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            ${hasJournal ? 'Bekijk dagboek' : 'Schrijf verhaal'}
          </button>
        ` : `
          <!-- Edit in planner (future) -->
          <button class="stage-detail-btn stage-detail-btn--secondary" data-close-stage-modal>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            Bekijk op kaart
          </button>
        `}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Animation
  requestAnimationFrame(() => {
    modal.classList.add('stage-detail-modal--open');
  });

  // Event handlers
  modal.querySelector('[data-close-stage-modal]')?.addEventListener('click', closeStageDetailModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeStageDetailModal();
  });

  // Toggle completed from modal
  modal.querySelector('[data-toggle-stage-modal]')?.addEventListener('click', () => {
    const wasFromCalendar = modal.dataset.fromCalendar === 'true';
    toggleStageCompleted(trailId, stageIndex);
    closeStageDetailModal();

    // Refresh calendar if it was open, or refresh dashboard
    if (wasFromCalendar) {
      // Close and reopen calendar to refresh it
      closeCalendarModal();
      setTimeout(() => openCalendarModal(), 50);
    } else if (state.currentView === 'stages-overview') {
      openCalendarModal();
    } else {
      const userTrail = state.userTrails.find(t => t.id === trailId);
      if (userTrail && state.currentTrailData) {
        renderTrailDashboard(userTrail, state.currentTrailData);
      }
    }
  });

  // Go to journal
  modal.querySelector('[data-goto-journal]')?.addEventListener('click', () => {
    const wasFromCalendar = modal.dataset.fromCalendar === 'true';
    closeStageDetailModal();

    // Close calendar if open
    if (wasFromCalendar) {
      closeCalendarModal();
    }

    if (hasJournal) {
      // Open view modal
      openJournalEntryView(trailId, stageIndex);
    } else {
      // Open editor
      openJournalEditor(trailId, stageIndex);
    }
  });
}

function closeStageDetailModal() {
  const modal = document.querySelector('.stage-detail-modal');
  if (modal) {
    modal.classList.remove('stage-detail-modal--open');
    setTimeout(() => modal.remove(), 200);
  }
}

function renderJournalEntryCard(trailId, stage, isDimmed = false) {
  const hasEntry = stage.hasEntry;
  const entry = stage.entry;

  // Mood icons
  const moodIcons = {
    great: '😊',
    good: '🙂',
    neutral: '😐',
    tired: '😓',
    tough: '😫'
  };

  // Weather icons
  const weatherIcons = {
    sunny: '☀️',
    cloudy: '⛅',
    rainy: '🌧️',
    stormy: '⛈️',
    windy: '💨',
    cold: '❄️',
    hot: '🥵'
  };

  // For dimmed (not yet walked) stages, show a simpler card
  if (isDimmed) {
    return `
      <div class="journal-entry-card journal-entry-card--dimmed" data-stage-index="${stage.index}">
        <div class="journal-entry-header">
          <div class="journal-entry-number">Etappe ${stage.index + 1}</div>
          <div class="journal-entry-route">${escapeHtml(stage.from || '')} → ${escapeHtml(stage.to || '')}</div>
        </div>
        <div class="journal-entry-empty">
          <span class="journal-entry-km-preview">${stage.km} km</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="journal-entry-card ${hasEntry ? 'journal-entry-card--filled' : ''}" data-stage-index="${stage.index}">
      <div class="journal-entry-header">
        <div class="journal-entry-number">Etappe ${stage.index + 1}</div>
        <div class="journal-entry-route">${escapeHtml(stage.from || '')} → ${escapeHtml(stage.to || '')}</div>
      </div>

      ${hasEntry ? `
        <div class="journal-entry-meta">
          <span class="journal-entry-date">${formatJournalDate(entry.date)}</span>
          <span class="journal-entry-km">Kilometer ${entry.cumulativeKm || stage.cumulativeKm}</span>
          ${entry.mood ? `<span class="journal-entry-mood">${moodIcons[entry.mood] || ''}</span>` : ''}
          ${entry.weather ? `<span class="journal-entry-weather">${weatherIcons[entry.weather] || ''}</span>` : ''}
        </div>

        ${entry.summary ? `
          <p class="journal-entry-summary">${escapeHtml(entry.summary)}</p>
        ` : ''}

        ${entry.story ? `
          <p class="journal-entry-preview">${escapeHtml(entry.story.substring(0, 150))}${entry.story.length > 150 ? '...' : ''}</p>
        ` : ''}
      ` : `
        <div class="journal-entry-empty">
          <span class="journal-entry-km-preview">${stage.km} km · Km ${stage.cumulativeKm}</span>
        </div>
      `}

      <div class="journal-entry-actions">
        <button class="journal-entry-btn" data-edit-entry="${stage.index}" data-trail="${trailId}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          ${hasEntry ? 'Bewerken' : 'Schrijven'}
        </button>
        ${hasEntry ? `
          <button class="journal-entry-btn journal-entry-btn--view" data-view-entry="${stage.index}" data-trail="${trailId}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            Lezen
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function formatJournalDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const options = { day: 'numeric', month: 'long', year: 'numeric' };
  return date.toLocaleDateString('nl-NL', options);
}

// ====================
// JOURNAL ENTRY EDITOR MODAL
// ====================
function openJournalEditor(trailId, stageIndex) {
  const userTrail = state.userTrails.find(t => t.id === trailId);
  const trailData = state.currentTrailData;
  if (!userTrail || !trailData) return;

  const stages = extractStages(trailData);
  const stage = stages[stageIndex];
  if (!stage) return;

  // Get existing entry or create defaults
  const existingEntry = getJournalEntry(trailId, stageIndex);

  // Calculate cumulative km
  let cumulativeKm = 0;
  for (let i = 0; i <= stageIndex; i++) {
    cumulativeKm += parseFloat(stages[i]?.km) || 0;
  }

  const entry = existingEntry || {
    date: new Date().toISOString().split('T')[0],
    summary: '',
    story: '',
    mood: null,
    weather: null,
    cumulativeKm: cumulativeKm.toFixed(1)
  };

  // Remove existing modal
  document.querySelector('.journal-editor-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'journal-editor-modal';
  modal.innerHTML = `
    <div class="journal-editor-content">
      <div class="journal-editor-header">
        <div class="journal-editor-title-section">
          <h2>Etappe ${stageIndex + 1}: ${escapeHtml(stage.from || '')} → ${escapeHtml(stage.to || '')}</h2>
          <p class="journal-editor-subtitle">${stage.km} km · Kilometer ${entry.cumulativeKm || cumulativeKm.toFixed(1)}</p>
        </div>
        <button class="journal-editor-close" data-close-editor>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"></path>
          </svg>
        </button>
      </div>

      <div class="journal-editor-body">
        <div class="journal-editor-row">
          <div class="journal-editor-field">
            <label>Datum</label>
            <input type="date" id="journalDate" value="${entry.date || ''}" />
          </div>
          <div class="journal-editor-field">
            <label>Kilometer stand</label>
            <input type="text" id="journalKm" value="${entry.cumulativeKm || cumulativeKm.toFixed(1)}" placeholder="Km ${cumulativeKm.toFixed(1)}" />
          </div>
        </div>

        <div class="journal-editor-row">
          <div class="journal-editor-field">
            <label>Stemming</label>
            <div class="journal-mood-selector">
              <button type="button" class="mood-btn ${entry.mood === 'great' ? 'mood-btn--active' : ''}" data-mood="great" title="Geweldig">😊</button>
              <button type="button" class="mood-btn ${entry.mood === 'good' ? 'mood-btn--active' : ''}" data-mood="good" title="Goed">🙂</button>
              <button type="button" class="mood-btn ${entry.mood === 'neutral' ? 'mood-btn--active' : ''}" data-mood="neutral" title="Neutraal">😐</button>
              <button type="button" class="mood-btn ${entry.mood === 'tired' ? 'mood-btn--active' : ''}" data-mood="tired" title="Moe">😓</button>
              <button type="button" class="mood-btn ${entry.mood === 'tough' ? 'mood-btn--active' : ''}" data-mood="tough" title="Zwaar">😫</button>
            </div>
          </div>
          <div class="journal-editor-field">
            <label>Weer</label>
            <div class="journal-weather-selector">
              <button type="button" class="weather-btn ${entry.weather === 'sunny' ? 'weather-btn--active' : ''}" data-weather="sunny" title="Zonnig">☀️</button>
              <button type="button" class="weather-btn ${entry.weather === 'cloudy' ? 'weather-btn--active' : ''}" data-weather="cloudy" title="Bewolkt">⛅</button>
              <button type="button" class="weather-btn ${entry.weather === 'rainy' ? 'weather-btn--active' : ''}" data-weather="rainy" title="Regen">🌧️</button>
              <button type="button" class="weather-btn ${entry.weather === 'stormy' ? 'weather-btn--active' : ''}" data-weather="stormy" title="Onweer">⛈️</button>
              <button type="button" class="weather-btn ${entry.weather === 'windy' ? 'weather-btn--active' : ''}" data-weather="windy" title="Wind">💨</button>
            </div>
          </div>
        </div>

        <div class="journal-editor-field">
          <label>Samenvatting <span class="label-hint">(kort, wordt vetgedrukt getoond)</span></label>
          <textarea id="journalSummary" rows="2" placeholder="Bijv: Mooie afwisselende etappe door het vlakke land tussen de Vogezen en de Jura...">${escapeHtml(entry.summary || '')}</textarea>
        </div>

        <div class="journal-editor-field">
          <label>Verhaal</label>
          <textarea id="journalStory" rows="8" placeholder="Vertel over je dag... Wat heb je gezien? Hoe voelde het? Bijzondere ontmoetingen?">${escapeHtml(entry.story || '')}</textarea>
        </div>
      </div>

      <div class="journal-editor-footer">
        ${existingEntry ? `
          <button class="journal-editor-delete" data-delete-entry="${stageIndex}" data-trail="${trailId}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Verwijderen
          </button>
        ` : '<div></div>'}
        <div class="journal-editor-actions">
          <button class="journal-editor-cancel" data-close-editor>Annuleren</button>
          <button class="journal-editor-save" data-save-entry="${stageIndex}" data-trail="${trailId}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            Opslaan
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Store current mood/weather state
  let selectedMood = entry.mood;
  let selectedWeather = entry.weather;

  // Animation
  requestAnimationFrame(() => {
    modal.classList.add('journal-editor-modal--open');
  });

  // Event handlers
  modal.querySelector('[data-close-editor]')?.addEventListener('click', closeJournalEditor);
  modal.querySelectorAll('[data-close-editor]').forEach(btn => {
    btn.addEventListener('click', closeJournalEditor);
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeJournalEditor();
  });

  // Mood selector
  modal.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('mood-btn--active'));
      btn.classList.add('mood-btn--active');
      selectedMood = btn.dataset.mood;
    });
  });

  // Weather selector
  modal.querySelectorAll('.weather-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.weather-btn').forEach(b => b.classList.remove('weather-btn--active'));
      btn.classList.add('weather-btn--active');
      selectedWeather = btn.dataset.weather;
    });
  });

  // Save handler
  modal.querySelector('[data-save-entry]')?.addEventListener('click', () => {
    const entryData = {
      date: document.getElementById('journalDate').value,
      cumulativeKm: document.getElementById('journalKm').value,
      summary: document.getElementById('journalSummary').value,
      story: document.getElementById('journalStory').value,
      mood: selectedMood,
      weather: selectedWeather
    };

    saveJournalEntry(trailId, stageIndex, entryData);
    closeJournalEditor();

    // Refresh journal view if we're on it
    if (state.currentView === 'journal') {
      renderJournalView();
    }
  });

  // Delete handler
  modal.querySelector('[data-delete-entry]')?.addEventListener('click', () => {
    if (confirm('Weet je zeker dat je dit dagboekverhaal wilt verwijderen?')) {
      deleteJournalEntry(trailId, stageIndex);
      closeJournalEditor();

      if (state.currentView === 'journal') {
        renderJournalView();
      }
    }
  });
}

function closeJournalEditor() {
  const modal = document.querySelector('.journal-editor-modal');
  if (modal) {
    modal.classList.remove('journal-editor-modal--open');
    setTimeout(() => modal.remove(), 200);
  }
}

// ====================
// JOURNAL ENTRY VIEW MODAL (Read-only, styled like hike5.com)
// ====================
function openJournalEntryView(trailId, stageIndex) {
  const userTrail = state.userTrails.find(t => t.id === trailId);
  const trailData = state.currentTrailData;
  if (!userTrail || !trailData) return;

  const stages = extractStages(trailData);
  const stage = stages[stageIndex];
  const entry = getJournalEntry(trailId, stageIndex);

  if (!stage || !entry) return;

  // Mood icons
  const moodLabels = {
    great: '😊 Geweldig',
    good: '🙂 Goed',
    neutral: '😐 Neutraal',
    tired: '😓 Moe',
    tough: '😫 Zwaar'
  };

  // Weather icons
  const weatherLabels = {
    sunny: '☀️ Zonnig',
    cloudy: '⛅ Bewolkt',
    rainy: '🌧️ Regen',
    stormy: '⛈️ Onweer',
    windy: '💨 Wind',
    cold: '❄️ Koud',
    hot: '🥵 Warm'
  };

  // Remove existing modal
  document.querySelector('.journal-view-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'journal-view-modal';
  modal.innerHTML = `
    <div class="journal-view-content">
      <button class="journal-view-close" data-close-view>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"></path>
        </svg>
      </button>

      <div class="journal-view-header">
        <h1 class="journal-view-title">Etappe ${stageIndex + 1}: ${escapeHtml(stage.from || '')} ⇒ ${escapeHtml(stage.to || '')}</h1>
      </div>

      <div class="journal-view-meta">
        <div class="journal-view-date">${formatJournalDate(entry.date)}</div>
        <div class="journal-view-km">Kilometer ${entry.cumulativeKm || '?'}</div>
      </div>

      ${entry.summary ? `
        <p class="journal-view-summary">${escapeHtml(entry.summary)}</p>
      ` : ''}

      <div class="journal-view-stats">
        <div class="journal-view-stat">
          <span class="journal-view-stat-label">Van:</span>
          <span class="journal-view-stat-value">${escapeHtml(stage.from || '')}</span>
        </div>
        <div class="journal-view-stat">
          <span class="journal-view-stat-label">Naar:</span>
          <span class="journal-view-stat-value">${escapeHtml(stage.to || '')}</span>
        </div>
        <div class="journal-view-stat">
          <span class="journal-view-stat-label">Afstand:</span>
          <span class="journal-view-stat-value">${stage.km} km</span>
        </div>
        ${entry.mood ? `
        <div class="journal-view-stat">
          <span class="journal-view-stat-label">Stemming:</span>
          <span class="journal-view-stat-value">${moodLabels[entry.mood] || ''}</span>
        </div>
        ` : ''}
        ${entry.weather ? `
        <div class="journal-view-stat">
          <span class="journal-view-stat-label">Weer:</span>
          <span class="journal-view-stat-value">${weatherLabels[entry.weather] || ''}</span>
        </div>
        ` : ''}
      </div>

      ${entry.story ? `
        <div class="journal-view-story">
          ${entry.story.split('\n\n').map(p => `<p>${escapeHtml(p)}</p>`).join('')}
        </div>
      ` : ''}

      <div class="journal-view-footer">
        <button class="journal-view-edit" data-edit-from-view="${stageIndex}" data-trail="${trailId}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          Bewerken
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Animation
  requestAnimationFrame(() => {
    modal.classList.add('journal-view-modal--open');
  });

  // Event handlers
  modal.querySelector('[data-close-view]').addEventListener('click', closeJournalEntryView);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeJournalEntryView();
  });

  // Edit from view
  modal.querySelector('[data-edit-from-view]')?.addEventListener('click', () => {
    closeJournalEntryView();
    setTimeout(() => {
      openJournalEditor(trailId, stageIndex);
    }, 200);
  });
}

function closeJournalEntryView() {
  const modal = document.querySelector('.journal-view-modal');
  if (modal) {
    modal.classList.remove('journal-view-modal--open');
    setTimeout(() => modal.remove(), 200);
  }
}

// ====================
// DASHBOARD MAP INIT
// ====================
function initDashboardMap(gpxProfile) {
  const mapEl = document.getElementById('dashboardMap');
  const wrapper = document.getElementById('dashboardMapWrapper');
  if (!mapEl || !wrapper || !gpxProfile?.points?.length) return;

  const dashMap = L.map('dashboardMap', {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
  }).setView([52.37, 4.89], 7);

  createTileLayer().addTo(dashMap);

  // Draw the full track - solid blue line, no markers
  const trackPoints = gpxProfile.points.map(p => [p.lat, p.lon]);
  const trackLayer = L.polyline(trackPoints, {
    color: '#5B7C99',
    weight: 4,
    opacity: 1,
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(dashMap);

  // Fit to track bounds
  dashMap.fitBounds(trackLayer.getBounds(), { padding: [30, 30] });

  // Store reference
  if (state.previewMap) {
    state.previewMap.remove();
  }
  state.previewMap = dashMap;

  // Add hover hint directly to Leaflet container
  const mapContainer = dashMap.getContainer();
  mapContainer.classList.add('dashboard-map-clickable');

  // Add hint element
  const hint = document.createElement('div');
  hint.className = 'dashboard-map-hint';
  hint.innerHTML = '🔍 Klik voor volledig scherm';
  mapContainer.appendChild(hint);

  // Use Leaflet's click event
  dashMap.on('click', function() {
    openFullMapModal();
  });
}

// --------------------
// RENDER: BASIC DETAILS (SCREEN 1)
// --------------------
async function loadAndRenderBasicDetails(url) {
  const detailEl = document.querySelector("#detail");
  detailEl.innerHTML = `<p class="muted">Loading…</p>`;

  try {
    const trail = await loadJson(url);
    state.currentTrailData = trail;
    state.currentTrailUrl = url;
    state.isFullDetail = false;

    const norm = normalizeTrail(trail);

    // Optional: Load GPX for preview map
    const gpxProfile = await ensureGpxProfileForCurrentTrail();

    detailEl.innerHTML = `
      <div class="basicDetail">
        <div class="detailHeader">
          <div>
            <h2 class="detailTitle">
              ${escapeHtml(removeCountryCodeFromName(norm.name, norm.countries))}
            </h2>
            ${
              norm.from && norm.to
                ? `<p class="routeLine"><strong>${escapeHtml(norm.from)}</strong> → <strong>${escapeHtml(norm.to)}</strong></p>`
                : ""
            }
          </div>
          <button class="openTrailBtn">Bekijk etappes →</button>
        </div>

        ${trail.image ? `<img src="${escapeHtml(trail.image)}" alt="${escapeHtml(norm.name)}" class="trailHeroImage" />` : ""}

        ${norm.description ? `<p class="desc">${escapeHtml(norm.description)}</p>` : ""}

        <div class="statsGrid">
          ${norm.totalKm ? `
            <div class="statCard">
              <div class="statIcon">📍</div>
              <div class="statContent">
                <div class="statValue">${escapeHtml(norm.totalKm)} km</div>
                <div class="statLabel">Totale afstand</div>
              </div>
            </div>` : ""}
          ${norm.stageCount ? `
            <div class="statCard">
              <div class="statIcon">🧭</div>
              <div class="statContent">
                <div class="statValue">${escapeHtml(norm.stageCount)}</div>
                <div class="statLabel">Etappes</div>
              </div>
            </div>` : ""}
          ${norm.seasons.length ? `
            <div class="statCard">
              <div class="statIcon">🌤️</div>
              <div class="statContent">
                <div class="statValue">${escapeHtml(seasonsToMonths(norm.seasons))}</div>
                <div class="statLabel">Beste periode</div>
              </div>
            </div>` : ""}
          ${norm.countries.length ? `
            <div class="statCard">
              <div class="statContent">
                <div class="statValue">${norm.countries.map(c => normalizeCountryCode(c)).join(' ')}</div>
                <div class="statLabel">${norm.countries.length === 1 ? 'Land' : 'Landen'}</div>
              </div>
            </div>` : ""}
        </div>

        ${gpxProfile ? `<div class="previewMap" id="previewMap"></div>` : ""}
      </div>
    `;

    // Initialize preview map if GPX is available
    if (gpxProfile) {
      initPreviewMap(gpxProfile);
    }
  } catch (err) {
    console.warn("Load basic details failed:", err);
    detailEl.innerHTML = renderErrorCard("Trail kon niet laden", err, `Bestand: ${url}`);
  }
}

// --------------------
// PREVIEW MAP (for basic details view)
// --------------------
function initPreviewMap(gpxProfile) {
  const mapEl = document.getElementById("previewMap");
  if (!mapEl || !gpxProfile?.points?.length) return;

  const previewMap = L.map("previewMap").setView([52.37, 4.89], 7);

  createTileLayer().addTo(previewMap);

  // Draw the full track (dashed brown for overview)
  const trackPoints = gpxProfile.points.map(p => [p.lat, p.lon]);
  const trackLayer = L.polyline(trackPoints, {
    color: '#8B4513',
    weight: 4,
    opacity: 0.7,
    dashArray: '8, 8',
  }).addTo(previewMap);

  // Fit to track bounds
  previewMap.fitBounds(trackLayer.getBounds(), { padding: [20, 20] });

  // Store reference for cleanup
  if (state.previewMap) {
    state.previewMap.remove();
  }
  state.previewMap = previewMap;
}

// --------------------
// RENDER: FULL DETAIL (SCREEN 2)
// --------------------
async function renderFullDetail() {
  // Check if we're coming from the new dashboard view
  const isFromDashboard = state.currentView === 'dashboard';

  let detailEl;
  let wrap;

  if (isFromDashboard) {
    // Create the planner view in appMain
    state.currentView = 'planner';
    const mainEl = document.getElementById('appMain');
    mainEl.innerHTML = `
      <div class="wrap">
        <section class="card" id="detail">
          <p class="muted">Laden...</p>
        </section>
      </div>
    `;
    detailEl = document.querySelector("#detail");
    wrap = document.querySelector(".wrap");
  } else {
    detailEl = document.querySelector("#detail");
    wrap = document.querySelector(".wrap");
  }

  wrap?.classList.add("isDetail");
  state.isFullDetail = true;

  // ALWAYS clean up the map completely before re-rendering
  // because innerHTML will destroy the container div
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  state.fullTrackLayer = null;
  state.stageLayerGroup = L.layerGroup();
  state.poiLayerGroup = L.layerGroup();

  // Clear markers (they will be recreated if needed)
  state.startMarker = null;
  state.endMarker = null;

  const trail = state.currentTrailData;
  if (!trail) {
    detailEl.innerHTML = renderErrorCard(
      "Geen trail geselecteerd",
      new Error("state.currentTrailData is leeg."),
      "Klik links een trail aan."
    );
    return;
  }

  // Show loading state
  detailEl.innerHTML = `
    <div class="backRow">
      <button class="backBtn" aria-label="Terug naar overzicht">← ${isFromDashboard ? 'Terug naar dashboard' : 'Terug naar trails'}</button>
    </div>
    <p class="muted">Trail gegevens laden...</p>
  `;

  try {
    const norm = normalizeTrail(trail);
    const officialStages = extractStages(trail);

    // Determine total km number:
    let totalKmNum = toNumber(norm.totalKm);
    if (totalKmNum === null) {
      const sum = sumStageKm(officialStages);
      if (sum !== null) totalKmNum = sum;
    }

    // Optional GPX profile (always load for map)
    const gpxProfile = await ensureGpxProfileForCurrentTrail();

    // For display: prefer GPX total length
    let totalKmDisplay = "";
    if (gpxProfile?.totalKm && Number.isFinite(gpxProfile.totalKm)) {
      totalKmDisplay = formatKm(gpxProfile.totalKm);
      // Also use for custom planning calculations
      if (state.planMode === "custom") {
        totalKmNum = gpxProfile.totalKm;
      }
    } else if (totalKmNum !== null) {
      totalKmDisplay = formatKm(totalKmNum);
    } else {
      totalKmDisplay = norm.totalKm ? String(norm.totalKm) : "";
    }

    // Override with selected range if applicable
    if (state.planMode === "custom" && state.startKm !== null && state.endKm !== null) {
      const selectedDistance = state.endKm - state.startKm;
      totalKmDisplay = formatKm(selectedDistance);
    } else if (state.planMode === "official" && (state.startStage !== null || state.endStage !== null)) {
      // Calculate distance of selected stages
      const startIdx = state.startStage !== null ? state.startStage : 0;
      const endIdx = state.endStage !== null ? state.endStage : officialStages.length - 1;
      const selectedStages = officialStages.slice(startIdx, endIdx + 1);
      const selectedDistance = sumStageKm(selectedStages);
      if (selectedDistance !== null) {
        totalKmDisplay = formatKm(selectedDistance);
      }
    }

    const estimatedDays =
      totalKmNum !== null
        ? Math.max(1, Math.ceil(totalKmNum / Math.max(1, state.targetPerDay)))
        : "";

    // Build stages depending on mode
    const allStages = state.planMode === "custom"
      ? await buildCustomStages(totalKmNum ?? NaN, state.targetPerDay, gpxProfile)
      : officialStages;

    // Apply filtering for official mode
    const stages = state.planMode === "official" 
      ? filterOfficialStages(allStages)
      : allStages; // Custom mode filtering is done inside buildCustomStages

    state.currentStages = stages;

    detailEl.innerHTML = `
      <div class="backRow">
        <button class="backBtn" aria-label="Terug naar overzicht">← Terug naar trails</button>
      </div>

      <div class="miniPlan">
        <div class="miniRow">
          <strong>Mini-planner</strong>

          <div class="modeGroup" role="tablist" aria-label="Etappes mode">
            <button class="modeBtn ${state.planMode === "official" ? "isActive" : ""}" data-mode="official" role="tab" aria-selected="${state.planMode === "official"}">
              Officieel
            </button>
            <button class="modeBtn ${state.planMode === "custom" ? "isActive" : ""}" data-mode="custom" role="tab" aria-selected="${state.planMode === "custom"}">
              Eigen (x km/dag)
            </button>
          </div>
        </div>

        ${
          state.planMode === "custom"
            ? `
          <div class="miniControlRow">
            <strong>Doel</strong>
            <span class="muted">
              <input class="targetInput" type="number" value="${state.targetPerDay}" min="1" aria-label="Kilometers per dag"> km/dag
            </span>
          </div>
        `
            : ""
        }

        ${
          state.planMode === "official" && officialStages.length > 0
            ? `
          <div class="miniControlRow">
            <strong>Gedeelte</strong>
            <div style="display: flex; gap: 8px; align-items: center;">
              <select class="stageSelect startStageSelect" aria-label="Start etappe">
                <option value="">Van begin</option>
                ${officialStages.map((s, i) => `
                  <option value="${i}" ${state.startStage === i ? 'selected' : ''}>
                    Etappe ${s.index}: ${escapeHtml(s.from)}
                  </option>
                `).join('')}
              </select>
              <span class="muted">tot</span>
              <select class="stageSelect endStageSelect" aria-label="Eind etappe">
                <option value="">Einde</option>
                ${officialStages.map((s, i) => `
                  <option value="${i}" ${state.endStage === i ? 'selected' : ''}>
                    Etappe ${s.index}: ${escapeHtml(s.to)}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>
        `
            : ""
        }

        ${
          state.planMode === "custom" && totalKmDisplay
            ? `
          <div class="miniControlRow">
            <strong>Gedeelte</strong>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <button class="mapSelectToggle" aria-label="Selecteer op kaart">
                📍 Selecteer op kaart
              </button>
              <input class="kmInput startKmInput" type="number" value="${state.startKm ?? ''}" min="0" max="${totalKmNum ?? 0}" step="0.1" placeholder="0" aria-label="Start km"> km
              <span class="muted">tot</span>
              <input class="kmInput endKmInput" type="number" value="${state.endKm ?? ''}" min="0" max="${totalKmNum ?? 0}" step="0.1" placeholder="${formatKm(totalKmNum ?? 0)}" aria-label="Eind km"> km
            </div>
          </div>
        `
            : ""
        }

        <div class="miniControlRow">
          <strong>Startdatum</strong>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input class="startDateInput" type="date" value="${state.startDate || ''}" aria-label="Startdatum" style="width: 150px;">
            ${state.startDate ? `<button class="clearDateBtn" aria-label="Wis datum" style="background: #e74c3c; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; white-space: nowrap;">✕</button>` : ''}
          </div>
        </div>

        <div class="miniControlRow">
          <strong>Richting</strong>
          <button class="reverseBtn" aria-label="Omkeren">
            ${state.isReversed ? 'Zuid → Noord' : 'Noord → Zuid'}
          </button>
        </div>

        <ul class="stats">
          ${totalKmDisplay ? `<li>📍 ${escapeHtml(totalKmDisplay)} km</li>` : ""}
          ${
            state.planMode === "official"
              ? `<li>🧭 ${stages.length} etappes</li>`
              : stages.length
              ? `<li>🧭 ${stages.length} dagen</li>`
              : ""
          }
        </ul>
      </div>

      <h3 class="stageTitle">${state.planMode === "custom" ? "Dagen" : "Etappes"}</h3>
      <ul class="stageList" id="stageListContainer">
        ${(() => {
          if (state.planMode === "official") {
            // Official stages with rest days and dates
            const dateInfo = state.startDate ? calculateDayDates(state.startDate, stages, state.restDays) : [];
            let dayCounter = 1;
            let result = [];

            stages.forEach((s, i) => {
              const stageDate = dateInfo.find(d => d.type === 'stage' && d.index === i);
              const dateDisplay = stageDate ? `<span class="stageDate">${stageDate.displayDate}</span>` : '';

              result.push(`
                <li class="dayItem" data-stage-idx="${i}">
                  <button class="stageBtn" data-idx="${i}" aria-label="Bekijk dag ${dayCounter}, etappe ${s.index}">
                    <span class="stageLeft">
                      ${dateDisplay ? `${dateDisplay} — ` : ''}Dag ${dayCounter}
                    </span>
                    <span class="stageCenter">
                      <strong>Etappe ${s.index}: ${escapeHtml(s.from)} → ${escapeHtml(s.to)}</strong>
                    </span>
                    <span class="stageRight">
                      <span class="stageKm">${escapeHtml(formatKm(s.km))} km${s.hasDetour ? ` <span style="color: #2ecc71; font-size: 0.9em;">(+${formatKm(s.detourDistanceKm)} omweg)</span>` : ''}</span>
                      <span class="expandArrow">▶</span>
                    </span>
                  </button>
                  <div class="stageDetailInline" id="stageDetail-${i}"></div>
                </li>
              `);
              dayCounter++;

              // Add rest days if they exist after this stage
              const numRestDays = state.restDays[i] || 0;
              for (let r = 0; r < numRestDays; r++) {
                const restDates = dateInfo.filter(d => d.type === 'rest' && d.afterStageIndex === i);
                const restDate = restDates[r];
                const restDateDisplay = restDate ? `<span class="stageDate">${restDate.displayDate}</span>` : '';

                result.push(`
                  <li class="dayItem restDayItem">
                    <div class="restDayCard">
                      <span class="stageLeft">
                        ${restDateDisplay ? `${restDateDisplay} — ` : ''}Dag ${dayCounter}
                      </span>
                      <span class="stageCenter">
                        <strong>🛌 Rustdag${numRestDays > 1 ? ` ${r + 1}/${numRestDays}` : ''}</strong>
                      </span>
                      <span class="stageRight">
                        <button class="removeRestBtnSmall" data-after-idx="${i}" data-rest-number="${r}" title="Verwijder rustdag">✕</button>
                      </span>
                    </div>
                  </li>
                `);
                dayCounter++;
              }
            });

            return result.join("");
          }

          // Custom stages with rest days interleaved
          const dateInfo = state.startDate ? calculateDayDates(state.startDate, stages, state.restDays) : [];
          let dayCounter = 1;
          let result = [];

          stages.forEach((s, i) => {
            const hint = s.nearLabel
              ? `<span class="stageHint">— nabij ${escapeHtml(s.nearLabel)}</span>`
              : "";

            const vanNaar = s.fromLocation && s.toLocation
              ? `${escapeHtml(s.fromLocation)} → ${escapeHtml(s.toLocation)}`
              : s.toLocation
              ? `→ ${escapeHtml(s.toLocation)}`
              : s.fromLocation
              ? `${escapeHtml(s.fromLocation)} →`
              : "";

            const stageDate = dateInfo.find(d => d.type === 'stage' && d.index === i);
            const dateDisplay = stageDate ? `<span class="stageDate">${stageDate.displayDate}</span>` : '';

            result.push(`
              <li class="dayItem" data-stage-idx="${i}">
                <button class="stageBtn" data-idx="${i}" aria-label="Bekijk dag ${dayCounter}">
                  <span class="stageLeft">
                    ${dateDisplay ? `${dateDisplay} — ` : ''}Dag ${dayCounter}
                  </span>
                  <span class="stageCenter">
                    <strong>Etappe ${s.index}: ${vanNaar || (s.nearLabel ? `nabij ${escapeHtml(s.nearLabel)}` : `${formatKm(s.km)} km`)}</strong>
                  </span>
                  <span class="stageRight">
                    <span class="stageKm">${escapeHtml(formatKm(s.km))} km${s.hasDetour ? ` <span style="color: #2ecc71; font-size: 0.9em;">(+${formatKm(s.detourDistanceKm)} omweg)</span>` : ''}</span>
                    <span class="expandArrow">▶</span>
                  </span>
                </button>
                <div class="stageDetailInline" id="stageDetail-${i}"></div>
              </li>
            `);
            dayCounter++;

            // Add rest days if they exist after this stage
            const numRestDays = state.restDays[i] || 0;
            for (let r = 0; r < numRestDays; r++) {
              const restDates = dateInfo.filter(d => d.type === 'rest' && d.afterStageIndex === i);
              const restDate = restDates[r];
              const restDateDisplay = restDate ? `<span class="stageDate">${restDate.displayDate}</span>` : '';

              result.push(`
                <li class="dayItem restDayItem">
                  <div class="restDayCard">
                    <span class="stageLeft">
                      ${restDateDisplay ? `${restDateDisplay} — ` : ''}Dag ${dayCounter}
                    </span>
                    <span class="stageCenter">
                      <strong>🛌 Rustdag${numRestDays > 1 ? ` ${r + 1}/${numRestDays}` : ''}</strong>
                    </span>
                    <span class="stageRight">
                      <button class="removeRestBtnSmall" data-after-idx="${i}" data-rest-number="${r}" title="Verwijder rustdag">✕</button>
                    </span>
                  </div>
                </li>
              `);
              dayCounter++;
            }
          });

          return result.join("");
        })()}
      </ul>

      <div id="mapWithControls" style="position: relative;">
        <div class="poiControlRow" style="padding: 16px; background: rgba(255,255,255,0.95); border-radius: 8px; margin: 0 0 16px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <strong style="font-size: 14px;">📍 POI max afstand</strong>
            <span class="poiDistanceValue" style="font-weight: 600; font-size: 16px; color: #2c5282;">${state.maxPoiDistanceKm} km</span>
          </div>
          <input 
            class="poiDistanceSlider" 
            type="range" 
            min="0.5" 
            max="5" 
            step="0.5" 
            value="${state.maxPoiDistanceKm}"
            style="width: 100%;"
            aria-label="POI max afstand"
            title="Toon alleen POIs binnen deze afstand van de route">
          <p class="muted" style="font-size: 12px; margin: 8px 0 0 0; text-align: center;">Toon alleen POIs binnen deze afstand van de route</p>
        </div>

        <button id="fullscreenBtn" class="fullscreenBtn" title="Volledig scherm" style="position: absolute; top: 80px; right: 10px; z-index: 1000; background: white; border: 2px solid rgba(0,0,0,0.2); border-radius: 4px; padding: 8px 12px; cursor: pointer; font-size: 18px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
          ⛶
        </button>

        <div class="map-container" id="trailMap"></div>
      </div>
    `;

    // Add modal for map-based selection
    const modalHTML = `
      <div id="mapModal" class="mapModal" style="display: none;">
        <div class="mapModalOverlay"></div>
        <div class="mapModalContent">
          <div class="mapModalHeader">
            <h3>Selecteer start en einde op de kaart</h3>
            <button class="mapModalClose">✕</button>
          </div>
          <div class="mapModalInstruction">
            <span class="mapModalInstructionText">👆 Klik op de route voor startpunt</span>
          </div>
          <div class="fullMapModalMap" id="modalMap"></div>
          <div class="mapModalActions">
            <button class="confirmSelectionBtn">✓ Bevestig selectie</button>
            <button class="resetSelectionBtn">↻ Reset selectie</button>
          </div>
        </div>
      </div>
    `;

    // Add modal for custom stage endpoint adjustment
    const endpointModalHTML = `
      <div id="endpointModal" class="endpointModal" style="display: none;">
        <div class="endpointModalContent">
          <div class="endpointModalHeader">
            <h3>Pas eindpunt aan</h3>
            <button class="endpointModalClose">✕</button>
          </div>

          <div class="endpointDistanceSelector" style="padding: 16px; background: #f5f5f5; border-radius: 8px; margin-bottom: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <label style="font-weight: 600; font-size: 14px; color: #333;">Zoek POI's binnen:</label>
              <span class="endpointDistanceValue" style="font-weight: 600; font-size: 16px; color: #5B7C99;">${state.maxPoiDistanceKm} km</span>
            </div>
            <input 
              type="range" 
              class="endpointDistanceSlider" 
              min="0.5" 
              max="5" 
              step="0.5" 
              value="${state.maxPoiDistanceKm}"
              style="width: 100%; height: 8px; border-radius: 4px; outline: none; -webkit-appearance: none; background: linear-gradient(to right, #86efac 0%, #fde047 50%, #fca5a5 100%);"
              aria-label="POI zoek afstand">
            <p style="font-size: 11px; color: #888; margin: 6px 0 0 0; text-align: center;">Sleep om de zoekafstand aan te passen</p>
          </div>

          <div class="endpointOptions">
            <button class="endpointOption endpointOptionMap" data-type="map">
              🗺️ Selecteer op kaart
            </button>

            <div class="endpointDivider"></div>

            <button class="endpointOption" data-type="camping">
              ⛺ Dichtsbijzijnde camping
            </button>
            <button class="endpointOption" data-type="hotel">
              🏨 Dichtsbijzijnde hotel
            </button>
            <button class="endpointOption" data-type="station">
              🚂 Dichtsbijzijnde treinstation
            </button>
          </div>
        </div>
      </div>
    `;

    // Insert modals into the DOM
    if (!document.getElementById('mapModal')) {
      document.body.insertAdjacentHTML('beforeend', modalHTML);
    }
    if (!document.getElementById('endpointModal')) {
      document.body.insertAdjacentHTML('beforeend', endpointModalHTML);
    }

    // Always init map (handles null gpxProfile)
    await initMap(gpxProfile);

    // CRITICAL: After HTML re-render, tell Leaflet to recalculate the map size
    // The map container div was recreated by innerHTML, so we need to refresh
    if (state.map) {
      setTimeout(() => {
        state.map.invalidateSize();
        if (state.fullTrackLayer) {
          state.map.fitBounds(state.fullTrackLayer.getBounds());
        }
      }, 100);
    }

    // Re-open previously expanded stage if it exists (small delay to let DOM update)
    if (stages.length && state.expandedStageIndex !== null && state.expandedStageIndex < stages.length) {
      console.log('🔄 Re-opening previously expanded stage:', state.expandedStageIndex);
      setTimeout(() => {
        renderStageDetail(state.expandedStageIndex, true); // forceOpen=true to skip toggle
      }, 100); // Increased from 50ms to 100ms for more reliable re-opening
    }

    // Show message only if no stages exist
    if (!stages.length) {
      const el = document.querySelector("#stageDetail");
      if (el) el.innerHTML = `<p class="muted" style="margin-top:14px;">Geen items om te tonen.</p>`;
      // If no GPX and no stages, show message
      if (!gpxProfile) {
        const mapEl = document.getElementById("trailMap");
        if (mapEl) {
          mapEl.innerHTML = `<p class="muted" style="padding: 20px; text-align: center;">Geen GPX beschikbaar voor kaart.</p>`;
        }
        cleanupMap();
      }
    }
  } catch (err) {
    console.warn("Render full detail failed:", err);
    detailEl.innerHTML = renderErrorCard("Kon detail niet renderen", err, "Er is iets mis met de traildata of rendering.");
  }
}

// --------------------
// STAGE DETAIL
// --------------------
async function renderStageDetail(idx, forceOpen = false) {
  const s = state.currentStages[idx];
  if (!s) return;

  // Find the inline detail container for this stage
  const el = document.querySelector(`#stageDetail-${idx}`);
  if (!el) return;

  // Toggle: if clicking the same stage, close it (unless forceOpen is true)
  if (state.expandedStageIndex === idx && !forceOpen) {
    console.log('Toggling stage', idx, 'closed');
    el.innerHTML = '';
    el.classList.remove('isOpen');
    state.expandedStageIndex = null;

    // Update button states
    document.querySelectorAll(".stageBtn").forEach(btn => {
      btn.classList.remove("isActive");
      const arrow = btn.querySelector('.expandArrow');
      if (arrow) arrow.textContent = '▶';
    });
    return;
  }

  // Set this as the expanded stage
  console.log('Opening/refreshing stage', idx, 'forceOpen:', forceOpen);
  state.expandedStageIndex = idx;
  state.selectedStageIndex = idx;

  // Close all other details
  document.querySelectorAll('.stageDetailInline').forEach(detailEl => {
    if (detailEl.id !== `stageDetail-${idx}`) {
      detailEl.innerHTML = '';
      detailEl.classList.remove('isOpen');
    }
  });

  try {
    // Calculate date display (used by both modes)
    const dateInfo = state.startDate ? calculateDayDates(state.startDate, state.currentStages, state.restDays) : [];
    const stageDate = dateInfo.find(d => d.type === 'stage' && d.index === idx);
    const dateDisplay = stageDate ? `<p class="muted">${stageDate.displayDate}</p>` : '';

    if (s.type === "custom") {
      // Build the route line (without adjust button - now separate)
      let vanNaar = "";
      if (s.fromLocation && s.toLocation) {
        vanNaar = `<p class="routeLine"><strong>${escapeHtml(s.fromLocation)}</strong> → <strong>${escapeHtml(s.toLocation)}</strong></p>`;
      } else if (s.toLocation) {
        vanNaar = `<p class="routeLine">→ <strong>${escapeHtml(s.toLocation)}</strong></p>`;
      } else if (s.fromLocation) {
        vanNaar = `<p class="routeLine"><strong>${escapeHtml(s.fromLocation)}</strong> →</p>`;
      } else {
        vanNaar = `<p class="routeLine">Etappe ${s.index}</p>`;
      }

      // Calculate which "day" this is (including rest days)
      let dayNumber = s.index;
      Object.keys(state.restDays).forEach(stageIdx => {
        const numRests = state.restDays[stageIdx];
        if (parseInt(stageIdx) < idx) dayNumber += numRests;
      });

      // Check if this stage has an adjustment
      const adjustment = state.customStageAdjustments[idx];
      let adjustmentInfo = '';
      if (adjustment) {
        const adjustLabel = adjustment.reason === 'map' ? 'Handmatig' : adjustment.poiLabel || adjustment.reason;
        adjustmentInfo = `<p class="muted adjustmentInfo">📍 Eindpunt Aangepast: ${adjustLabel}`;

        if (adjustment.detourDistanceKm) {
          adjustmentInfo += ` <span style="color: #2ecc71; font-weight: 600;">+${formatKm(adjustment.detourDistanceKm)} km omweg</span>`;
        }

        // Show warning if walking distance is very long (> 3km)
        if (adjustment.hasOverlapWarning) {
          adjustmentInfo += ` <span style="color: #e74c3c; font-weight: 600;">⚠️ Lange omweg (>${formatKm(3)} km)</span>`;
        }

        adjustmentInfo += '</p>';
      }

      // Check if this stage returns from a POI
      let returnInfo = '';
      if (s.returnFromPOI) {
        returnInfo = `<p class="muted adjustmentInfo">🔙 Start bij: ${s.returnFromPOI.poiLabel} <span style="color: #3498db; font-weight: 600;">+${formatKm(s.returnFromPOI.returnDistanceKm)} km terug naar route</span></p>`;
      }

      // Check for route stops
      const routeStopsForStage = state.routeStops[idx] || [];
      let routeStopsInfo = '';
      if (routeStopsForStage.length > 0) {
        const totalStopsDetour = routeStopsForStage.reduce((sum, stop) => sum + (stop.totalDetourKm || 0), 0);
        const stopNames = routeStopsForStage.map(stop => stop.name).join(', ');
        routeStopsInfo = `
          <div style="display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 8px;">
            <p class="muted adjustmentInfo" style="margin: 0;">
              🛒 ${routeStopsForStage.length} stop${routeStopsForStage.length > 1 ? 's' : ''}: ${stopNames} 
              <span style="color: #27ae60; font-weight: 600;">+${formatKm(totalStopsDetour)} km</span>
            </p>
            <button class="clearRouteStopsBtn" data-stage-idx="${idx}" style="background: #e74c3c; color: white; border: none; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">
              ✕ Wis stops
            </button>
          </div>
        `;
      }


      el.innerHTML = `
        <div class="stageDetailContent">
          <!-- Top row: Route inline met Pas aan button -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div style="display: flex; gap: 12px; align-items: center;">
              <span style="margin: 0; font-weight: 600; color: #3E2A1A; font-size: 18px;">
                ${s.fromLocation && s.toLocation ? `<strong>${escapeHtml(s.fromLocation)}</strong> → <strong>${escapeHtml(s.toLocation)}</strong>` : 
                  s.toLocation ? `→ <strong>${escapeHtml(s.toLocation)}</strong>` :
                  s.fromLocation ? `<strong>${escapeHtml(s.fromLocation)}</strong> →` :
                  `Etappe ${s.index}`}
              </span>
              <button class="openEndpointModalBtn" data-stage-idx="${idx}" style="background: #5B7C99; color: white; border: 2px solid #5B7C99; padding: 6px 14px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; white-space: nowrap;">
                🎯 Pas Eindpunt Aan
              </button>
            </div>
            ${adjustment ? `
              <button class="resetEndpointBtn" data-stage-idx="${idx}" style="background: #B85C5C; color: white; border: 2px solid #B85C5C; padding: 6px 14px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; white-space: nowrap;">
                ↺ Reset
              </button>
            ` : ''}
          </div>

          <!-- Info row (centered) -->
          <div style="text-align: center; margin-bottom: 12px;">
            ${returnInfo}
            ${adjustmentInfo}
            ${routeStopsInfo}
          </div>

          ${dateDisplay}
          <div class="inlineMap" id="inlineMap-${idx}"></div>

          <!-- Elevation Profile -->
          <div class="elevationProfileContainer">
            <canvas id="elevationProfile-${idx}" style="display: block;"></canvas>
          </div>

          <!-- Bottom buttons (centered below map) -->
          <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 16px;">
            <button class="addRestBtnLarge" data-after-idx="${idx}" style="background: #C9963B; color: white; border: 2px solid #C9963B; padding: 12px 24px; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 15px;">
              + Voeg rustdag toe
            </button>
            <button class="downloadGpxBtn" data-stage-idx="${idx}" style="background: #7A9B76; color: white; border: 2px solid #7A9B76; padding: 12px 24px; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 15px;">
              📥 Download GPX
            </button>
          </div>
        </div>
      `;
    } else {
      el.innerHTML = `
        <div class="stageDetailContent">
          <div style="margin-bottom: 16px;">
            <p class="routeLine"><strong>${escapeHtml(s.from)}</strong> → <strong>${escapeHtml(s.to)}</strong></p>
          </div>

          ${dateDisplay}
          <div class="inlineMap" id="inlineMap-${idx}"></div>

          <!-- Elevation Profile -->
          <div class="elevationProfileContainer">
            <canvas id="elevationProfile-${idx}" style="display: block;"></canvas>
          </div>

          <!-- Bottom buttons -->
          <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 16px;">
            <button class="addRestBtnLarge" data-after-idx="${idx}" style="background: #C9963B; color: white; border: 2px solid #C9963B; padding: 12px 24px; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 15px;">
              + Voeg rustdag toe
            </button>
            <button class="downloadGpxBtn" data-stage-idx="${idx}" style="background: #7A9B76; color: white; border: 2px solid #7A9B76; padding: 12px 24px; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 15px;">
              📥 Download GPX
            </button>
          </div>
        </div>
      `;
    }

    el.classList.add('isOpen');

    // Update stage button states and arrows
    document.querySelectorAll(".stageBtn").forEach(btn => {
      const isActive = Number(btn.dataset.idx) === idx;
      btn.classList.toggle("isActive", isActive);

      // Update arrow direction
      const arrow = btn.querySelector('.expandArrow');
      if (arrow) {
        arrow.textContent = isActive ? '▼' : '▶';
      }
    });

    // Initialize map in the inline container
    setTimeout(() => {
      initInlineMap(idx, s);
    }, 100);

  } catch (err) {
    console.warn("Render stage detail failed:", err);
    el.innerHTML = `<div class="stageDetailContent"><p class="muted">Kon etappe niet laden</p></div>`;
    el.classList.add('isOpen');
  }
}

async function initInlineMap(idx, selectedStage) {
  const mapEl = document.getElementById(`inlineMap-${idx}`);
  if (!mapEl) return;

  // Clean up existing map for this stage
  if (state[`inlineMap_${idx}`]) {
    state[`inlineMap_${idx}`].remove();
    state[`inlineMap_${idx}`] = null;
  }

  // Clean up POI layer reference
  if (state[`poiLayer_${idx}`]) {
    state[`poiLayer_${idx}`] = null;
  }

  // Clean up tile layer reference
  if (state[`tileLayer_inline_${idx}`]) {
    state[`tileLayer_inline_${idx}`] = null;
  }

  // Clean up hover marker reference
  if (state[`hoverMarker_${idx}`]) {
    state[`hoverMarker_${idx}`] = null;
  }

  // Clean up old event handler if exists
  if (state[`filterHandler_${idx}`]) {
    document.removeEventListener('change', state[`filterHandler_${idx}`]);
    state[`filterHandler_${idx}`] = null;
  }

  // Clean up distance handler if exists
  if (state[`distanceHandler_${idx}`]) {
    document.removeEventListener('input', state[`distanceHandler_${idx}`]);
    state[`distanceHandler_${idx}`] = null;
  }

  const map = L.map(`inlineMap-${idx}`).setView([52.37, 4.89], 7);

  // Add tile layer and store reference
  state[`tileLayer_inline_${idx}`] = createTileLayer().addTo(map);

  state[`inlineMap_${idx}`] = map;

  // Add map style switcher control to inline map
  const inlineStyleControl = L.control({ position: 'bottomleft' });
  inlineStyleControl.onAdd = function() {
    const div = L.DomUtil.create('div', 'map-style-control');
    div.style.background = 'white';
    div.style.padding = '6px 10px';
    div.style.borderRadius = '4px';
    div.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    div.style.cursor = 'pointer';
    div.style.fontWeight = '600';
    div.style.fontSize = '13px';
    div.innerHTML = state.mapStyle === 'topo' ? '🗺️ OSM' : '🏔️ Topo';

    L.DomEvent.disableClickPropagation(div);

    div.onclick = function() {
      // Toggle map style
      state.mapStyle = state.mapStyle === 'osm' ? 'topo' : 'osm';
      console.log('Inline map', idx, 'switched to style:', state.mapStyle);
      savePreferences(); // Save preference

      // Remove old tile layer from this inline map
      const oldTileLayer = state[`tileLayer_inline_${idx}`];
      if (oldTileLayer) {
        map.removeLayer(oldTileLayer);
      }

      // Add new tile layer to this inline map
      state[`tileLayer_inline_${idx}`] = createTileLayer().addTo(map);

      // Update button label
      div.innerHTML = state.mapStyle === 'topo' ? '🗺️ OSM' : '🏔️ Topo';

      // Also update the main map if it exists
      if (state.map && state.tileLayer) {
        state.map.removeLayer(state.tileLayer);
        state.tileLayer = createTileLayer().addTo(state.map);
      }

      console.log('✅ All maps switched to', state.mapStyle);
    };

    return div;
  };
  inlineStyleControl.addTo(map);

  // Get GPX profile
  let gpxProfile = null;

  // For official stages, ALWAYS use the main trail GPX (which has POIs)
  // The stage-specific GPX files don't have waypoints/POIs
  if (selectedStage.type !== "custom" && selectedStage.gpx) {
    // Official stage - use main trail GPX for POIs, ignore stage-specific GPX
    console.log('Official stage - using main trail GPX for POIs');
    gpxProfile = state.gpxCache.get(`${state.currentTrailUrl}_${state.isReversed ? 'rev' : 'fwd'}`);
  } else if (selectedStage.gpx) {
    // Custom stage with specific GPX
    gpxProfile = await ensureGpxProfileForCurrentTrail(selectedStage.gpx);
  } else {
    // Use cached main trail GPX
    gpxProfile = state.gpxCache.get(`${state.currentTrailUrl}_${state.isReversed ? 'rev' : 'fwd'}`);
  }

  if (!gpxProfile?.points?.length) return;

  // Create POI layer group for this inline map and store in state
  const poiLayer = L.layerGroup().addTo(map);
  state[`poiLayer_${idx}`] = poiLayer;

  // Add compact POI dropdown filter button for inline map
  const inlinePoiFilter = L.control({ position: 'topright' });

  inlinePoiFilter.onAdd = function(m) {
    const div = L.DomUtil.create('div', 'poi-dropdown-control');

    // Helper function to check if a POI type is enabled in preferences
    const isEnabled = (type) => state.inlinePoiFilterPrefs.includes(type);

    // Count selected filters
    const selectedCount = state.inlinePoiFilterPrefs.length;

    div.innerHTML = `
      <button class="poi-dropdown-btn" data-map-id="${idx}" style="
        background: white;
        border: 1px solid #cbd5e0;
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        color: #4a5568;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 5px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        transition: all 0.15s;
      ">
        <span style="font-size: 10px;">📍</span>
        <span style="
          background: #5B7C99;
          color: white;
          padding: 1px 5px;
          border-radius: 8px;
          font-size: 10px;
          min-width: 14px;
          text-align: center;
          line-height: 1.2;
        ">${selectedCount}</span>
        <span style="font-size: 9px; transition: transform 0.2s; transform: rotate(180deg);">▼</span>
      </button>

      <div class="poi-dropdown-menu" data-map-id="${idx}" style="
        display: block;
        position: absolute;
        top: 35px;
        right: 0;
        background: white;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        padding: 8px;
        min-width: 160px;
        max-height: 480px;
        overflow-y: auto;
        z-index: 1000;
        border: 1px solid #e2e8f0;
      ">
        <div style="font-weight: 600; margin-bottom: 6px; font-size: 11px; color: #2d3748;">
          📍 POI Types
        </div>

        <div style="margin-bottom: 4px;">
          <label style="display: flex; align-items: center; padding: 3px 4px; margin: 1px 0; cursor: pointer; border-radius: 3px; transition: background 0.15s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" class="inline-poi-filter" data-map-id="${idx}" value="camping" ${isEnabled('camping') ? 'checked' : ''} style="margin-right: 6px; cursor: pointer; width: 13px; height: 13px;"> 
            <span style="font-size: 11px;">⛺ Camping</span>
          </label>
          <label style="display: flex; align-items: center; padding: 3px 4px; margin: 1px 0; cursor: pointer; border-radius: 3px; transition: background 0.15s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" class="inline-poi-filter" data-map-id="${idx}" value="hotel" ${isEnabled('hotel') ? 'checked' : ''} style="margin-right: 6px; cursor: pointer; width: 13px; height: 13px;"> 
            <span style="font-size: 11px;">🏨 Hotel</span>
          </label>
          <label style="display: flex; align-items: center; padding: 3px 4px; margin: 1px 0; cursor: pointer; border-radius: 3px; transition: background 0.15s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" class="inline-poi-filter" data-map-id="${idx}" value="station" ${isEnabled('station') ? 'checked' : ''} style="margin-right: 6px; cursor: pointer; width: 13px; height: 13px;"> 
            <span style="font-size: 11px;">🚂 Station</span>
          </label>
        </div>

        <hr style="margin: 4px 0; border: none; border-top: 1px solid #e8e8e8;">

        <div>
          <label style="display: flex; align-items: center; padding: 3px 4px; margin: 1px 0; cursor: pointer; border-radius: 3px; transition: background 0.15s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" class="inline-poi-filter" data-map-id="${idx}" value="restaurant" ${isEnabled('restaurant') ? 'checked' : ''} style="margin-right: 6px; cursor: pointer; width: 13px; height: 13px;"> 
            <span style="font-size: 11px;">🍽️ Restaurant</span>
          </label>
          <label style="display: flex; align-items: center; padding: 3px 4px; margin: 1px 0; cursor: pointer; border-radius: 3px; transition: background 0.15s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" class="inline-poi-filter" data-map-id="${idx}" value="supermarket" ${isEnabled('supermarket') ? 'checked' : ''} style="margin-right: 6px; cursor: pointer; width: 13px; height: 13px;"> 
            <span style="font-size: 11px;">🛒 Supermarkt</span>
          </label>
          <label style="display: flex; align-items: center; padding: 3px 4px; margin: 1px 0; cursor: pointer; border-radius: 3px; transition: background 0.15s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" class="inline-poi-filter" data-map-id="${idx}" value="water" ${isEnabled('water') ? 'checked' : ''} style="margin-right: 6px; cursor: pointer; width: 13px; height: 13px;"> 
            <span style="font-size: 11px;">💧 Water</span>
          </label>
          <label style="display: flex; align-items: center; padding: 3px 4px; margin: 1px 0; cursor: pointer; border-radius: 3px; transition: background 0.15s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" class="inline-poi-filter" data-map-id="${idx}" value="bakery" ${isEnabled('bakery') ? 'checked' : ''} style="margin-right: 6px; cursor: pointer; width: 13px; height: 13px;"> 
            <span style="font-size: 11px;">🥐 Bakkerij</span>
          </label>
          <label style="display: flex; align-items: center; padding: 3px 4px; margin: 1px 0; cursor: pointer; border-radius: 3px; transition: background 0.15s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" class="inline-poi-filter" data-map-id="${idx}" value="pharmacy" ${isEnabled('pharmacy') ? 'checked' : ''} style="margin-right: 6px; cursor: pointer; width: 13px; height: 13px;"> 
            <span style="font-size: 11px;">💊 Apotheek</span>
          </label>
          <label style="display: flex; align-items: center; padding: 3px 4px; margin: 1px 0; cursor: pointer; border-radius: 3px; transition: background 0.15s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" class="inline-poi-filter" data-map-id="${idx}" value="picnic" ${isEnabled('picnic') ? 'checked' : ''} style="margin-right: 6px; cursor: pointer; width: 13px; height: 13px;"> 
            <span style="font-size: 11px;">🧺 Picknick</span>
          </label>
          <label style="display: flex; align-items: center; padding: 3px 4px; margin: 1px 0; cursor: pointer; border-radius: 3px; transition: background 0.15s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'">
            <input type="checkbox" class="inline-poi-filter" data-map-id="${idx}" value="bench" ${isEnabled('bench') ? 'checked' : ''} style="margin-right: 6px; cursor: pointer; width: 13px; height: 13px;"> 
            <span style="font-size: 11px;">🪑 Bankje</span>
          </label>
        </div>

        <hr style="margin: 8px 0; border: none; border-top: 1px solid #e8e8e8;">

        <div style="padding: 4px 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <span style="font-size: 10px; font-weight: 600; color: #4a5568;">📏 Max afstand</span>
            <span class="inline-poi-distance-value" data-map-id="${idx}" style="font-size: 11px; font-weight: 600; color: #2c5282;">${state.maxPoiDistanceKm * 1000}m</span>
          </div>
          <input 
            type="range" 
            class="inline-poi-distance-slider" 
            data-map-id="${idx}"
            min="100" 
            max="5000" 
            step="100" 
            value="${state.maxPoiDistanceKm * 1000}"
            style="width: 100%; height: 6px; cursor: pointer;">
          <div style="display: flex; justify-content: space-between; font-size: 9px; color: #a0aec0; margin-top: 2px;">
            <span>100m</span>
            <span>5km</span>
          </div>
        </div>
      </div>
    `;

    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    return div;
  };

  inlinePoiFilter.addTo(map);

  // Add dropdown toggle functionality
  setTimeout(() => {
    const dropdownBtn = map.getContainer().querySelector(`.poi-dropdown-btn[data-map-id="${idx}"]`);
    const dropdownMenu = map.getContainer().querySelector(`.poi-dropdown-menu[data-map-id="${idx}"]`);

    if (dropdownBtn && dropdownMenu) {
      dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = dropdownMenu.style.display === 'block';

        // Toggle this dropdown (only closes when clicking button again)
        dropdownMenu.style.display = isVisible ? 'none' : 'block';

        // Rotate arrow
        const arrow = dropdownBtn.querySelector('span:last-child');
        if (arrow) {
          arrow.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
        }
      });

      // Prevent map clicks from propagating when interacting with dropdown
      dropdownMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }
  }, 100);

  // Store reference to handler so we can remove it later
  const filterChangeHandler = function(e) {
    if (e.target.classList.contains('inline-poi-filter') && e.target.dataset.mapId == idx) {
      // Get enabled types for this specific map
      const enabledTypes = [];
      document.querySelectorAll(`.inline-poi-filter[data-map-id="${idx}"]:checked`).forEach(cb => {
        enabledTypes.push(cb.value);
      });

      console.log('Inline map', idx, 'filter changed. Enabled types:', enabledTypes);

      // Save preferences to state (will be remembered for all future inline maps)
      state.inlinePoiFilterPrefs = enabledTypes;
      console.log('Saved POI filter preferences:', state.inlinePoiFilterPrefs);
      savePreferences(); // Save to localStorage

      // Update counter in dropdown button
      const dropdownBtn = map.getContainer().querySelector(`.poi-dropdown-btn[data-map-id="${idx}"]`);
      if (dropdownBtn) {
        const counter = dropdownBtn.querySelector('span:nth-child(2)');
        if (counter) {
          counter.textContent = enabledTypes.length;
        }
      }

      // Get the stored POI layer for this map
      const storedPoiLayer = state[`poiLayer_${idx}`];
      const maxDistanceKm = state[`inlinePoiDistance_${idx}`] || state.maxPoiDistanceKm;

      if (storedPoiLayer) {
        // Re-render POIs with the selected types and distance, passing stage index
        renderPOIMarkers(map, storedPoiLayer, gpxProfile, enabledTypes, maxDistanceKm, idx);
      }

      // Also update the elevation profile with the new POI selection
      updateElevationProfilePOIs(idx, gpxProfile, selectedStage, enabledTypes, maxDistanceKm);
    }
  };

  // Add handler
  document.addEventListener('change', filterChangeHandler);

  // Store handler reference for cleanup
  state[`filterHandler_${idx}`] = filterChangeHandler;

  // Distance slider handler
  const distanceSliderHandler = function(e) {
    if (e.target.classList.contains('inline-poi-distance-slider') && e.target.dataset.mapId == idx) {
      const distanceMeters = parseInt(e.target.value);
      const distanceKm = distanceMeters / 1000;

      console.log('Inline map', idx, 'distance changed to:', distanceMeters, 'm');

      // Update display value
      const valueDisplay = document.querySelector(`.inline-poi-distance-value[data-map-id="${idx}"]`);
      if (valueDisplay) {
        valueDisplay.textContent = distanceMeters >= 1000 ? `${(distanceMeters/1000).toFixed(1)}km` : `${distanceMeters}m`;
      }

      // Store distance per map in state
      state[`inlinePoiDistance_${idx}`] = distanceKm;

      // Get enabled types
      const enabledTypes = [];
      document.querySelectorAll(`.inline-poi-filter[data-map-id="${idx}"]:checked`).forEach(cb => {
        enabledTypes.push(cb.value);
      });

      // Re-render POIs with the new distance filter
      const storedPoiLayer = state[`poiLayer_${idx}`];
      if (storedPoiLayer) {
        renderPOIMarkers(map, storedPoiLayer, gpxProfile, enabledTypes, distanceKm, idx);
      }

      // Also update the elevation profile
      updateElevationProfilePOIs(idx, gpxProfile, selectedStage, enabledTypes, distanceKm);
    }
  };

  document.addEventListener('input', distanceSliderHandler);
  state[`distanceHandler_${idx}`] = distanceSliderHandler;

  // Draw the stage segment
  if (selectedStage.type === "custom" && selectedStage.startIndex !== null && selectedStage.endIndex !== null) {
    // First draw the full route as dashed gray background (not walked today)
    const fullTrackPoints = gpxProfile.points.map(p => [p.lat, p.lon]);
    L.polyline(fullTrackPoints, {
      color: '#8B4513',
      weight: 4,
      opacity: 0.6,
      dashArray: '8, 8',
    }).addTo(map);

    // Then draw the selected segment as thick blue line on top (today's stage)
    const segmentPoints = gpxProfile.points.slice(selectedStage.startIndex, selectedStage.endIndex + 1).map(p => [p.lat, p.lon]);
    if (segmentPoints.length > 1) {
      const polyline = L.polyline(segmentPoints, {
        color: '#2980b9',
        weight: 6,
      }).addTo(map);

      L.marker(segmentPoints[0]).addTo(map).bindPopup(`Start`);
      L.marker(segmentPoints[segmentPoints.length - 1]).addTo(map).bindPopup(`Einde`);

      // Check if this stage has a detour route to a POI
      const adjustment = state.customStageAdjustments[idx];
      if (adjustment && adjustment.detourRoute && adjustment.detourFromTrailPoint) {
        console.log('🛤️ Drawing detour route for stage', idx);

        // Build popup text
        let popupText = `Omweg naar ${adjustment.poiLabel}: ${adjustment.detourRoute.distanceKm.toFixed(2)} km (volgende dag terug)`;
        if (adjustment.hasOverlapWarning) {
          popupText += `<br><span style="color: #e74c3c;">⚠️ Lange omweg (>${formatKm(3)} km)</span>`;
        }

        // Draw detour route as dashed green line
        const detourPoints = adjustment.detourRoute.coordinates.map(c => [c.lat, c.lon]);
        L.polyline(detourPoints, {
          color: '#2ecc71',
          weight: 4,
          dashArray: '10, 10',
          opacity: 0.8,
        }).addTo(map).bindPopup(popupText);

        // Add marker at POI location
        const poiIcon = L.divIcon({
          html: `<div style="background-color: #2ecc71; width: 32px; height: 32px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 3px 6px rgba(0,0,0,0.4);">🎯</div>`,
          className: 'poi-target-marker',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        // Build marker popup
        let markerPopup = `<strong>${adjustment.poiLabel}</strong><br>Omweg: +${adjustment.detourRoute.distanceKm.toFixed(2)} km`;
        if (adjustment.hasOverlapWarning) {
          markerPopup += `<br><span style="color: #e74c3c;">⚠️ Lange omweg</span>`;
        }

        L.marker([adjustment.poiLat, adjustment.poiLon], { icon: poiIcon })
          .addTo(map)
          .bindPopup(markerPopup);
      }

      // Check if this stage returns from a POI (from previous stage)
      if (selectedStage.returnFromPOI) {
        console.log('🔙 Drawing return route for stage', idx);

        const returnInfo = selectedStage.returnFromPOI;

        // Draw return route as dashed blue line
        const returnPoints = returnInfo.returnRoute.coordinates.map(c => [c.lat, c.lon]);
        L.polyline(returnPoints, {
          color: '#3498db',
          weight: 4,
          dashArray: '10, 10',
          opacity: 0.8,
        }).addTo(map).bindPopup(`Terug van ${returnInfo.poiLabel} naar route: ${returnInfo.returnDistanceKm.toFixed(2)} km`);

        // Add marker at POI location (start of return)
        const returnPoiIcon = L.divIcon({
          html: `<div style="background-color: #3498db; width: 32px; height: 32px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 3px 6px rgba(0,0,0,0.4);">🏁</div>`,
          className: 'return-start-marker',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        L.marker([returnInfo.poiLat, returnInfo.poiLon], { icon: returnPoiIcon })
          .addTo(map)
          .bindPopup(`<strong>Start dag ${idx + 1}: ${returnInfo.poiLabel}</strong><br>Terug naar route: ${returnInfo.returnDistanceKm.toFixed(2)} km`);
      }

      // Draw route stops (waypoint detours)
      const routeStops = state.routeStops[idx] || [];
      if (routeStops.length > 0) {
        console.log(`🛒 Drawing ${routeStops.length} route stops for stage`, idx);

        routeStops.forEach((stop, stopIdx) => {
          // Get icon for this POI type
          const poiStyle = getPOIStyle(stop.type);

          // Draw detour TO the stop (green dashed line)
          if (stop.detourToRoute && stop.detourToRoute.coordinates) {
            const toPoints = stop.detourToRoute.coordinates.map(c => [c.lat, c.lon]);
            L.polyline(toPoints, {
              color: '#27ae60',
              weight: 3,
              dashArray: '8, 8',
              opacity: 0.8,
            }).addTo(map).bindPopup(`Naar ${stop.name}: ${stop.detourToRoute.distanceKm.toFixed(2)} km`);
          }

          // Draw detour BACK from the stop (lighter green dashed line)
          if (stop.detourBackRoute && stop.detourBackRoute.coordinates) {
            const backPoints = stop.detourBackRoute.coordinates.map(c => [c.lat, c.lon]);
            L.polyline(backPoints, {
              color: '#58d68d',
              weight: 3,
              dashArray: '8, 8',
              opacity: 0.7,
            }).addTo(map).bindPopup(`Terug naar route: ${stop.detourBackRoute.distanceKm.toFixed(2)} km`);
          }

          // Add marker at stop location
          const stopIcon = L.divIcon({
            html: `<div style="
              background-color: #27ae60;
              width: 28px;
              height: 28px;
              border-radius: 50%;
              border: 3px solid white;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 16px;
              box-shadow: 0 2px 6px rgba(0,0,0,0.4);
            ">${poiStyle.icon}</div>`,
            className: 'route-stop-marker',
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });

          const stopPopup = `
            <strong>${stop.name}</strong><br>
            <span style="color: #666;">${poiStyle.label}</span><br>
            <span style="color: #27ae60;">+${stop.totalDetourKm.toFixed(2)} km (heen + terug)</span>
          `;

          L.marker([stop.lat, stop.lon], { icon: stopIcon })
            .addTo(map)
            .bindPopup(stopPopup);

          // Add small marker at trail connection point
          const connectionIcon = L.divIcon({
            html: `<div style="
              background-color: #27ae60;
              width: 12px;
              height: 12px;
              border-radius: 50%;
              border: 2px solid white;
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            "></div>`,
            className: 'route-connection-marker',
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          });

          L.marker([stop.trailPoint.lat, stop.trailPoint.lon], { icon: connectionIcon })
            .addTo(map)
            .bindPopup(`Afslag naar ${stop.name}`);
        });
      }

      // Get enabled types from checkboxes for initial render
      const enabledTypes = [];
      document.querySelectorAll(`.inline-poi-filter[data-map-id="${idx}"]:checked`).forEach(cb => {
        enabledTypes.push(cb.value);
      });

      console.log('Initial POI render for map', idx, 'with types:', enabledTypes);

      // Add POIs based on filter state using stored layer
      const storedPoiLayer = state[`poiLayer_${idx}`];
      const maxDistanceKm = state[`inlinePoiDistance_${idx}`] || state.maxPoiDistanceKm;
      if (storedPoiLayer) {
        renderPOIMarkers(map, storedPoiLayer, gpxProfile, enabledTypes, maxDistanceKm, idx);
      }

      // Calculate bounds to include all route segments (stage + detour + return + stops)
      let allPoints = [...segmentPoints];

      // Include detour route points
      if (adjustment && adjustment.detourRoute) {
        const detourPoints = adjustment.detourRoute.coordinates.map(c => [c.lat, c.lon]);
        allPoints = allPoints.concat(detourPoints);
      }

      // Include return route points
      if (selectedStage.returnFromPOI && selectedStage.returnFromPOI.returnRoute) {
        const returnPoints = selectedStage.returnFromPOI.returnRoute.coordinates.map(c => [c.lat, c.lon]);
        allPoints = allPoints.concat(returnPoints);
      }

      // Include route stops detour points
      if (routeStops.length > 0) {
        routeStops.forEach(stop => {
          allPoints.push([stop.lat, stop.lon]);
          if (stop.detourToRoute && stop.detourToRoute.coordinates) {
            allPoints = allPoints.concat(stop.detourToRoute.coordinates.map(c => [c.lat, c.lon]));
          }
          if (stop.detourBackRoute && stop.detourBackRoute.coordinates) {
            allPoints = allPoints.concat(stop.detourBackRoute.coordinates.map(c => [c.lat, c.lon]));
          }
        });
      }

      // Fit bounds to include all points
      if (allPoints.length > 0) {
        const bounds = L.latLngBounds(allPoints);
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    }
  } else if (gpxProfile) {
    // Official stage - calculate which segment to highlight

    // Calculate cumulative distance to find this stage's start/end km
    const allOfficialStages = state.currentTrailData?.stages ?? state.currentTrailData?.etappes ?? [];

    let stageStartKm = 0;
    let stageEndKm = 0;

    // Find this stage in the original stages array and calculate cumulative distance
    let cumulativeKm = 0;
    for (let i = 0; i < allOfficialStages.length; i++) {
      const stageKm = parseFloat(allOfficialStages[i]?.km ?? allOfficialStages[i]?.distance_km ?? 0);

      // Check if this is our stage (match by index or from/to)
      const isOurStage = (i + 1) === selectedStage.index || 
                         (allOfficialStages[i].from === selectedStage.from && 
                          allOfficialStages[i].to === selectedStage.to);

      if (isOurStage) {
        stageStartKm = cumulativeKm;
        stageEndKm = cumulativeKm + stageKm;
        break;
      }

      cumulativeKm += stageKm;
    }

    console.log(`Official stage ${selectedStage.index}: ${stageStartKm}km - ${stageEndKm}km`);

    // Handle reversed route
    if (state.isReversed && gpxProfile.totalDistanceKm) {
      const temp = stageStartKm;
      stageStartKm = gpxProfile.totalDistanceKm - stageEndKm;
      stageEndKm = gpxProfile.totalDistanceKm - temp;
    }

    // Find GPX points that fall within this stage's km range
    const stagePoints = [];
    const allTrackPoints = gpxProfile.points.map(p => [p.lat, p.lon]);

    gpxProfile.points.forEach((p, i) => {
      const pointKm = p.distanceKm || 0;
      if (pointKm >= stageStartKm && pointKm <= stageEndKm) {
        stagePoints.push([p.lat, p.lon]);
      }
    });

    // Draw full route as dashed brown background (not walked today)
    L.polyline(allTrackPoints, {
      color: '#8B4513',
      weight: 4,
      opacity: 0.6,
      dashArray: '8, 8',
    }).addTo(map);

    // Draw this stage's segment as thick blue line (today's stage)
    if (stagePoints.length > 1) {
      const segmentLine = L.polyline(stagePoints, {
        color: '#2980b9',
        weight: 6,
      }).addTo(map);

      // Add start/end markers
      L.marker(stagePoints[0]).addTo(map).bindPopup(`Start: ${selectedStage.from}`);
      L.marker(stagePoints[stagePoints.length - 1]).addTo(map).bindPopup(`Einde: ${selectedStage.to}`);

      // Zoom to this segment
      map.fitBounds(segmentLine.getBounds(), { padding: [20, 20] });
    } else {
      // Fallback: show full route if segment detection failed
      const polyline = L.polyline(allTrackPoints, {
        color: '#2980b9',
        weight: 6,
      }).addTo(map);
      map.fitBounds(polyline.getBounds());
    }

    // Get enabled types from checkboxes for initial render
    const enabledTypes = [];
    document.querySelectorAll(`.inline-poi-filter[data-map-id="${idx}"]:checked`).forEach(cb => {
      enabledTypes.push(cb.value);
    });

    console.log('Initial POI render for map', idx, 'with types:', enabledTypes);

    // Add POIs based on filter state using stored layer
    const storedPoiLayer = state[`poiLayer_${idx}`];
    const officialMaxDistanceKm = state[`inlinePoiDistance_${idx}`] || state.maxPoiDistanceKm;
    if (storedPoiLayer) {
      renderPOIMarkers(map, storedPoiLayer, gpxProfile, enabledTypes, officialMaxDistanceKm, idx);
    }
  }

  // Render elevation profile for this stage
  if (gpxProfile && gpxProfile.points) {
    const canvasId = `elevationProfile-${idx}`;

    // Determine which segment of points to show
    let startIdx = 0;
    let endIdx = gpxProfile.points.length - 1;

    if (selectedStage.type === 'custom') {
      // Custom stage - use startIndex and endIndex from the stage
      if (selectedStage.startIndex !== null && selectedStage.startIndex !== undefined) {
        startIdx = selectedStage.startIndex;
      }
      if (selectedStage.endIndex !== null && selectedStage.endIndex !== undefined) {
        endIdx = selectedStage.endIndex;
      }
      console.log(`Elevation profile for custom stage ${idx}: points ${startIdx} to ${endIdx}`);
    } else {
      // Official stage - calculate based on km
      const allOfficialStages = state.currentTrailData?.stages ?? state.currentTrailData?.etappes ?? [];
      let stageStartKm = 0;
      let stageEndKm = 0;
      let cumulativeKm = 0;

      for (let i = 0; i < allOfficialStages.length; i++) {
        const stageKm = parseFloat(allOfficialStages[i]?.km ?? allOfficialStages[i]?.distance_km ?? 0);
        const isOurStage = (i + 1) === selectedStage.index || 
                           (allOfficialStages[i].from === selectedStage.from && 
                            allOfficialStages[i].to === selectedStage.to);
        if (isOurStage) {
          stageStartKm = cumulativeKm;
          stageEndKm = cumulativeKm + stageKm;
          break;
        }
        cumulativeKm += stageKm;
      }

      // Handle reversed route
      if (state.isReversed && gpxProfile.totalKm) {
        const temp = stageStartKm;
        stageStartKm = gpxProfile.totalKm - stageEndKm;
        stageEndKm = gpxProfile.totalKm - temp;
      }

      // Find point indices for this km range
      startIdx = gpxProfile.points.findIndex(p => (p.distanceKm || 0) >= stageStartKm);
      endIdx = gpxProfile.points.findIndex(p => (p.distanceKm || 0) >= stageEndKm);

      if (startIdx === -1) startIdx = 0;
      if (endIdx === -1) endIdx = gpxProfile.points.length - 1;

      console.log(`Elevation profile for official stage ${idx}: ${stageStartKm.toFixed(1)}-${stageEndKm.toFixed(1)} km, points ${startIdx} to ${endIdx}`);
    }

    // Get POIs/waypoints for this stage's km range
    const stageStartKm = gpxProfile.points[startIdx]?.distanceKm || 0;
    const stageEndKm = gpxProfile.points[endIdx]?.distanceKm || 0;

    // Get enabled POI types from the inline map checkboxes
    const enabledTypes = [];
    document.querySelectorAll(`.inline-poi-filter[data-map-id="${idx}"]:checked`).forEach(cb => {
      enabledTypes.push(cb.value);
    });

    // Get max distance (use stored value for this map or default)
    const maxDistanceKm = state[`inlinePoiDistance_${idx}`] || state.maxPoiDistanceKm;

    // Filter waypoints to only those within this stage, matching enabled types, distance, and exclude 'plaats'
    const stagePois = (gpxProfile.waypoints || []).filter(wp => {
      const wpKm = wp.km || wp.distanceKm;
      const wpType = (wp.type || '').toLowerCase();
      const wpDistanceToRoute = wp.distanceToRoute || 0; // in km
      // Exclude 'plaats' (place names) and only include POIs within range AND matching enabled types AND within distance
      return wpType !== 'plaats' && 
             wpKm >= stageStartKm && 
             wpKm <= stageEndKm &&
             enabledTypes.includes(wpType) &&
             wpDistanceToRoute <= maxDistanceKm;
    });

    // Add route stops to elevation profile (always show these, they're part of the route)
    const routeStopsForElevation = (state.routeStops[idx] || []).map(stop => ({
      ...stop,
      km: stop.trailKm,
      distanceKm: stop.trailKm,
      isRouteStop: true // Mark as route stop for special styling
    }));

    const allPoisForProfile = [...stagePois, ...routeStopsForElevation];

    console.log(`Found ${stagePois.length} POIs + ${routeStopsForElevation.length} route stops for elevation profile`);

    // Delay to ensure canvas container is rendered and sized
    setTimeout(() => {
      renderElevationProfile(canvasId, gpxProfile.points, startIdx, endIdx, allPoisForProfile);
    }, 200);
  }
}

// --------------------
// ENDPOINT ADJUSTMENT
// --------------------
function openEndpointModal(stageIdx) {
  console.log("🔵 openEndpointModal called with stageIdx:", stageIdx);
  state.editingStageIndex = stageIdx;
  const modal = document.getElementById('endpointModal');
  console.log("🔵 Modal element:", modal);
  if (!modal) {
    console.error("❌ Modal element not found!");
    return;
  }
  console.log("🔵 Setting modal display to flex...");
  modal.style.display = 'flex';
  console.log("✅ Modal should be visible now!");

  // Set the distance slider to current value
  const distanceSlider = modal.querySelector('.endpointDistanceSlider');
  const distanceValue = modal.querySelector('.endpointDistanceValue');
  if (distanceSlider) {
    distanceSlider.value = state.maxPoiDistanceKm;
  }
  if (distanceValue) {
    distanceValue.textContent = `${state.maxPoiDistanceKm} km`;
  }

  // Check which POI types are available for this stage
  const stage = state.currentStages[stageIdx];
  if (stage && stage.type === 'custom') {
    const direction = state.isReversed ? 'rev' : 'fwd';
    const cacheKey = `${state.currentTrailUrl}_${direction}`;
    const gpxProfile = state.gpxCache.get(cacheKey);

    if (gpxProfile) {
      // Check each POI type (only relevant endpoint types)
      const poiTypes = ['camping', 'hotel', 'station'];

      poiTypes.forEach(type => {
        const btn = modal.querySelector(`.endpointOption[data-type="${type}"]`);
        if (btn) {
          const available = findNearestPOI(stage.rangeEndKm, type, gpxProfile);
          if (!available) {
            btn.classList.add('disabled');
            btn.style.opacity = '0.4';
            btn.style.cursor = 'not-allowed';
          } else {
            btn.classList.remove('disabled');
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
          }
        }
      });
    }
  }
}

// Loading indicator functions
function showLoadingIndicator(message) {
  // Remove existing indicator if present
  hideLoadingIndicator();

  const overlay = document.createElement('div');
  overlay.id = 'loadingOverlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(4px);
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    padding: 30px 40px;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    text-align: center;
    max-width: 400px;
  `;

  // Spinner
  const spinner = document.createElement('div');
  spinner.style.cssText = `
    border: 4px solid #f3f3f3;
    border-top: 4px solid #3498db;
    border-radius: 50%;
    width: 50px;
    height: 50px;
    animation: spin 1s linear infinite;
    margin: 0 auto 20px;
  `;

  // Add keyframe animation for spinner
  if (!document.getElementById('spinnerStyle')) {
    const style = document.createElement('style');
    style.id = 'spinnerStyle';
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  const text = document.createElement('div');
  text.innerHTML = message;
  text.style.cssText = `
    font-size: 18px;
    color: #333;
    line-height: 1.5;
  `;

  content.appendChild(spinner);
  content.appendChild(text);
  overlay.appendChild(content);
  document.body.appendChild(overlay);
}

function hideLoadingIndicator() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.remove();
  }
}

function showErrorModal(title, message) {
  // Remove existing error modal if present
  const existing = document.getElementById('errorModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'errorModal';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(4px);
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white;
    padding: 30px;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
  `;

  const titleEl = document.createElement('h2');
  titleEl.textContent = title;
  titleEl.style.cssText = `
    margin: 0 0 15px 0;
    color: #e74c3c;
    font-size: 24px;
  `;

  const messageEl = document.createElement('div');
  messageEl.innerHTML = message.replace(/\n/g, '<br>');
  messageEl.style.cssText = `
    margin-bottom: 20px;
    color: #333;
    line-height: 1.6;
  `;

  const button = document.createElement('button');
  button.textContent = 'OK';
  button.style.cssText = `
    background: #3498db;
    color: white;
    border: none;
    padding: 10px 30px;
    border-radius: 6px;
    font-size: 16px;
    cursor: pointer;
    width: 100%;
  `;
  button.onmouseover = () => button.style.background = '#2980b9';
  button.onmouseout = () => button.style.background = '#3498db';
  button.onclick = () => overlay.remove();

  modal.appendChild(titleEl);
  modal.appendChild(messageEl);
  modal.appendChild(button);
  overlay.appendChild(modal);

  // Close on overlay click
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  // Close on Escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  document.body.appendChild(overlay);
}

function closeEndpointModal() {
  const modal = document.getElementById('endpointModal');
  if (!modal) return;
  modal.style.display = 'none';
  state.editingStageIndex = null;
}

async function adjustStageEndpoint(stageIdx, type) {
  const stage = state.currentStages[stageIdx];
  if (!stage || stage.type !== 'custom') return;

  // Get GPX profile
  const direction = state.isReversed ? 'rev' : 'fwd';
  const cacheKey = `${state.currentTrailUrl}_${direction}`;
  const gpxProfile = state.gpxCache.get(cacheKey);
  if (!gpxProfile) return;

  console.log('Adjusting stage', stageIdx, 'type:', type);
  console.log('GPX waypoints available:', gpxProfile.waypoints?.length || 0);

  if (type === 'map') {
    // Open map modal for this specific stage
    closeEndpointModal();
    openStageMapModal(stageIdx, stage);
    return;
  }

  // Close modal FIRST, before showing loading indicator
  closeEndpointModal();

  // Show loading indicator
  showLoadingIndicator('⏳ Route berekenen...<br><small>Dit kan enkele seconden duren</small>');

  // CRITICAL: Give browser time to render the loading indicator before starting heavy work
  // Without this, the indicator won't appear until after all OSRM calls are done!
  await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay for UI to update

  // Find nearest POI of the requested type
  const nearestPOI = findNearestPOI(stage.rangeEndKm, type, gpxProfile);

  console.log('Nearest POI found:', nearestPOI);

  if (!nearestPOI) {
    hideLoadingIndicator();
    // Check if there are ANY POIs of this type (even far away)
    const allPOIsOfType = gpxProfile.waypoints?.filter(w => 
      w.type && w.type.toLowerCase() === type.toLowerCase()
    ) || [];

    if (allPOIsOfType.length === 0) {
      showErrorModal(
        `Geen ${type} gevonden`,
        `Geen ${type} waypoints gevonden in deze GPX.\n\nWaypoints beschikbaar: ${gpxProfile.waypoints?.length || 0}\n\nTypes: ${[...new Set((gpxProfile.waypoints || []).map(w => w.type).filter(Boolean))].join(', ') || 'geen'}`
      );
    } else {
      showErrorModal(
        `Geen ${type} in de buurt`,
        `Geen ${type} binnen ${state.maxPoiDistanceKm} km van dit eindpunt gevonden.\n\nEr zijn wel ${allPOIsOfType.length} ${type}(s) in de GPX, maar die zijn te ver weg.\n\n<strong>Tip:</strong> Verhoog de zoekafstand in het dropdown menu.`
      );
    }
    return;
  }

  // Calculate detour route from main trail to POI
  console.log('🗺️ Calculating detour route from trail to POI...');

  // ALWAYS use the point closest to the POI as the detour start point
  // This is the optimal point to leave the trail (can be before OR after original endpoint)
  const detourStartIndex = nearestPOI.trackIndex;
  const detourStartPoint = gpxProfile.points[detourStartIndex];
  const detourStartKm = gpxProfile.cumKm[detourStartIndex];

  const stageEndKm = stage.rangeEndKm;

  console.log(`Original stage end: ${stageEndKm.toFixed(1)} km`);
  console.log(`Optimal detour start (closest to POI): ${detourStartKm.toFixed(1)} km (index ${detourStartIndex})`);

  if (detourStartKm < stageEndKm) {
    console.log(`   → Shortening stage by ${(stageEndKm - detourStartKm).toFixed(1)} km`);
  } else if (detourStartKm > stageEndKm) {
    console.log(`   → Extending stage by ${(detourStartKm - stageEndKm).toFixed(1)} km`);
  } else {
    console.log(`   → Stage end unchanged (optimal point is at original endpoint)`);
  }

  console.log(`Trail point: ${detourStartPoint.lat}, ${detourStartPoint.lon}`);
  console.log(`POI: ${nearestPOI.lat}, ${nearestPOI.lon}`);

  // Get walking route from trail to POI
  let detourRoute = await getWalkingRoute(
    detourStartPoint.lat, 
    detourStartPoint.lon,
    nearestPOI.lat, 
    nearestPOI.lon
  );

  let finalDetourStartIndex = detourStartIndex;
  let finalDetourStartPoint = detourStartPoint;
  let finalDetourStartKm = detourStartKm;
  let hasOverlapWarning = false;

  // Try multiple points along the trail to find the shortest walking route to the POI
  // Two-phase strategy for speed:
  // Phase 1: Test nearby points first (5 API calls)
  // Phase 2: Only test distant points if nearby options are > 1km (4 more API calls if needed)
  console.log(`🔧 Testing multiple trail points to find shortest walking route...`);

  // Phase 1: Test nearby points first
  const nearbyDistances = [-1.0, -0.5, 0, 0.5, 1.0]; // km
  let bestOption = {
    route: detourRoute,
    startIndex: detourStartIndex,
    startPoint: detourStartPoint,
    startKm: detourStartKm,
    walkingDistanceKm: detourRoute ? detourRoute.distanceKm : Infinity
  };

  console.log(`   Phase 1: Testing nearby points...`);
  for (const testDist of nearbyDistances) {
    if (testDist === 0) continue; // Skip current point, already tested

    const testKm = detourStartKm + testDist;

    // Make sure we stay within bounds
    if (testKm < 0 || testKm > gpxProfile.totalKm) continue;

    const testIdx = gpxProfile.cumKm.findIndex(km => km >= testKm);

    if (testIdx < 0 || testIdx >= gpxProfile.points.length) continue;

    const testPoint = gpxProfile.points[testIdx];
    const direction = testDist >= 0 ? '+' : '';
    console.log(`      Testing point at ${direction}${testDist}km (${testKm.toFixed(1)} km, index ${testIdx})`);

    const testRoute = await getWalkingRoute(
      testPoint.lat,
      testPoint.lon,
      nearestPOI.lat,
      nearestPOI.lon
    );

    if (testRoute && testRoute.coordinates) {
      console.log(`         Walking distance: ${testRoute.distanceKm.toFixed(2)} km`);

      // Simply choose the route with shortest walking distance
      // Overlap with Pieterpad is GOOD - it means you're walking on the trail!
      if (testRoute.distanceKm < bestOption.walkingDistanceKm) {
        bestOption = {
          route: testRoute,
          startIndex: testIdx,
          startPoint: testPoint,
          startKm: testKm,
          walkingDistanceKm: testRoute.distanceKm
        };
        console.log(`         ✅ New best option!`);
      }
    }
  }

  // Phase 2: Only test distant points if best option is > 1km
  if (bestOption.walkingDistanceKm > 1.0) {
    console.log(`   Phase 2: Best nearby option is ${bestOption.walkingDistanceKm.toFixed(2)} km, testing distant points...`);
    const distantDistances = [-2.0, -1.5, 1.5, 2.0]; // km

    for (const testDist of distantDistances) {
      const testKm = detourStartKm + testDist;

      // Make sure we stay within bounds
      if (testKm < 0 || testKm > gpxProfile.totalKm) continue;

      const testIdx = gpxProfile.cumKm.findIndex(km => km >= testKm);

      if (testIdx < 0 || testIdx >= gpxProfile.points.length) continue;

      const testPoint = gpxProfile.points[testIdx];
      const direction = testDist >= 0 ? '+' : '';
      console.log(`      Testing point at ${direction}${testDist}km (${testKm.toFixed(1)} km, index ${testIdx})`);

      const testRoute = await getWalkingRoute(
        testPoint.lat,
        testPoint.lon,
        nearestPOI.lat,
        nearestPOI.lon
      );

      if (testRoute && testRoute.coordinates) {
        console.log(`         Walking distance: ${testRoute.distanceKm.toFixed(2)} km`);

        if (testRoute.distanceKm < bestOption.walkingDistanceKm) {
          bestOption = {
            route: testRoute,
            startIndex: testIdx,
            startPoint: testPoint,
            startKm: testKm,
            walkingDistanceKm: testRoute.distanceKm
          };
          console.log(`         ✅ New best option!`);
        }
      }
    }
  } else {
    console.log(`   ✅ Phase 2 skipped: nearby option is good enough (${bestOption.walkingDistanceKm.toFixed(2)} km < 1 km)`);
  }

  // Use the best option found (shortest walking distance)
  detourRoute = bestOption.route;
  finalDetourStartIndex = bestOption.startIndex;
  finalDetourStartPoint = bestOption.startPoint;
  finalDetourStartKm = bestOption.startKm;

  // IMPORTANT: Snap the stage endpoint to where the OSRM route actually starts
  // The OSRM route might start a few meters before/after our selected GPX point
  // This prevents the red line from extending past where the green line begins
  if (detourRoute && detourRoute.coordinates && detourRoute.coordinates.length > 0) {
    const osrmStartCoord = detourRoute.coordinates[0]; // First point of walking route

    // Find the closest GPX point to where the OSRM route actually starts
    const snapIndex = findClosestPointIndex(gpxProfile.points, osrmStartCoord.lat, osrmStartCoord.lon);

    if (snapIndex >= 0 && snapIndex < gpxProfile.points.length) {
      const snapPoint = gpxProfile.points[snapIndex];
      const snapKm = gpxProfile.cumKm[snapIndex];

      // Check if this is different from our original choice
      if (Math.abs(snapKm - finalDetourStartKm) > 0.01) { // More than 10m difference
        console.log(`🎯 Snapping stage endpoint to where walking route actually begins:`);
        console.log(`   Original: ${finalDetourStartKm.toFixed(2)} km (index ${finalDetourStartIndex})`);
        console.log(`   Snapped:  ${snapKm.toFixed(2)} km (index ${snapIndex})`);
        console.log(`   Adjustment: ${((snapKm - finalDetourStartKm) * 1000).toFixed(0)}m ${snapKm > finalDetourStartKm ? 'forward' : 'backward'}`);

        finalDetourStartIndex = snapIndex;
        finalDetourStartPoint = snapPoint;
        finalDetourStartKm = snapKm;
      }
    }
  }

  // Only warn if walking distance is unreasonably long (> 3km)
  if (bestOption.walkingDistanceKm > 3.0) {
    hasOverlapWarning = true;
    console.log(`⚠️ Warning: Walking distance to POI is ${bestOption.walkingDistanceKm.toFixed(2)} km (> 3 km)`);
  } else {
    const offsetKm = bestOption.startKm - detourStartKm;
    if (offsetKm !== 0) {
      const direction = offsetKm >= 0 ? `+${offsetKm.toFixed(1)}` : `${offsetKm.toFixed(1)}`;
      console.log(`✅ Found optimal route at ${direction} km: ${bestOption.walkingDistanceKm.toFixed(2)} km walking distance`);
    } else {
      console.log(`✅ Original point is optimal: ${bestOption.walkingDistanceKm.toFixed(2)} km walking distance`);
    }
  }

  // Store the adjustment with detour info
  state.customStageAdjustments[stageIdx] = {
    endKm: finalDetourStartKm, // Use the optimal detour point as stage end
    reason: type,
    poiLabel: nearestPOI.label,
    poiLat: nearestPOI.lat,
    poiLon: nearestPOI.lon,
    detourRoute: detourRoute, // Store the detour route
    detourDistanceKm: detourRoute ? detourRoute.distanceKm : 0, // One-way only! (next stage returns)
    detourFromTrailPoint: {
      lat: finalDetourStartPoint.lat,
      lon: finalDetourStartPoint.lon,
      index: finalDetourStartIndex
    },
    hasOverlapWarning: hasOverlapWarning
  };

  if (detourRoute) {
    console.log(`✅ Detour route calculated: ${detourRoute.distanceKm.toFixed(2)} km one-way (next stage will return from POI)`);
  } else {
    console.log('⚠️ Could not calculate detour route, using straight-line distance');
  }

  // Rebuild all stages with adjustments
  await renderFullDetail();

  // Hide loading indicator
  hideLoadingIndicator();
}

// Adjust stage endpoint to a specific POI (called from POI marker button)
async function adjustStageEndpointToPOI(stageIdx, poiLat, poiLon, poiType, poiName) {
  const stage = state.currentStages[stageIdx];
  if (!stage || stage.type !== 'custom') return;

  // Get GPX profile
  const direction = state.isReversed ? 'rev' : 'fwd';
  const cacheKey = `${state.currentTrailUrl}_${direction}`;
  const gpxProfile = state.gpxCache.get(cacheKey);
  if (!gpxProfile) return;

  console.log('🏁 Adjusting stage', stageIdx, 'to end at POI:', poiName, poiType);

  // Show loading indicator
  showLoadingIndicator('⏳ Route berekenen...<br><small>Dit kan enkele seconden duren</small>');

  // Give browser time to render the loading indicator
  await new Promise(resolve => setTimeout(resolve, 50));

  // Find the closest point on the trail to this POI
  let minDist = Infinity;
  let closestIndex = 0;

  for (let i = 0; i < gpxProfile.points.length; i++) {
    const p = gpxProfile.points[i];
    const dist = haversineKm(poiLat, poiLon, p.lat, p.lon);
    if (dist < minDist) {
      minDist = dist;
      closestIndex = i;
    }
  }

  const detourStartPoint = gpxProfile.points[closestIndex];
  const detourStartKm = gpxProfile.cumKm[closestIndex];

  console.log(`Closest trail point to POI: ${detourStartKm.toFixed(1)} km (index ${closestIndex})`);
  console.log(`Trail point: ${detourStartPoint.lat}, ${detourStartPoint.lon}`);
  console.log(`POI: ${poiLat}, ${poiLon}`);
  console.log(`Distance: ${minDist.toFixed(2)} km`);

  // Get walking route from trail to POI
  let detourRoute = await getWalkingRoute(
    detourStartPoint.lat,
    detourStartPoint.lon,
    poiLat,
    poiLon
  );

  let finalDetourStartIndex = closestIndex;
  let finalDetourStartPoint = detourStartPoint;
  let finalDetourStartKm = detourStartKm;

  // Try multiple points along the trail to find the shortest walking route to the POI
  console.log(`🔧 Testing multiple trail points to find shortest walking route...`);

  const nearbyDistances = [-1.0, -0.5, 0, 0.5, 1.0]; // km
  let bestOption = {
    route: detourRoute,
    startIndex: closestIndex,
    startPoint: detourStartPoint,
    startKm: detourStartKm,
    walkingDistanceKm: detourRoute ? detourRoute.distanceKm : Infinity
  };

  for (const testDist of nearbyDistances) {
    if (testDist === 0) continue; // Skip current point, already tested

    const testKm = detourStartKm + testDist;

    // Make sure we stay within bounds
    if (testKm < 0 || testKm > gpxProfile.totalKm) continue;

    const testIdx = gpxProfile.cumKm.findIndex(km => km >= testKm);

    if (testIdx < 0 || testIdx >= gpxProfile.points.length) continue;

    const testPoint = gpxProfile.points[testIdx];
    const direction = testDist >= 0 ? '+' : '';
    console.log(`   Testing point at ${direction}${testDist}km (${testKm.toFixed(1)} km, index ${testIdx})`);

    const testRoute = await getWalkingRoute(
      testPoint.lat,
      testPoint.lon,
      poiLat,
      poiLon
    );

    if (testRoute && testRoute.coordinates) {
      console.log(`      Walking distance: ${testRoute.distanceKm.toFixed(2)} km`);

      if (testRoute.distanceKm < bestOption.walkingDistanceKm) {
        bestOption = {
          route: testRoute,
          startIndex: testIdx,
          startPoint: testPoint,
          startKm: testKm,
          walkingDistanceKm: testRoute.distanceKm
        };
        console.log(`      ✅ New best option!`);
      }
    }
  }

  // Use the best option found
  detourRoute = bestOption.route;
  finalDetourStartIndex = bestOption.startIndex;
  finalDetourStartPoint = bestOption.startPoint;
  finalDetourStartKm = bestOption.startKm;

  // Snap the stage endpoint to where the OSRM route actually starts
  if (detourRoute && detourRoute.coordinates && detourRoute.coordinates.length > 0) {
    const osrmStartCoord = detourRoute.coordinates[0];

    const snapIndex = findClosestPointIndex(gpxProfile.points, osrmStartCoord.lat, osrmStartCoord.lon);

    if (snapIndex >= 0 && snapIndex < gpxProfile.points.length) {
      const snapPoint = gpxProfile.points[snapIndex];
      const snapKm = gpxProfile.cumKm[snapIndex];

      if (Math.abs(snapKm - finalDetourStartKm) > 0.01) {
        console.log(`🎯 Snapping stage endpoint to where walking route actually begins:`);
        console.log(`   Original: ${finalDetourStartKm.toFixed(2)} km`);
        console.log(`   Snapped:  ${snapKm.toFixed(2)} km`);

        finalDetourStartIndex = snapIndex;
        finalDetourStartPoint = snapPoint;
        finalDetourStartKm = snapKm;
      }
    }
  }

  // Store the adjustment with detour info
  state.customStageAdjustments[stageIdx] = {
    endKm: finalDetourStartKm,
    reason: poiType,
    poiLabel: poiName,
    poiLat: poiLat,
    poiLon: poiLon,
    detourRoute: detourRoute,
    detourDistanceKm: detourRoute ? detourRoute.distanceKm : 0,
    detourFromTrailPoint: {
      lat: finalDetourStartPoint.lat,
      lon: finalDetourStartPoint.lon,
      index: finalDetourStartIndex
    },
    hasOverlapWarning: bestOption.walkingDistanceKm > 3.0
  };

  if (detourRoute) {
    console.log(`✅ Detour route calculated: ${detourRoute.distanceKm.toFixed(2)} km one-way`);
  } else {
    console.log('⚠️ Could not calculate detour route, using straight-line distance');
  }

  // Rebuild all stages with adjustments
  await renderFullDetail();

  // Hide loading indicator
  hideLoadingIndicator();

  // Show success message
  console.log(`🎉 Stage ${stageIdx + 1} aangepast om te eindigen bij ${poiName}`);
}

// --------------------
// GPX GENERATION
// --------------------

// Add a POI stop to the route (with detour calculation)
async function addStopToRoute(stageIdx, poiLat, poiLon, poiType, poiName, poiKm) {
  const stage = state.currentStages[stageIdx];
  if (!stage || stage.type !== 'custom') return;

  // Get GPX profile
  const direction = state.isReversed ? 'rev' : 'fwd';
  const cacheKey = `${state.currentTrailUrl}_${direction}`;
  const gpxProfile = state.gpxCache.get(cacheKey);
  if (!gpxProfile) return;

  console.log('➕ Adding stop to route:', stageIdx, poiName, poiType);

  // Show loading indicator
  showLoadingIndicator('⏳ Route naar stop berekenen...');
  await new Promise(resolve => setTimeout(resolve, 50));

  // Find the closest point on the trail within this stage's segment
  let minDist = Infinity;
  let closestIndex = 0;

  const startIdx = stage.startIndex || 0;
  const endIdx = stage.endIndex || gpxProfile.points.length - 1;

  for (let i = startIdx; i <= endIdx; i++) {
    const p = gpxProfile.points[i];
    const dist = haversineKm(poiLat, poiLon, p.lat, p.lon);
    if (dist < minDist) {
      minDist = dist;
      closestIndex = i;
    }
  }

  const detourStartPoint = gpxProfile.points[closestIndex];
  const detourStartKm = gpxProfile.cumKm[closestIndex];

  console.log(`Closest trail point to POI: ${detourStartKm.toFixed(1)} km (index ${closestIndex})`);

  // Get walking route from trail to POI
  const detourToRoute = await getWalkingRoute(
    detourStartPoint.lat,
    detourStartPoint.lon,
    poiLat,
    poiLon
  );

  // Get walking route back from POI to trail (might be different)
  const detourBackRoute = await getWalkingRoute(
    poiLat,
    poiLon,
    detourStartPoint.lat,
    detourStartPoint.lon
  );

  // Initialize routeStops for this stage if needed
  if (!state.routeStops[stageIdx]) {
    state.routeStops[stageIdx] = [];
  }

  // Create the stop object
  const stop = {
    lat: poiLat,
    lon: poiLon,
    name: poiName,
    type: poiType,
    km: poiKm,
    trailKm: detourStartKm,
    trailPointIndex: closestIndex,
    trailPoint: {
      lat: detourStartPoint.lat,
      lon: detourStartPoint.lon
    },
    detourToRoute: detourToRoute,
    detourBackRoute: detourBackRoute,
    detourDistanceKm: detourToRoute ? detourToRoute.distanceKm : minDist,
    totalDetourKm: (detourToRoute?.distanceKm || minDist) + (detourBackRoute?.distanceKm || minDist)
  };

  // Add to stops array, sorted by km
  state.routeStops[stageIdx].push(stop);
  state.routeStops[stageIdx].sort((a, b) => a.trailKm - b.trailKm);

  console.log(`✅ Stop added: ${poiName} at ${detourStartKm.toFixed(1)} km`);
  console.log(`   Detour: ${stop.totalDetourKm.toFixed(2)} km (heen + terug)`);
  console.log(`   Total stops for stage ${stageIdx}:`, state.routeStops[stageIdx].length);

  // Update the stage data to reflect the new detour distance
  const allStops = state.routeStops[stageIdx];
  const totalStopsDetourKm = allStops.reduce((sum, s) => sum + (s.totalDetourKm || 0), 0);

  if (state.currentStages[stageIdx]) {
    // Add route stops detour to any existing endpoint detour
    const existingEndpointDetour = state.customStageAdjustments[stageIdx]?.detourDistanceKm || 0;
    state.currentStages[stageIdx].detourDistanceKm = existingEndpointDetour + totalStopsDetourKm;
    state.currentStages[stageIdx].hasDetour = totalStopsDetourKm > 0 || existingEndpointDetour > 0;
    state.currentStages[stageIdx].routeStopsCount = allStops.length;

    // Update the stage row display
    const dayItem = document.querySelector(`.dayItem[data-stage-idx="${stageIdx}"]`);
    const stageKmEl = dayItem ? dayItem.querySelector('.stageKm') : null;
    if (stageKmEl) {
      const baseKm = state.currentStages[stageIdx].km || 0;
      const totalDetour = state.currentStages[stageIdx].detourDistanceKm;
      if (totalDetour > 0) {
        stageKmEl.innerHTML = `${formatKm(baseKm)} km <span style="color: #27ae60; font-size: 0.9em;">(+${formatKm(totalDetour)} omweg)</span>`;
      }
    }
  }

  // Refresh only the current stage's inline map and elevation profile (not full page)
  hideLoadingIndicator();

  // Re-open the same stage to refresh it with the new stop
  await renderStageDetail(stageIdx, true);

  // Scroll back to the stage
  const stageEl = document.querySelector(`#stageDetail-${stageIdx}`);
  if (stageEl) {
    stageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Remove a POI stop from the route
async function removeStopFromRoute(stageIdx, poiLat, poiLon) {
  if (!state.routeStops[stageIdx]) return;

  // Find and remove the stop
  const index = state.routeStops[stageIdx].findIndex(stop => 
    Math.abs(stop.lat - poiLat) < 0.0001 && Math.abs(stop.lon - poiLon) < 0.0001
  );

  if (index !== -1) {
    const removed = state.routeStops[stageIdx].splice(index, 1)[0];
    console.log(`✕ Removed stop: ${removed.name}`);
  }

  // Update the stage data to reflect the removed detour
  const allStops = state.routeStops[stageIdx] || [];
  const totalStopsDetourKm = allStops.reduce((sum, s) => sum + (s.totalDetourKm || 0), 0);

  if (state.currentStages[stageIdx]) {
    const existingEndpointDetour = state.customStageAdjustments[stageIdx]?.detourDistanceKm || 0;
    state.currentStages[stageIdx].detourDistanceKm = existingEndpointDetour + totalStopsDetourKm;
    state.currentStages[stageIdx].hasDetour = totalStopsDetourKm > 0 || existingEndpointDetour > 0;
    state.currentStages[stageIdx].routeStopsCount = allStops.length;

    // Update the stage row display
    const dayItemRemove = document.querySelector(`.dayItem[data-stage-idx="${stageIdx}"]`);
    const stageKmElRemove = dayItemRemove ? dayItemRemove.querySelector('.stageKm') : null;
    if (stageKmElRemove) {
      const baseKm = state.currentStages[stageIdx].km || 0;
      const totalDetour = state.currentStages[stageIdx].detourDistanceKm;
      if (totalDetour > 0) {
        stageKmElRemove.innerHTML = `${formatKm(baseKm)} km <span style="color: #27ae60; font-size: 0.9em;">(+${formatKm(totalDetour)} omweg)</span>`;
      } else {
        stageKmElRemove.innerHTML = `${formatKm(baseKm)} km`;
      }
    }
  }

  // Re-open the same stage to refresh it
  await renderStageDetail(stageIdx, true);

  // Scroll back to the stage
  const stageEl = document.querySelector(`#stageDetail-${stageIdx}`);
  if (stageEl) {
    stageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Clear all route stops for a stage
async function clearAllRouteStops(stageIdx) {
  if (!state.routeStops[stageIdx] || state.routeStops[stageIdx].length === 0) return;

  console.log(`🗑️ Clearing all ${state.routeStops[stageIdx].length} route stops for stage ${stageIdx}`);

  // Clear all stops
  state.routeStops[stageIdx] = [];

  // Update the stage data
  if (state.currentStages[stageIdx]) {
    const existingEndpointDetour = state.customStageAdjustments[stageIdx]?.detourDistanceKm || 0;
    state.currentStages[stageIdx].detourDistanceKm = existingEndpointDetour;
    state.currentStages[stageIdx].hasDetour = existingEndpointDetour > 0;
    state.currentStages[stageIdx].routeStopsCount = 0;

    // Update the stage row display
    const dayItem = document.querySelector(`.dayItem[data-stage-idx="${stageIdx}"]`);
    const stageKmEl = dayItem ? dayItem.querySelector('.stageKm') : null;
    if (stageKmEl) {
      const baseKm = state.currentStages[stageIdx].km || 0;
      const totalDetour = state.currentStages[stageIdx].detourDistanceKm;
      if (totalDetour > 0) {
        stageKmEl.innerHTML = `${formatKm(baseKm)} km <span style="color: #27ae60; font-size: 0.9em;">(+${formatKm(totalDetour)} omweg)</span>`;
      } else {
        stageKmEl.innerHTML = `${formatKm(baseKm)} km`;
      }
    }
  }

  // Re-open the same stage to refresh it
  await renderStageDetail(stageIdx, true);

  // Scroll back to the stage
  const stageEl = document.querySelector(`#stageDetail-${stageIdx}`);
  if (stageEl) {
    stageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function generateStageGPX(stage, gpxProfile, trailName = 'Trail') {
  const stageName = `${trailName} Dag ${stage.index}`;
  const timestamp = new Date().toISOString();

  // Build track points array: [A] return + [B] trail (with stops) + [C] detour
  const trackPoints = [];

  // [A] Return route from previous POI (if exists)
  if (stage.returnFromPOI && stage.returnFromPOI.returnRoute) {
    trackPoints.push({
      coords: stage.returnFromPOI.returnRoute.coordinates,
      name: 'Return to trail',
      type: 'return'
    });
  }

  // [B] Main trail route with route stops interspersed
  if (stage.startIndex !== null && stage.endIndex !== null) {
    const stageIdx = stage.index - 1;
    const routeStops = state.routeStops[stageIdx] || [];

    // Sort stops by trail km position
    const sortedStops = [...routeStops].sort((a, b) => a.trailPointIndex - b.trailPointIndex);

    if (sortedStops.length === 0) {
      // No stops - just add the full trail
      const trailCoords = [];
      for (let i = stage.startIndex; i <= stage.endIndex; i++) {
        const pt = gpxProfile.points[i];
        if (pt) {
          trailCoords.push({ lat: pt.lat, lon: pt.lon, ele: pt.ele });
        }
      }
      if (trailCoords.length > 0) {
        trackPoints.push({
          coords: trailCoords,
          name: 'Trail route',
          type: 'trail'
        });
      }
    } else {
      // Build trail segments with stops in between
      let currentIdx = stage.startIndex;

      for (const stop of sortedStops) {
        // [B1] Trail segment up to the stop connection point
        const trailToStop = [];
        for (let i = currentIdx; i <= stop.trailPointIndex; i++) {
          const pt = gpxProfile.points[i];
          if (pt) {
            trailToStop.push({ lat: pt.lat, lon: pt.lon, ele: pt.ele });
          }
        }
        if (trailToStop.length > 0) {
          trackPoints.push({
            coords: trailToStop,
            name: `Trail to ${stop.name}`,
            type: 'trail'
          });
        }

        // [B2] Detour TO the stop
        if (stop.detourToRoute && stop.detourToRoute.coordinates) {
          trackPoints.push({
            coords: stop.detourToRoute.coordinates,
            name: `To ${stop.name}`,
            type: 'stop-detour'
          });
        }

        // [B3] Detour BACK from the stop
        if (stop.detourBackRoute && stop.detourBackRoute.coordinates) {
          trackPoints.push({
            coords: stop.detourBackRoute.coordinates,
            name: `From ${stop.name}`,
            type: 'stop-return'
          });
        }

        currentIdx = stop.trailPointIndex;
      }

      // [B4] Remaining trail after last stop
      if (currentIdx < stage.endIndex) {
        const trailAfterStops = [];
        for (let i = currentIdx; i <= stage.endIndex; i++) {
          const pt = gpxProfile.points[i];
          if (pt) {
            trailAfterStops.push({ lat: pt.lat, lon: pt.lon, ele: pt.ele });
          }
        }
        if (trailAfterStops.length > 0) {
          trackPoints.push({
            coords: trailAfterStops,
            name: 'Trail route',
            type: 'trail'
          });
        }
      }
    }
  } else if (stage.type === 'official') {
    // For official stages, use all points (or calculate based on stage number)
    // This is a simple fallback - ideally we'd calculate proper indices
    const totalPoints = gpxProfile.points.length;
    const officialStages = state.currentStages.filter(s => s.type === 'official');
    const stagesCount = officialStages.length || 1;
    const pointsPerStage = Math.floor(totalPoints / stagesCount);

    const startIdx = Math.max(0, (stage.index - 1) * pointsPerStage);
    const endIdx = Math.min(totalPoints - 1, stage.index * pointsPerStage);

    const trailCoords = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const pt = gpxProfile.points[i];
      if (pt) {
        trailCoords.push({ lat: pt.lat, lon: pt.lon, ele: pt.ele });
      }
    }
    if (trailCoords.length > 0) {
      trackPoints.push({
        coords: trailCoords,
        name: 'Trail route',
        type: 'trail'
      });
    }
  }

  // [C] Detour to POI (if exists)
  const adjustment = state.customStageAdjustments[stage.index - 1];
  if (adjustment && adjustment.detourRoute && adjustment.detourRoute.coordinates) {
    trackPoints.push({
      coords: adjustment.detourRoute.coordinates,
      name: `Detour to ${adjustment.poiLabel}`,
      type: 'detour'
    });
  }

  // Build waypoints
  const waypoints = [];

  // Add route stops as waypoints
  const stageIdx = stage.index - 1;
  const routeStopsForWaypoints = state.routeStops[stageIdx] || [];
  routeStopsForWaypoints.forEach((stop, i) => {
    waypoints.push({
      lat: stop.lat,
      lon: stop.lon,
      name: stop.name,
      type: stop.type,
      description: `Stop ${i + 1}: ${stop.name} (+${stop.totalDetourKm.toFixed(1)} km omweg)`
    });
  });

  // Start waypoint
  let startCoords = null;
  if (stage.returnFromPOI) {
    // Start at POI from previous stage
    startCoords = { 
      lat: stage.returnFromPOI.poiLat, 
      lon: stage.returnFromPOI.poiLon,
      name: stage.returnFromPOI.poiLabel || 'Start'
    };
  } else if (stage.startIndex !== null) {
    // Start at trail point
    const pt = gpxProfile.points[stage.startIndex];
    if (pt) {  // Safety check
      startCoords = { 
        lat: pt.lat, 
        lon: pt.lon,
        name: stage.fromLocation || stage.from || 'Start'
      };
    }
  } else if (stage.type === 'official' && stage.from) {
    // For official stages without indices, try to use first point
    const pt = gpxProfile.points[0];
    if (pt) {
      startCoords = {
        lat: pt.lat,
        lon: pt.lon,
        name: stage.from
      };
    }
  }
  if (startCoords) waypoints.push({ ...startCoords, sym: 'Flag, Green' });

  // End waypoint
  let endCoords = null;
  if (adjustment && adjustment.poiLat && adjustment.poiLon) {
    // End at POI
    endCoords = {
      lat: adjustment.poiLat,
      lon: adjustment.poiLon,
      name: adjustment.poiLabel || 'End'
    };
  } else if (stage.endIndex !== null) {
    // End at trail point
    const pt = gpxProfile.points[stage.endIndex];
    if (pt) {  // Safety check
      endCoords = {
        lat: pt.lat,
        lon: pt.lon,
        name: stage.toLocation || stage.to || 'End'
      };
    }
  } else if (stage.type === 'official' && stage.to) {
    // For official stages without indices, try to use last point
    const pt = gpxProfile.points[gpxProfile.points.length - 1];
    if (pt) {
      endCoords = {
        lat: pt.lat,
        lon: pt.lon,
        name: stage.to
      };
    }
  }
  if (endCoords) waypoints.push({ ...endCoords, sym: 'Flag, Red' });

  // Build GPX XML
  let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
  gpx += '<gpx version="1.1" creator="Hike5 Trail Companion" \n';
  gpx += '  xmlns="http://www.topografix.com/GPX/1/1" \n';
  gpx += '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" \n';
  gpx += '  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n';

  // Metadata
  gpx += '  <metadata>\n';
  gpx += `    <name>${escapeXml(stageName)}</name>\n`;
  gpx += `    <desc>${escapeXml(`${stage.fromLocation || 'Start'} → ${stage.toLocation || 'End'} (${formatKm(stage.km)} km)`)}</desc>\n`;
  gpx += `    <time>${timestamp}</time>\n`;
  gpx += '  </metadata>\n';

  // Waypoints
  for (const wpt of waypoints) {
    gpx += `  <wpt lat="${wpt.lat}" lon="${wpt.lon}">\n`;
    gpx += `    <name>${escapeXml(wpt.name)}</name>\n`;
    gpx += `    <sym>${wpt.sym}</sym>\n`;
    gpx += '  </wpt>\n';
  }

  // Track
  gpx += '  <trk>\n';
  gpx += `    <name>${escapeXml(stageName)}</name>\n`;
  gpx += `    <type>hiking</type>\n`;

  // Track segments
  for (const segment of trackPoints) {
    gpx += '    <trkseg>\n';
    for (const pt of segment.coords) {
      gpx += `      <trkpt lat="${pt.lat}" lon="${pt.lon}">\n`;
      // Add elevation if available
      if (pt.ele !== null && pt.ele !== undefined) {
        gpx += `        <ele>${pt.ele}</ele>\n`;
      }
      gpx += '      </trkpt>\n';
    }
    gpx += '    </trkseg>\n';
  }

  gpx += '  </trk>\n';
  gpx += '</gpx>\n';

  return gpx;
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function downloadStageGPX(stageIdx) {
  const stage = state.currentStages[stageIdx];
  if (!stage) return;

  const direction = state.isReversed ? 'rev' : 'fwd';
  const cacheKey = `${state.currentTrailUrl}_${direction}`;
  const gpxProfile = state.gpxCache.get(cacheKey);
  if (!gpxProfile) return;

  const trailName = state.currentTrailData?.name || 'Trail';
  const gpxContent = generateStageGPX(stage, gpxProfile, trailName);

  // Create download
  const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${trailName.toLowerCase().replace(/\s+/g, '-')}-dag-${stage.index}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  debug(`📥 Downloaded GPX for stage ${stage.index}`);
}

function findNearestPOI(targetKm, poiType, gpxProfile) {
  if (!gpxProfile?.waypoints?.length) return null;

  const MAX_POI_DISTANCE_KM = state.maxPoiDistanceKm; // Use user's setting

  // Filter waypoints by type
  const relevantPOIs = gpxProfile.waypoints.filter(w => 
    w.type && w.type.toLowerCase() === poiType.toLowerCase()
  );

  if (!relevantPOIs.length) return null;

  // Find the target point on the track
  const targetIdx = gpxProfile.cumKm.findIndex(km => km >= targetKm);
  if (targetIdx < 0) return null;

  const targetPoint = gpxProfile.points[targetIdx];

  // Find closest POI to target point
  let best = null;
  let bestDist = Infinity;

  for (const poi of relevantPOIs) {
    const dist = haversineKm(targetPoint.lat, targetPoint.lon, poi.lat, poi.lon);
    if (dist < bestDist) {
      bestDist = dist;
      best = poi;
    }
  }

  // Check if the best POI is within acceptable distance
  if (!best || bestDist > MAX_POI_DISTANCE_KM) return null;

  // Find where this POI maps to on the track
  const poiTrackPoint = findClosestPointIndex(gpxProfile.points, best.lat, best.lon);

  return {
    label: best.label,
    lat: best.lat,
    lon: best.lon,
    trackKm: gpxProfile.cumKm[poiTrackPoint.index],
    trackIndex: poiTrackPoint.index, // Add this!
    distanceFromTarget: bestDist
  };
}

function resetStageEndpoint(stageIdx) {
  delete state.customStageAdjustments[stageIdx];
  renderFullDetail();
}

// --------------------
// STAGE MAP SELECTION MODAL
// --------------------
function openStageMapModal(stageIdx, stage) {
  state.editingStageIndex = stageIdx;

  const modal = document.getElementById('mapModal');
  if (!modal) return;

  // Update modal title
  const header = modal.querySelector('.mapModalHeader h3');
  if (header) {
    header.textContent = `Kies nieuw eindpunt voor etappe ${stageIdx + 1}`;
  }

  // Update instruction
  const instruction = modal.querySelector('.mapModalInstructionText');
  if (instruction) {
    instruction.textContent = '👆 Klik op de route voor het nieuwe eindpunt';
  }

  modal.style.display = 'flex';

  // Initialize the modal map for stage selection
  setTimeout(() => {
    initStageMapModal(stageIdx, stage);
  }, 100);
}

async function initStageMapModal(stageIdx, stage) {
  const mapEl = document.getElementById('modalMap');
  if (!mapEl) return;

  // Clean up existing modal map
  if (state.modalMap) {
    state.modalMap.remove();
  }

  // Create modal map
  state.modalMap = L.map('modalMap').setView([52.37, 4.89], 7);

  createTileLayer().addTo(state.modalMap);

  // Get the GPX profile
  const direction = state.isReversed ? 'rev' : 'fwd';
  const cacheKey = `${state.currentTrailUrl}_${direction}`;
  const gpxProfile = state.gpxCache.get(cacheKey);

  if (!gpxProfile?.points?.length) return;

  // Draw the full track (dashed brown for context)
  const trackPoints = gpxProfile.points.map(p => [p.lat, p.lon]);
  const polyline = L.polyline(trackPoints, {
    color: '#8B4513',
    weight: 4,
    opacity: 0.7,
    dashArray: '8, 8',
    interactive: true,
  }).addTo(state.modalMap);

  // Highlight the current stage section (bright blue)
  if (stage.startIndex !== null && stage.endIndex !== null) {
    const stagePoints = gpxProfile.points.slice(stage.startIndex, stage.endIndex + 1).map(p => [p.lat, p.lon]);
    const stagePolyline = L.polyline(stagePoints, {
      color: '#2980b9',
      weight: 6,
      opacity: 0.9,
      interactive: false, // Allow clicks to pass through to the red polyline below
    }).addTo(state.modalMap);

    // Zoom to this stage
    state.modalMap.fitBounds(stagePolyline.getBounds(), { padding: [50, 50] });
  } else {
    state.modalMap.fitBounds(polyline.getBounds(), { padding: [50, 50] });
  }

  // Add click handler to the polyline
  polyline.on('click', async function(e) {
    if (!gpxProfile?.points?.length || !gpxProfile.cumKm) return;

    const clickLat = e.latlng.lat;
    const clickLon = e.latlng.lng;

    // Find closest point on the track
    const closest = findClosestPointIndex(gpxProfile.points, clickLat, clickLon);
    const clickedKm = gpxProfile.cumKm[closest.index];

    // Round to 1 decimal for cleaner display
    const roundedKm = Math.round(clickedKm * 10) / 10;

    // Make sure the new endpoint is after the stage start (allow shortening!)
    if (roundedKm <= stage.rangeStartKm) {
      showErrorModal(
        'Ongeldige positie',
        `Het nieuwe eindpunt moet na het startpunt liggen (${formatKm(stage.rangeStartKm)} km)`
      );
      return;
    }

    // Also check we're not going past the overall end
    const direction = state.isReversed ? 'rev' : 'fwd';
    const cacheKey = `${state.currentTrailUrl}_${direction}`;
    const gpx = state.gpxCache.get(cacheKey);
    const overallEndKm = state.endKm !== null ? state.endKm : (gpx?.totalKm || Infinity);

    if (roundedKm > overallEndKm) {
      showErrorModal(
        'Ongeldige positie',
        `Het nieuwe eindpunt kan niet voorbij het einde van de route (${formatKm(overallEndKm)} km)`
      );
      return;
    }

    // Store the adjustment
    state.customStageAdjustments[stageIdx] = {
      endKm: roundedKm,
      reason: 'map',
      poiLabel: null
    };

    const instructionEl = document.querySelector('.mapModalInstructionText');
    if (instructionEl) {
      instructionEl.textContent = `✓ Nieuw eindpunt: ${formatKm(roundedKm)} km`;
    }

    // Close modal and rebuild stages after a short delay
    setTimeout(() => {
      closeStageMapModal();
      renderFullDetail();
    }, 1000);
  });

  // Hover effect
  polyline.on('mouseover', function() {
    this.setStyle({ weight: 6, opacity: 0.9 });
  });
  polyline.on('mouseout', function() {
    this.setStyle({ weight: 4, opacity: 0.7 });
  });
}

function closeStageMapModal() {
  const modal = document.getElementById('mapModal');
  if (!modal) return;

  modal.style.display = 'none';

  // Clean up modal map
  if (state.modalMap) {
    state.modalMap.remove();
    state.modalMap = null;
  }

  state.editingStageIndex = null;

  // Reset modal title back to default
  const header = modal.querySelector('.mapModalHeader h3');
  if (header) {
    header.textContent = 'Selecteer start en einde op de kaart';
  }
}

// --------------------
// MAP MODAL
// --------------------
function openMapModal() {
  const modal = document.getElementById('mapModal');
  if (!modal) return;

  modal.style.display = 'flex'; // Use flex to center the content

  // Initialize the modal map
  setTimeout(() => {
    initModalMap();
  }, 100);
}

function closeMapModal() {
  const modal = document.getElementById('mapModal');
  if (!modal) return;

  modal.style.display = 'none';

  // Clean up modal map
  if (state.modalMap) {
    state.modalMap.remove();
    state.modalMap = null;
  }

  // Trigger a re-render to update the planning
  if (state.startKm !== null && state.endKm !== null) {
    renderFullDetail();
  }
}

function confirmMapSelection() {
  // Check if both points are selected
  if (state.startKm === null || state.endKm === null) {
    alert('Selecteer eerst een start- en eindpunt op de kaart');
    return;
  }

  // Ensure start < end
  if (state.startKm >= state.endKm) {
    alert('Het startpunt moet voor het eindpunt liggen');
    return;
  }

  // Close modal and update
  closeMapModal();
}

function resetMapSelection() {
  // Reset selection state
  state.startKm = null;
  state.endKm = null;

  // Remove markers from modal map
  if (state.modalStartMarker && state.modalMap) {
    state.modalMap.removeLayer(state.modalStartMarker);
    state.modalStartMarker = null;
  }
  if (state.modalEndMarker && state.modalMap) {
    state.modalMap.removeLayer(state.modalEndMarker);
    state.modalEndMarker = null;
  }

  // Update instruction text
  const instructionEl = document.querySelector('.mapModalInstructionText');
  if (instructionEl) {
    instructionEl.textContent = '👆 Klik op de route voor startpunt';
  }

  // Re-draw the route in single color (no selection highlighting)
  updateModalMapRoute();
}


function updateModalMapRoute() {
  if (!state.modalMap) return;

  // Get the GPX profile
  const direction = state.isReversed ? 'rev' : 'fwd';
  const cacheKey = `${state.currentTrailUrl}_${direction}`;
  const gpxProfile = state.gpxCache.get(cacheKey);

  if (!gpxProfile?.points?.length || !gpxProfile.cumKm) return;

  // Remove existing route layer
  if (state.modalRouteLayer) {
    state.modalMap.removeLayer(state.modalRouteLayer);
  }

  // Create new layer group
  state.modalRouteLayer = L.layerGroup().addTo(state.modalMap);

  const trackPoints = gpxProfile.points.map(p => [p.lat, p.lon]);

  // If no selection, draw single colored route
  if (state.startKm === null || state.endKm === null) {
    const polyline = L.polyline(trackPoints, {
      color: '#8B4513',
      weight: 4,
      opacity: 0.7,
      dashArray: '8, 8',
      interactive: true,
    }).addTo(state.modalRouteLayer);

    addPolylineHandlers(polyline, gpxProfile);
    return;
  }

  // Find indices for start and end
  const startIdx = findNearestIndexByKm(gpxProfile.cumKm, state.startKm);
  const endIdx = findNearestIndexByKm(gpxProfile.cumKm, state.endKm);

  // Draw three segments with different colors

  // 1. Before start (greyed out, dashed)
  if (startIdx > 0) {
    const beforePoints = trackPoints.slice(0, startIdx + 1);
    const beforeLine = L.polyline(beforePoints, {
      color: '#8B4513',
      weight: 4,
      opacity: 0.5,
      dashArray: '8, 8',
      interactive: true,
    }).addTo(state.modalRouteLayer);
    addPolylineHandlers(beforeLine, gpxProfile);
  }

  // 2. Selected segment (bright blue)
  if (startIdx >= 0 && endIdx >= 0) {
    const selectedPoints = trackPoints.slice(startIdx, endIdx + 1);
    const selectedLine = L.polyline(selectedPoints, {
      color: '#2980b9',
      weight: 6,
      opacity: 0.9,
      interactive: true,
    }).addTo(state.modalRouteLayer);
    addPolylineHandlers(selectedLine, gpxProfile);
  }

  // 3. After end (greyed out, dashed)
  if (endIdx < trackPoints.length - 1) {
    const afterPoints = trackPoints.slice(endIdx);
    const afterLine = L.polyline(afterPoints, {
      color: '#8B4513',
      weight: 4,
      opacity: 0.5,
      dashArray: '8, 8',
      interactive: true,
    }).addTo(state.modalRouteLayer);
    addPolylineHandlers(afterLine, gpxProfile);
  }
}

function addPolylineHandlers(polyline, gpxProfile) {
  // Add click handler
  polyline.on('click', function(e) {
    handleModalMapClick(e, gpxProfile);
  });

  // Hover effect
  polyline.on('mouseover', function() {
    const originalColor = this.options.color;
    const originalWeight = this.options.weight;
    this.setStyle({ weight: originalWeight + 2, opacity: 1.0 });
  });

  polyline.on('mouseout', function() {
    const originalColor = this.options.color;
    const originalWeight = this.options.weight;
    this.setStyle({ weight: originalWeight, opacity: this.options.opacity });
  });
}

function handleModalMapClick(e, gpxProfile) {
  if (!gpxProfile?.points?.length || !gpxProfile.cumKm) return;

  const clickLat = e.latlng.lat;
  const clickLon = e.latlng.lng;

  // Find closest point on the track
  const closest = findClosestPointIndex(gpxProfile.points, clickLat, clickLon);
  const clickedKm = gpxProfile.cumKm[closest.index];

  // Round to 1 decimal for cleaner display
  const roundedKm = Math.round(clickedKm * 10) / 10;

  const instructionEl = document.querySelector('.mapModalInstructionText');

  // Determine if this is start or end selection
  if (state.startKm === null || (state.startKm !== null && state.endKm !== null)) {
    // Setting start point
    state.startKm = roundedKm;
    state.endKm = null;

    // Remove old markers from modal map
    if (state.modalStartMarker && state.modalMap) {
      state.modalMap.removeLayer(state.modalStartMarker);
    }
    if (state.modalEndMarker && state.modalMap) {
      state.modalMap.removeLayer(state.modalEndMarker);
    }

    // Add start marker
    state.modalStartMarker = L.marker([gpxProfile.points[closest.index].lat, gpxProfile.points[closest.index].lon], {
      icon: L.divIcon({
        className: 'start-marker',
        html: '🚶',
        iconSize: [60, 60],
      })
    }).addTo(state.modalMap).bindPopup(`Start: ${formatKm(roundedKm)} km`);

    if (instructionEl) {
      instructionEl.textContent = '👆 Klik op de route voor eindpunt';
    }

  } else if (state.startKm !== null && state.endKm === null) {
    // Setting end point
    state.endKm = roundedKm;

    // Make sure start < end, swap if needed
    if (state.startKm > state.endKm) {
      const tmp = state.startKm;
      state.startKm = state.endKm;
      state.endKm = tmp;

      // Swap markers too
      if (state.modalStartMarker && state.modalMap) {
        state.modalMap.removeLayer(state.modalStartMarker);
        state.modalStartMarker = L.marker([gpxProfile.points[closest.index].lat, gpxProfile.points[closest.index].lon], {
          icon: L.divIcon({
            className: 'start-marker',
            html: '🚶',
            iconSize: [60, 60],
          })
        }).addTo(state.modalMap).bindPopup(`Start: ${formatKm(state.startKm)} km`);
      }
    }

    // Add end marker
    const endPointIdx = findNearestIndexByKm(gpxProfile.cumKm, state.endKm);
    state.modalEndMarker = L.marker([gpxProfile.points[endPointIdx].lat, gpxProfile.points[endPointIdx].lon], {
      icon: L.divIcon({
        className: 'end-marker',
        html: '🏁',
        iconSize: [60, 60],
      })
    }).addTo(state.modalMap).bindPopup(`Einde: ${formatKm(state.endKm)} km`);

    if (instructionEl) {
      instructionEl.textContent = `✓ Geselecteerd: ${formatKm(state.startKm)} km → ${formatKm(state.endKm)} km. Druk op "Bevestig selectie"`;
    }

    // Update route colors to show selection
    updateModalMapRoute();
  }
}

async function initModalMap() {
  const mapEl = document.getElementById('modalMap');
  if (!mapEl) return;

  // Clean up existing modal map
  if (state.modalMap) {
    state.modalMap.remove();
  }

  // Create modal map
  state.modalMap = L.map('modalMap').setView([52.37, 4.89], 7);

  createTileLayer().addTo(state.modalMap);

  // Get the GPX profile
  const direction = state.isReversed ? 'rev' : 'fwd';
  const cacheKey = `${state.currentTrailUrl}_${direction}`;
  const gpxProfile = state.gpxCache.get(cacheKey);

  if (!gpxProfile?.points?.length) return;

  // Draw the route with color coding
  updateModalMapRoute();

  // Fit map to appropriate bounds
  const trackPoints = gpxProfile.points.map(p => [p.lat, p.lon]);

  if (state.startKm !== null && state.endKm !== null && gpxProfile.cumKm) {
    // Zoom to selected portion
    const startIdx = findNearestIndexByKm(gpxProfile.cumKm, state.startKm);
    const endIdx = findNearestIndexByKm(gpxProfile.cumKm, state.endKm);

    if (startIdx >= 0 && endIdx >= 0) {
      const selectedPoints = trackPoints.slice(startIdx, endIdx + 1);
      const selectedPolyline = L.polyline(selectedPoints);
      state.modalMap.fitBounds(selectedPolyline.getBounds(), { padding: [50, 50] });
    } else {
      const fullPolyline = L.polyline(trackPoints);
      state.modalMap.fitBounds(fullPolyline.getBounds(), { padding: [50, 50] });
    }
  } else {
    // Zoom to full track
    const fullPolyline = L.polyline(trackPoints);
    state.modalMap.fitBounds(fullPolyline.getBounds(), { padding: [50, 50] });
  }

  // Restore existing markers if they exist
  if (state.startKm !== null) {
    const startIdx = findNearestIndexByKm(gpxProfile.cumKm, state.startKm);
    if (startIdx >= 0) {
      const startPoint = gpxProfile.points[startIdx];
      state.modalStartMarker = L.marker([startPoint.lat, startPoint.lon], {
        icon: L.divIcon({
          className: 'start-marker',
          html: '🚶',
          iconSize: [60, 60],
        })
      }).addTo(state.modalMap).bindPopup(`Start: ${formatKm(state.startKm)} km`);
    }

    if (state.endKm !== null) {
      const endIdx = findNearestIndexByKm(gpxProfile.cumKm, state.endKm);
      if (endIdx >= 0) {
        const endPoint = gpxProfile.points[endIdx];
        state.modalEndMarker = L.marker([endPoint.lat, endPoint.lon], {
          icon: L.divIcon({
            className: 'end-marker',
            html: '🏁',
            iconSize: [60, 60],
          })
        }).addTo(state.modalMap).bindPopup(`Einde: ${formatKm(state.endKm)} km`);

        const instructionEl = document.querySelector('.mapModalInstructionText');
        if (instructionEl) {
          instructionEl.textContent = `✓ Geselecteerd: ${formatKm(state.startKm)} km → ${formatKm(state.endKm)} km. Druk op "Bevestig selectie"`;
        }
      }
    }
  }
}


// --------------------
// EVENTS
// --------------------
// ====================
// STAGES SETTINGS DROPDOWN
// ====================
function toggleStagesSettingsDropdown() {
  let dropdown = document.getElementById('stagesSettingsDropdown');

  // If dropdown exists and is visible, close it
  if (dropdown && dropdown.style.display === 'block') {
    closeStagesSettingsDropdown();
    return;
  }

  // Remove existing dropdown
  if (dropdown) dropdown.remove();

  // Get stages data
  const allStages = window._stagesWidgetData?.allStages || [];

  // Create new dropdown
  dropdown = document.createElement('div');
  dropdown.id = 'stagesSettingsDropdown';
  dropdown.className = 'stages-settings-dropdown';
  dropdown.innerHTML = `
    <div class="stages-settings-content">
      <div class="stages-settings-header">
        <span>Toon etappes</span>
      </div>
      <div class="stages-settings-options">
        <button class="stages-option ${state.planMode === 'official' ? 'stages-option--active' : ''}" data-stages-mode="official">
          <span class="stages-option-icon">📋</span>
          <span class="stages-option-text">
            <strong>Officiële etappes</strong>
            <small>${state.startStage !== null || state.endStage !== null ? 'Met jouw selectie uit planner' : 'Alle ' + allStages.length + ' etappes'}</small>
          </span>
        </button>
        <button class="stages-option ${state.planMode === 'custom' ? 'stages-option--active' : ''}" data-stages-mode="custom">
          <span class="stages-option-icon">✏️</span>
          <span class="stages-option-text">
            <strong>Eigen etappes</strong>
            <small>Gebaseerd op ${state.targetPerDay} km per dag</small>
          </span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(dropdown);

  // Position dropdown near the settings button
  const btn = document.querySelector("[data-settings='stages']");
  if (btn) {
    const rect = btn.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 8}px`;
    dropdown.style.right = `${window.innerWidth - rect.right}px`;
    dropdown.style.display = 'block';
  }

  // Add click handlers directly to the dropdown
  dropdown.addEventListener('click', async (e) => {
    // Stages Mode Option
    const stagesModeOption = e.target.closest("[data-stages-mode]");
    if (stagesModeOption) {
      const mode = stagesModeOption.dataset.stagesMode;
      if (mode === 'official' || mode === 'custom') {
        state.planMode = mode;
        savePreferences();
        closeStagesSettingsDropdown();
        // Refresh the dashboard to show updated stages
        await refreshStagesWidget();
      }
      return;
    }
  });

  // Close dropdown when clicking outside
  setTimeout(() => {
    document.addEventListener('click', handleDropdownOutsideClick);
  }, 10);
}

function handleDropdownOutsideClick(e) {
  if (!e.target.closest(".stages-settings-dropdown") && !e.target.closest("[data-settings='stages']")) {
    closeStagesSettingsDropdown();
    document.removeEventListener('click', handleDropdownOutsideClick);
  }
}

function closeStagesSettingsDropdown() {
  const dropdown = document.getElementById('stagesSettingsDropdown');
  if (dropdown) {
    dropdown.remove();
  }
  document.removeEventListener('click', handleDropdownOutsideClick);
}

async function refreshStagesWidget() {
  // Re-render the entire dashboard to get updated stages
  if (state.selectedTrailId && state.currentTrailData) {
    const userTrail = state.userTrails.find(t => t.id === state.selectedTrailId);
    if (userTrail) {
      await renderTrailDashboard(userTrail, state.currentTrailData);
    }
  }
}

// ====================
// TOOL HANDLERS (Hiking OS)
// ====================
function handleToolClick(tool) {
  switch (tool) {
    case 'sos':
      showSOSModal();
      break;
    case 'firstaid':
      showFirstAidModal();
      break;
    case 'torch':
      toggleTorch();
      break;
    case 'compass':
      showCompassModal();
      break;
    case 'weather':
      showWeatherModal();
      break;
    case 'journal':
      showJournalModal();
      break;
    default:
      console.log('Unknown tool:', tool);
  }
}

function showSOSModal() {
  const content = `
    <div class="sos-content">
      <!-- Locatie Widget -->
      <div class="sos-location-widget" id="sosLocationWidget">
        <div class="sos-location-header">
          <span class="sos-location-icon">📍</span>
          <span class="sos-location-title">Mijn locatie</span>
          <button class="sos-location-refresh" onclick="refreshSOSLocation()">🔄</button>
        </div>
        <div class="sos-location-coords" id="sosLocationCoords">
          <span class="sos-location-loading">Locatie ophalen...</span>
        </div>
        <p class="sos-location-tip">Tip: Geef deze coördinaten door bij het bellen van 112</p>
      </div>

      <p class="sos-intro">Klik op een categorie voor meer informatie en het juiste nummer.</p>

      <!-- Categorie 1: Levensbedreigend -->
      <div class="sos-category sos-category--emergency" data-sos="112">
        <div class="sos-category-header">
          <div class="sos-category-info">
            <h4>🚨 Levensbedreigend</h4>
            <p>Acuut gevaar, brand, heterdaad</p>
          </div>
          <div class="sos-category-number">112</div>
        </div>
      </div>

      <!-- Categorie 2: Politie geen spoed -->
      <div class="sos-category sos-category--police" data-sos="geen-spoed">
        <div class="sos-category-header">
          <div class="sos-category-info">
            <h4>👮 Politie (geen spoed)</h4>
            <p>Wel politie nodig, geen sirenes</p>
          </div>
          <div class="sos-category-number">0900-8844</div>
        </div>
      </div>

      <!-- Categorie 3: Huisartsenpost -->
      <div class="sos-category sos-category--medical" data-sos="huisartsenpost">
        <div class="sos-category-header">
          <div class="sos-category-info">
            <h4>🏥 Huisartsenpost</h4>
            <p>Medisch dringend, niet levensbedreigend</p>
          </div>
          <div class="sos-category-action">Zoek →</div>
        </div>
      </div>

      <!-- Categorie 4: Dieren -->
      <div class="sos-category sos-category--animal" data-sos="dieren">
        <div class="sos-category-header">
          <div class="sos-category-info">
            <h4>🐾 Dieren in nood</h4>
            <p>Gewond dier, wild of huisdier</p>
          </div>
          <div class="sos-category-number">144</div>
        </div>
      </div>

      <!-- Extra: ICE -->
      <div class="sos-extra-section">
        <h5>🆘 ICE (In Case of Emergency)</h5>
        <p>Stel je Medical ID in zodat hulpverleners je noodcontact kunnen bellen zonder je telefoon te ontgrendelen.</p>
        <div class="sos-ice-buttons">
          <button class="sos-ice-btn" data-ice="iphone">iPhone uitleg</button>
          <button class="sos-ice-btn" data-ice="android">Android uitleg</button>
        </div>
      </div>

      <!-- Direct bellen -->
      <div class="sos-call-section">
        <a href="tel:112" class="sos-emergency-call-btn">
          📞 Bel 112 nu
        </a>
      </div>
    </div>
  `;

  showToolModal('🆘 Noodgevallen & Hulp', content, { sosClickable: true });

  // Start locatie ophalen
  setTimeout(refreshSOSLocation, 100);
}

function refreshSOSLocation() {
  const coordsEl = document.getElementById('sosLocationCoords');
  if (!coordsEl) return;

  coordsEl.innerHTML = '<span class="sos-location-loading">Locatie ophalen...</span>';

  if (!navigator.geolocation) {
    coordsEl.innerHTML = '<span class="sos-location-error">Locatie niet beschikbaar</span>';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude.toFixed(6);
      const lon = position.coords.longitude.toFixed(6);
      coordsEl.innerHTML = `
        <div class="sos-coords-display">
          <strong>${lat}, ${lon}</strong>
          <button class="sos-copy-btn" onclick="navigator.clipboard.writeText('${lat}, ${lon}'); this.textContent='✓ Gekopieerd'">📋 Kopieer</button>
        </div>
      `;
    },
    (error) => {
      coordsEl.innerHTML = '<span class="sos-location-error">Kon locatie niet ophalen</span>';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function showSOSInfographic(topic) {
  const infographics = {
    '112': { 
      title: 'Spoed: Levensbedreigend', 
      image: 'data/widgets/sos/sos-112.png',
      callNumber: '112'
    },
    'geen-spoed': { 
      title: 'Politie: Geen Spoed', 
      image: 'data/widgets/sos/sos-geen-spoed.png',
      callNumber: '0900-8844'
    },
    'huisartsenpost': { 
      title: 'Medisch: Huisartsenpost', 
      image: 'data/widgets/sos/sos-huisartsenpost.png',
      callNumber: null,
      searchUrl: 'https://www.google.com/search?q=huisartsenpost+bij+mij+in+de+buurt'
    },
    'dieren': { 
      title: 'Dieren in Nood', 
      image: 'data/widgets/sos/sos-dieren.png',
      callNumber: '144'
    }
  };

  const info = infographics[topic];
  if (!info) return;

  // Create fullscreen overlay
  const overlay = document.createElement('div');
  overlay.className = 'sos-infographic-overlay';
  overlay.innerHTML = `
    <div class="sos-infographic-content">
      <div class="sos-infographic-header">
        <button class="sos-infographic-back" onclick="this.closest('.sos-infographic-overlay').remove()">
          ← Terug
        </button>
        <h3>${info.title}</h3>
      </div>
      <div class="sos-infographic-image">
        <img src="${info.image}" alt="${info.title}" />
      </div>
      <div class="sos-infographic-action">
        ${info.callNumber 
          ? `<a href="tel:${info.callNumber.replace(/-/g, '')}" class="sos-infographic-call-btn">📞 Bel ${info.callNumber}</a>`
          : `<a href="${info.searchUrl}" target="_blank" class="sos-infographic-search-btn">🔍 Zoek huisartsenpost</a>`
        }
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('sos-infographic-overlay--open'));
}

function showICEInfographic(platform) {
  const infographics = {
    iphone: {
      title: 'iPhone: Medisch ID instellen',
      image: 'data/widgets/sos/sos-ice-iphone.png',
      instructions: `
        <p>Met Medisch ID kunnen hulpverleners je medische gegevens en noodcontacten zien zonder je telefoon te ontgrendelen.</p>
        <ol>
          <li>Open de <strong>Gezondheid-app</strong> (wit icoon met rood hartje).</li>
          <li>Tik rechtsboven op je <strong>profielfoto</strong>.</li>
          <li>Tik op <strong>Medisch ID</strong>.</li>
          <li>Tik op <strong>Wijzig</strong> en voeg je medische info en contacten voor noodgevallen toe.</li>
          <li><strong>BELANGRIJK:</strong> Zorg dat 'Toon bij vergrendeling' aan staat (groen).</li>
          <li>Tik op <strong>Gereed</strong>.</li>
        </ol>
        <p class="ice-test-tip">💡 <strong>Testen?</strong> Houd de zijknop en een volumeknop ingedrukt. Je ziet nu de schuifknop 'Medisch ID'.</p>
      `
    },
    android: {
      title: 'Android: Noodinformatie instellen',
      image: 'data/widgets/sos/sos-ice-android.png',
      instructions: `
        <p><em>Let op: Menu's kunnen verschillen per merk (Samsung, Pixel, etc.), maar dit is de standaard route.</em></p>
        <ol>
          <li>Ga naar <strong>Instellingen</strong>.</li>
          <li>Zoek naar <strong>Veiligheid & noodgevallen</strong> of <strong>Noodsituatie</strong>.</li>
          <li>Tik op <strong>Medische informatie</strong> en vul je gegevens in.</li>
          <li>Tik op <strong>Contacten voor noodgevallen</strong> en voeg personen toe.</li>
          <li>Zorg dat de optie <strong>Toegankelijk via vergrendelscherm</strong> aan staat.</li>
        </ol>
        <p class="ice-test-tip">💡 <strong>Testen?</strong> Veeg omhoog op je vergrendelscherm, tik op 'Noodoproep' en dan op 'Noodinformatie'.</p>
      `
    }
  };

  const info = infographics[platform];
  if (!info) return;

  const overlay = document.createElement('div');
  overlay.className = 'ice-infographic-overlay';
  overlay.innerHTML = `
    <div class="ice-infographic-content">
      <div class="ice-infographic-header">
        <button class="ice-infographic-back" onclick="this.closest('.ice-infographic-overlay').remove()">
          ← Terug
        </button>
        <h3>${info.title}</h3>
      </div>
      <div class="ice-infographic-body">
        <div class="ice-infographic-image">
          <img src="${info.image}" alt="${info.title}" />
        </div>
        <div class="ice-infographic-instructions">
          ${info.instructions}
        </div>
      </div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('ice-infographic-overlay--open'));
}

function showFirstAidModal() {
  const content = `
    <div class="firstaid-content">
      <p class="firstaid-intro">Klik op een onderwerp voor gedetailleerde instructies met afbeeldingen.</p>

      <div class="firstaid-item" data-ehbo="blaren">
        <div class="firstaid-item-header">
          <h4>🩹 Blaren</h4>
          <span class="firstaid-arrow">→</span>
        </div>
        <p>Niet doorprikken. Bescherm met blaarpleister. Voeten droog houden.</p>
      </div>
      <div class="firstaid-item" data-ehbo="verstuiking">
        <div class="firstaid-item-header">
          <h4>🦵 Verstuiking</h4>
          <span class="firstaid-arrow">→</span>
        </div>
        <p>RICE: Rest, Ice, Compression, Elevation. Koelen indien mogelijk.</p>
      </div>
      <div class="firstaid-item" data-ehbo="hitteberoerte">
        <div class="firstaid-item-header">
          <h4>☀️ Hitteberoerte</h4>
          <span class="firstaid-arrow">→</span>
        </div>
        <p>Schaduw zoeken, water drinken, koele doeken op hoofd/nek.</p>
      </div>
      <div class="firstaid-item" data-ehbo="onderkoeling">
        <div class="firstaid-item-header">
          <h4>🥶 Onderkoeling</h4>
          <span class="firstaid-arrow">→</span>
        </div>
        <p>Droge kleding, warme dranken (geen alcohol), uit de wind.</p>
      </div>
      <div class="firstaid-item" data-ehbo="insectenbeet">
        <div class="firstaid-item-header">
          <h4>🐝 Insectenbeet</h4>
          <span class="firstaid-arrow">→</span>
        </div>
        <p>Verwijder angel indien aanwezig, koelen, antihistamine indien beschikbaar.</p>
      </div>
      <div class="firstaid-item" data-ehbo="tekenbeet">
        <div class="firstaid-item-header">
          <h4>🔬 Tekenbeet</h4>
          <span class="firstaid-arrow">→</span>
        </div>
        <p>Controleer na wandeling, verwijder met tang, let op rode kring.</p>
      </div>
    </div>
  `;
  showToolModal('🩹 EHBO voor hikers', content, { ehboClickable: true });
}

function showEhboInfographic(topic) {
  const infographics = {
    blaren: { title: 'Blaren: Behandeling & Zorg', image: 'data/widgets/ehbo/ehbo-blaren.png' },
    verstuiking: { title: 'Verstuiking: RICE-methode', image: 'data/widgets/ehbo/ehbo-verstuiking.png' },
    hitteberoerte: { title: 'Hitteberoerte: Behandeling', image: 'data/widgets/ehbo/ehbo-hitteberoerte.png' },
    onderkoeling: { title: 'Onderkoeling: Behandeling', image: 'data/widgets/ehbo/ehbo-onderkoeling.png' },
    insectenbeet: { title: 'Insectenbeet: Behandeling', image: 'data/widgets/ehbo/ehbo-insectenbeet.png' },
    tekenbeet: { title: 'Teken: Controle & Verwijdering', image: 'data/widgets/ehbo/ehbo-tekenbeet.png', link: 'https://www.tekenradar.nl', linkText: '🔬 Tekenradar.nl' }
  };

  const info = infographics[topic];
  if (!info) return;

  // Create fullscreen image overlay
  const overlay = document.createElement('div');
  overlay.className = 'ehbo-infographic-overlay';
  overlay.innerHTML = `
    <div class="ehbo-infographic-content">
      <div class="ehbo-infographic-header">
        <button class="ehbo-infographic-back" onclick="this.closest('.ehbo-infographic-overlay').remove()">
          ← Terug
        </button>
        <h3>${info.title}</h3>
      </div>
      <div class="ehbo-infographic-image">
        <img src="${info.image}" alt="${info.title}" />
      </div>
      ${info.link ? `
        <div class="ehbo-infographic-action">
          <a href="${info.link}" target="_blank" class="ehbo-infographic-link">${info.linkText || 'Meer info →'}</a>
        </div>
      ` : ''}
    </div>
  `;

  // Close on background click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(() => overlay.classList.add('ehbo-infographic-overlay--open'));
}

function toggleTorch() {
  // Use screen as torch (white background)
  const existing = document.getElementById('torchOverlay');
  if (existing) {
    existing.remove();
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'torchOverlay';
  overlay.innerHTML = `
    <div class="torch-screen">
      <button class="torch-close" onclick="document.getElementById('torchOverlay').remove()">✕ Sluit</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

function showCompassModal() {
  const content = `
    <div class="compass-content">
      <div class="compass-display">
        <div class="compass-rose" id="compassRose">
          <div class="compass-needle"></div>
          <div class="compass-labels">
            <span class="compass-n">N</span>
            <span class="compass-e">O</span>
            <span class="compass-s">Z</span>
            <span class="compass-w">W</span>
          </div>
        </div>
      </div>
      <p class="compass-note">Kompas gebruikt je telefoon sensoren (indien beschikbaar).</p>
    </div>
  `;
  showToolModal('🧭 Kompas', content);

  // Try to use device orientation
  if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientation', handleCompassOrientation);
  }
}

function handleCompassOrientation(e) {
  const compass = document.getElementById('compassRose');
  if (compass && e.alpha !== null) {
    compass.style.transform = `rotate(${-e.alpha}deg)`;
  }
}

function showWeatherModal() {
  const content = `
    <div class="weather-content">
      <p class="weather-loading">🌤️ Weer laden...</p>
      <div class="weather-links">
        <a href="https://www.buienradar.nl" target="_blank" class="weather-link">🇳🇱 Buienradar</a>
        <a href="https://www.yr.no" target="_blank" class="weather-link">🌍 Yr.no</a>
        <a href="https://www.meteoblue.com" target="_blank" class="weather-link">⛰️ Meteoblue</a>
      </div>
    </div>
  `;
  showToolModal('🌤️ Weer', content);
}

function showJournalModal() {
  const content = `
    <div class="journal-content">
      <p class="journal-intro">📓 Dagboek functie komt binnenkort!</p>
      <p>Hier kun je straks per etappe notities, foto's en herinneringen vastleggen.</p>
      <ul class="journal-features">
        <li>✅ Automatische etappe-info (datum, afstand, hoogtemeters)</li>
        <li>✅ Weer van die dag</li>
        <li>✅ Foto's toevoegen</li>
        <li>✅ Persoonlijke notities</li>
        <li>✅ Exporteren als PDF</li>
      </ul>
    </div>
  `;
  showToolModal('📓 Dagboek', content);
}

function showToolModal(title, content, options = {}) {
  // Remove existing modal
  const existing = document.getElementById('toolModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'toolModal';
  modal.className = 'tool-modal-overlay';
  modal.innerHTML = `
    <div class="tool-modal">
      <div class="tool-modal-header">
        <h3>${title}</h3>
        <button class="tool-modal-close" onclick="document.getElementById('toolModal').remove()">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6 6 18M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div class="tool-modal-body">
        ${content}
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  // Handle EHBO item clicks
  if (options.ehboClickable) {
    modal.querySelectorAll('[data-ehbo]').forEach(item => {
      item.addEventListener('click', () => {
        const topic = item.dataset.ehbo;
        showEhboInfographic(topic);
      });
    });
  }

  // Handle SOS category clicks
  if (options.sosClickable) {
    modal.querySelectorAll('[data-sos]').forEach(item => {
      item.addEventListener('click', () => {
        const topic = item.dataset.sos;
        showSOSInfographic(topic);
      });
    });

    // Handle ICE button clicks
    modal.querySelectorAll('[data-ice]').forEach(item => {
      item.addEventListener('click', () => {
        const platform = item.dataset.ice;
        showICEInfographic(platform);
      });
    });
  }
}

function showConfirmModal({ title, message, confirmText = 'OK', cancelText = 'Annuleren', danger = false, onConfirm }) {
  const modal = document.createElement('div');
  modal.className = 'confirm-modal-overlay';
  modal.innerHTML = `
    <div class="confirm-modal">
      <div class="confirm-modal-icon ${danger ? 'confirm-modal-icon--danger' : ''}">
        ${danger ? `
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"></path>
          </svg>
        ` : `
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 8v4M12 16h.01"></path>
          </svg>
        `}
      </div>
      <h3 class="confirm-modal-title">${escapeHtml(title)}</h3>
      <p class="confirm-modal-message">${escapeHtml(message)}</p>
      <div class="confirm-modal-buttons">
        <button class="confirm-modal-btn confirm-modal-btn--cancel">${escapeHtml(cancelText)}</button>
        <button class="confirm-modal-btn ${danger ? 'confirm-modal-btn--danger' : 'confirm-modal-btn--primary'}">${escapeHtml(confirmText)}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Animate in
  requestAnimationFrame(() => {
    modal.classList.add('confirm-modal-overlay--visible');
  });

  // Close function
  const closeModal = () => {
    modal.classList.remove('confirm-modal-overlay--visible');
    setTimeout(() => modal.remove(), 200);
  };

  // Cancel button
  modal.querySelector('.confirm-modal-btn--cancel').addEventListener('click', closeModal);

  // Confirm button
  modal.querySelector(`.confirm-modal-btn--${danger ? 'danger' : 'primary'}`).addEventListener('click', () => {
    closeModal();
    if (onConfirm) onConfirm();
  });

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Escape to close
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function debounce(fn, delay = 300) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

function installEvents() {
  app.addEventListener("click", async e => {
    // ====================
    // Close any open dropdowns when clicking elsewhere
    // ====================
    if (!e.target.closest('.trail-card-menu') && !e.target.closest('.trail-card-dropdown')) {
      document.querySelectorAll('.trail-card-dropdown--open').forEach(d => {
        d.classList.remove('trail-card-dropdown--open');
      });
    }

    // Close status dropdowns when clicking elsewhere
    if (!e.target.closest('.trail-card-status-wrapper')) {
      document.querySelectorAll('.status-dropdown--open').forEach(d => {
        d.classList.remove('status-dropdown--open');
        d.closest('.trail-card-status-wrapper')?.classList.remove('open');
      });
    }

    // Close home filter dropdown when clicking elsewhere
    if (!e.target.closest('.home-filter-wrapper')) {
      document.querySelectorAll('.home-filter-dropdown--open').forEach(d => {
        d.classList.remove('home-filter-dropdown--open');
        d.closest('.home-filter-wrapper')?.classList.remove('open');
      });
    }

    // ====================
    // Home Filter Toggle
    // ====================
    if (e.target.closest('#homeFilterBtn')) {
      e.stopPropagation();
      const dropdown = document.getElementById('homeFilterDropdown');
      const wrapper = e.target.closest('.home-filter-wrapper');
      dropdown?.classList.toggle('home-filter-dropdown--open');
      wrapper?.classList.toggle('open');
      return;
    }

    // ====================
    // Home Filter Selection
    // ====================
    const filterItem = e.target.closest('[data-home-filter]');
    if (filterItem) {
      e.stopPropagation();
      const newFilter = filterItem.dataset.homeFilter;
      state.homeStatusFilter = newFilter;

      // Close dropdown
      document.getElementById('homeFilterDropdown')?.classList.remove('home-filter-dropdown--open');
      document.querySelector('.home-filter-wrapper')?.classList.remove('open');

      // Re-render home view
      const mainEl = document.getElementById('appMain');
      if (mainEl && state.currentView === 'home') {
        mainEl.innerHTML = renderHomeView(state.trailsIndex);
      }
      return;
    }

    // ====================
    // Status Dropdown Toggle
    // ====================
    const statusToggle = e.target.closest('[data-status-toggle]');
    if (statusToggle) {
      e.stopPropagation();
      e.preventDefault();
      const trailId = statusToggle.dataset.statusToggle;
      const dropdown = document.getElementById(`status-dropdown-${trailId}`);
      const wrapper = statusToggle.closest('.trail-card-status-wrapper');

      // Close other status dropdowns
      document.querySelectorAll('.status-dropdown--open').forEach(d => {
        if (d !== dropdown) {
          d.classList.remove('status-dropdown--open');
          d.closest('.trail-card-status-wrapper')?.classList.remove('open');
        }
      });

      // Toggle this dropdown
      if (dropdown) {
        dropdown.classList.toggle('status-dropdown--open');
        wrapper?.classList.toggle('open');
      }
      return;
    }

    // ====================
    // Status Change
    // ====================
    const statusItem = e.target.closest('[data-set-status]');
    if (statusItem) {
      e.stopPropagation();
      const newStatus = statusItem.dataset.setStatus;
      const trailId = statusItem.dataset.trailId;

      // Update status
      updateUserTrailStatus(trailId, newStatus);

      // Close dropdown
      const dropdown = statusItem.closest('.status-dropdown');
      dropdown?.classList.remove('status-dropdown--open');
      dropdown?.closest('.trail-card-status-wrapper')?.classList.remove('open');

      // Re-render home view to show updated status
      const mainEl = document.getElementById('appMain');
      if (mainEl && state.currentView === 'home') {
        mainEl.innerHTML = renderHomeView(state.trailsIndex);
      }
      return;
    }

    // ====================
    // Trail Card Menu Toggle
    // ====================
    const menuBtn = e.target.closest('[data-trail-menu]');
    if (menuBtn) {
      e.stopPropagation();
      const trailId = menuBtn.dataset.trailMenu;
      const dropdown = document.getElementById(`dropdown-${trailId}`);

      // Close other dropdowns
      document.querySelectorAll('.trail-card-dropdown--open').forEach(d => {
        if (d !== dropdown) d.classList.remove('trail-card-dropdown--open');
      });

      // Toggle this dropdown
      if (dropdown) {
        dropdown.classList.toggle('trail-card-dropdown--open');
      }
      return;
    }

    // ====================
    // Remove Trail
    // ====================
    const removeBtn = e.target.closest('[data-remove-trail]');
    if (removeBtn) {
      e.stopPropagation();
      const trailId = removeBtn.dataset.removeTrail;

      // Find trail name for confirmation
      const userTrail = state.userTrails.find(t => t.id === trailId);
      const trailName = userTrail?.name || 'deze trail';

      // Show custom confirm modal
      showConfirmModal({
        title: 'Trail verwijderen',
        message: `Weet je zeker dat je "${trailName}" wilt verwijderen?`,
        confirmText: 'Verwijderen',
        cancelText: 'Annuleren',
        danger: true,
        onConfirm: () => {
          removeUserTrail(trailId);

          // Re-render home view
          const mainEl = document.getElementById('appMain');
          if (mainEl) {
            mainEl.innerHTML = renderHomeView(state.trailsIndex);
          }
        }
      });
      return;
    }

    // ====================
    // NEW UI: Trail Cards
    // ====================
    const trailCard = e.target.closest(".trail-card:not(.trail-card--add)");
    if (trailCard && !e.target.closest(".trail-card-menu") && !e.target.closest(".trail-card-dropdown") && !e.target.closest(".trail-card-status-wrapper")) {
      const trailId = trailCard.dataset.trailId;
      const jsonUrl = trailCard.dataset.json;
      const userTrail = state.userTrails.find(t => t.id === trailId);

      if (userTrail && jsonUrl) {
        try {
          const trailData = await loadJson(jsonUrl);
          await renderTrailDashboard(userTrail, trailData);
        } catch (err) {
          console.error('Failed to load trail:', err);
        }
      }
      return;
    }

    // Add Trail Button
    if (e.target.closest("#addTrailBtn")) {
      const modal = document.getElementById('trailPickerModal');
      if (modal) modal.style.display = 'flex';
      return;
    }

    // Close Trail Picker
    if (e.target.closest("#closeTrailPicker") || (e.target.classList.contains('modal-overlay') && e.target.id === 'trailPickerModal')) {
      const modal = document.getElementById('trailPickerModal');
      if (modal) modal.style.display = 'none';
      return;
    }

    // Trail Picker Card
    const pickerCard = e.target.closest(".picker-card:not(.picker-card--added)");
    if (pickerCard) {
      const jsonUrl = pickerCard.dataset.json;
      try {
        const trailData = await loadJson(jsonUrl);
        addUserTrail(jsonUrl, trailData);

        // Mark card as added
        pickerCard.classList.add('picker-card--added');
        pickerCard.disabled = true;
        const badge = pickerCard.querySelector('.picker-card-badge');
        if (!badge) {
          const imageDiv = pickerCard.querySelector('.picker-card-image');
          if (imageDiv) {
            const newBadge = document.createElement('span');
            newBadge.className = 'picker-card-badge';
            newBadge.textContent = '✓ Toegevoegd';
            imageDiv.appendChild(newBadge);
          }
        }

        // Re-render home view
        const mainEl = document.getElementById('appMain');
        if (mainEl) {
          mainEl.innerHTML = renderHomeView(state.trailsIndex);
        }
      } catch (err) {
        console.error('Failed to add trail:', err);
      }
      return;
    }

    // Back to Home Button
    if (e.target.closest("#backToHome")) {
      state.currentView = 'home';
      state.selectedTrailId = null;

      // Clean up maps
      if (state.previewMap) {
        state.previewMap.remove();
        state.previewMap = null;
      }

      const mainEl = document.getElementById('appMain');
      if (mainEl) {
        mainEl.innerHTML = renderHomeView(state.trailsIndex);
      }
      return;
    }

    // Hide Widget - must be checked BEFORE widget toggle
    const hideWidgetBtn = e.target.closest('[data-hide-widget]');
    if (hideWidgetBtn) {
      e.stopPropagation();
      e.preventDefault();
      const widgetId = hideWidgetBtn.dataset.hideWidget;
      const trailId = hideWidgetBtn.dataset.trail;

      toggleWidgetHidden(trailId, widgetId);

      // Re-render dashboard
      const userTrail = state.userTrails.find(t => t.id === trailId);
      if (userTrail && state.currentTrailData) {
        renderTrailDashboard(userTrail, state.currentTrailData);
      }
      return;
    }

    // Open Journal View - check before widget toggle
    if (e.target.closest('[data-open-journal]')) {
      e.stopPropagation();
      renderJournalView();
      return;
    }

    // Widget Toggle (collapse/expand)
    const widgetToggle = e.target.closest("[data-toggle-widget]");
    if (widgetToggle && !e.target.closest(".widget-expand-btn") && !e.target.closest(".widget-settings-btn") && !e.target.closest(".widget-drag-handle") && !e.target.closest("[data-hide-widget]") && !e.target.closest(".widget-hide-btn") && !e.target.closest(".widget-action-btn")) {
      const widgetId = widgetToggle.dataset.toggleWidget;
      const widget = e.target.closest(".widget");
      const trailId = widget?.dataset.trail;

      if (trailId && widgetId) {
        toggleWidgetCollapsed(trailId, widgetId);
        widget.classList.toggle('widget--collapsed');

        // Force height update
        if (widget.classList.contains('widget--collapsed')) {
          widget.style.height = 'auto';
        } else {
          // Remove inline style to let CSS take over
          widget.style.height = '';
        }
      }
      return;
    }

    // Widget Expand (fullscreen)
    const expandBtn = e.target.closest("[data-expand-widget]");
    if (expandBtn) {
      const widgetId = expandBtn.dataset.expandWidget;
      if (widgetId === 'map') {
        openFullMapModal();
      }
      return;
    }

    // Dashboard map overlay click
    if (e.target.closest("[data-action='open-full-map']")) {
      openFullMapModal();
      return;
    }

    // Carousel navigation - Previous
    if (e.target.closest('[data-carousel-prev]')) {
      e.stopPropagation();
      const carousel = e.target.closest('.photos-carousel');
      if (carousel) navigateCarousel(carousel, -1);
      return;
    }

    // Carousel navigation - Next
    if (e.target.closest('[data-carousel-next]')) {
      e.stopPropagation();
      const carousel = e.target.closest('.photos-carousel');
      if (carousel) navigateCarousel(carousel, 1);
      return;
    }

    // Carousel dot click
    const carouselDot = e.target.closest('.carousel-dot');
    if (carouselDot) {
      e.stopPropagation();
      const dotIndex = parseInt(carouselDot.dataset.dot);
      const carousel = e.target.closest('.photos-carousel');
      if (carousel && !isNaN(dotIndex)) {
        goToSlide(carousel, dotIndex);
      }
      return;
    }

    // Carousel image click - open fullscreen
    const carouselSlide = e.target.closest('.carousel-slide');
    if (carouselSlide) {
      const img = carouselSlide.querySelector('img');
      if (img) {
        openPhotoFullscreen(img.src, img.alt);
      }
      return;
    }

    // Widget Menu Toggle
    const widgetMenuBtn = e.target.closest('[data-widget-menu]');
    if (widgetMenuBtn) {
      e.stopPropagation();
      const widgetId = widgetMenuBtn.dataset.widgetMenu;
      const dropdown = document.getElementById(`widget-menu-${widgetId}`);

      // Close other widget menus
      document.querySelectorAll('.widget-menu-dropdown--open').forEach(d => {
        if (d !== dropdown) d.classList.remove('widget-menu-dropdown--open');
      });

      dropdown?.classList.toggle('widget-menu-dropdown--open');
      return;
    }

    // Edit Dashboard Button - Enter edit mode
    if (e.target.closest('#editDashboardBtn')) {
      state.dashboardEditMode = true;
      const userTrail = state.userTrails.find(t => t.id === state.selectedTrailId);
      if (userTrail && state.currentTrailData) {
        renderTrailDashboard(userTrail, state.currentTrailData);
      }
      return;
    }

    // Exit Edit Mode Button
    if (e.target.closest('[data-exit-edit-mode]')) {
      state.dashboardEditMode = false;
      const userTrail = state.userTrails.find(t => t.id === state.selectedTrailId);
      if (userTrail && state.currentTrailData) {
        renderTrailDashboard(userTrail, state.currentTrailData);
      }
      return;
    }

    // Open Restore Hidden Widgets Modal
    if (e.target.closest('[data-open-restore-modal]')) {
      openWidgetManagerModal();
      return;
    }

    // Back to Dashboard from Journal
    if (e.target.closest('[data-back-to-dashboard]')) {
      const userTrail = state.userTrails.find(t => t.id === state.selectedTrailId);
      if (userTrail && state.currentTrailData) {
        renderTrailDashboard(userTrail, state.currentTrailData);
      }
      return;
    }

    // Toggle Stage Completed (checkbox in stages widget)
    const toggleStageBtn = e.target.closest('[data-toggle-stage]');
    if (toggleStageBtn) {
      e.stopPropagation();
      const stageIndex = parseInt(toggleStageBtn.dataset.toggleStage);
      const trailId = toggleStageBtn.dataset.trail;

      toggleStageCompleted(trailId, stageIndex);

      // Re-render dashboard to update all widgets
      const userTrail = state.userTrails.find(t => t.id === trailId);
      if (userTrail && state.currentTrailData) {
        renderTrailDashboard(userTrail, state.currentTrailData);
      }
      return;
    }

    // Edit Journal Entry
    const editEntryBtn = e.target.closest('[data-edit-entry]');
    if (editEntryBtn) {
      const stageIndex = parseInt(editEntryBtn.dataset.editEntry);
      const trailId = editEntryBtn.dataset.trail;
      openJournalEditor(trailId, stageIndex);
      return;
    }

    // View Journal Entry
    const viewEntryBtn = e.target.closest('[data-view-entry]');
    if (viewEntryBtn) {
      const stageIndex = parseInt(viewEntryBtn.dataset.viewEntry);
      const trailId = viewEntryBtn.dataset.trail;
      openJournalEntryView(trailId, stageIndex);
      return;
    }

    // Show Hidden Widget (from modal)
    const showWidgetBtn = e.target.closest('[data-show-widget]');
    if (showWidgetBtn) {
      const widgetId = showWidgetBtn.dataset.showWidget;
      const trailId = showWidgetBtn.dataset.trail;

      setWidgetState(trailId, widgetId, { hidden: false });

      // Update modal
      openWidgetManagerModal();
      return;
    }

    // Reset Widgets Layout
    const resetWidgetsBtn = e.target.closest('[data-reset-widgets]');
    if (resetWidgetsBtn) {
      const trailId = resetWidgetsBtn.dataset.trail;

      // Reset layout to default
      const layoutKey = `${trailId}_layout`;
      delete state.widgetStates[layoutKey];

      // Reset all widget hidden states
      ['map', 'stats', 'description', 'stages', 'planner', 'tools', 'journal', 'photos'].forEach(widgetId => {
        setWidgetState(trailId, widgetId, { hidden: false });
      });

      savePreferences();
      closeWidgetManagerModal();
      return;
    }

    // Close widget menus when clicking elsewhere
    if (!e.target.closest('.widget-menu-btn') && !e.target.closest('.widget-menu-dropdown')) {
      document.querySelectorAll('.widget-menu-dropdown--open').forEach(d => {
        d.classList.remove('widget-menu-dropdown--open');
      });
    }

    // Description Modal
    if (e.target.closest("[data-open-description-modal]")) {
      openDescriptionModal();
      return;
    }

    // Stages Settings Button
    const stagesSettingsBtn = e.target.closest("[data-settings='stages']");
    if (stagesSettingsBtn) {
      e.stopPropagation(); // Prevent widget toggle
      toggleStagesSettingsDropdown();
      return;
    }

    // Open Full Planner (BYO mode)
    if (e.target.closest("#openFullPlanner")) {
      state.planMode = 'custom'; // Start in custom mode
      renderFullDetail();
      return;
    }

    // View All Stages -> Open Stages Overview
    if (e.target.closest("[data-view-all='stages']")) {
      openCalendarModal();
      return;
    }

    // Open Stage Detail Modal
    const openStageBtn = e.target.closest('[data-open-stage]');
    if (openStageBtn) {
      const stageIndex = parseInt(openStageBtn.dataset.openStage);
      const trailId = openStageBtn.dataset.trail;
      openStageDetailModal(trailId, stageIndex);
      return;
    }

    // Tool Buttons
    const toolBtn = e.target.closest(".tool-btn");
    if (toolBtn) {
      const tool = toolBtn.dataset.tool;
      handleToolClick(tool);
      return;
    }

    // EHBO Infographic items
    const ehboItem = e.target.closest("[data-ehbo]");
    if (ehboItem) {
      const topic = ehboItem.dataset.ehbo;
      showEhboInfographic(topic);
      return;
    }

    // ====================
    // EXISTING HANDLERS (unchanged)
    // ====================

    // Clear date button
    if (e.target.classList.contains("clearDateBtn")) {
      e.preventDefault();
      e.stopPropagation();
      state.startDate = null;
      savePreferences();
      renderFullDetail();
      return;
    }

    const trailBtn = e.target.closest(".trailBtn");
    if (trailBtn) {
      loadAndRenderBasicDetails(trailBtn.dataset.json);
      return;
    }

    if (e.target.closest(".openTrailBtn")) {
      renderFullDetail();
      return;
    }

    if (e.target.closest(".backBtn")) {
      // Check if we should go to dashboard or home
      if (state.selectedTrailId && state.currentView === 'planner') {
        // Go back to dashboard
        const userTrail = state.userTrails.find(t => t.id === state.selectedTrailId);
        if (userTrail && state.currentTrailData) {
          await renderTrailDashboard(userTrail, state.currentTrailData);
          return;
        }
      }

      // Original behavior for legacy view
      document.querySelector(".wrap")?.classList.remove("isDetail");

      // Completely remove the main map when going back
      if (state.map) {
        state.map.remove();
        state.map = null;
        state.fullTrackLayer = null;
        state.stageLayerGroup = L.layerGroup();
        state.poiLayerGroup = L.layerGroup();
      }

      if (state.previewMap) {
        state.previewMap.remove();
        state.previewMap = null;
      }
      loadAndRenderBasicDetails(state.currentTrailUrl);
      return;
    }

    const stageBtn = e.target.closest(".stageBtn");
    if (stageBtn) {
      renderStageDetail(Number(stageBtn.dataset.idx));
      return;
    }

    const modeBtn = e.target.closest(".modeBtn");
    if (modeBtn) {
      const mode = modeBtn.dataset.mode;
      if (mode === "official" || mode === "custom") {
        state.planMode = mode;
        renderFullDetail();
      }
      return;
    }

    if (e.target.closest(".reverseBtn")) {
      state.isReversed = !state.isReversed;
      renderFullDetail();
      return;
    }

    if (e.target.closest(".mapSelectToggle")) {
      // Open the map modal for selection
      openMapModal();
      return;
    }

    if (e.target.closest(".adjustEndpointBtn") || e.target.closest(".openEndpointModalBtn")) {
      console.log("🎯 PAS AAN BUTTON CLICKED!");
      const btn = e.target.closest(".adjustEndpointBtn") || e.target.closest(".openEndpointModalBtn");
      console.log("Button:", btn, "Stage idx:", btn.dataset.stageIdx);
      const stageIdx = Number(btn.dataset.stageIdx);
      openEndpointModal(stageIdx);
      return;
    }

    if (e.target.closest(".resetEndpointBtn")) {
      const btn = e.target.closest(".resetEndpointBtn");
      const stageIdx = Number(btn.dataset.stageIdx);
      resetStageEndpoint(stageIdx);
      return;
    }

    if (e.target.closest(".downloadGpxBtn")) {
      const btn = e.target.closest(".downloadGpxBtn");
      const stageIdx = Number(btn.dataset.stageIdx);
      downloadStageGPX(stageIdx);
      return;
    }

    const addRestBtn = e.target.closest(".addRestBtn");
    if (addRestBtn) {
      const afterIdx = Number(addRestBtn.dataset.afterIdx);
      // Increment the number of rest days for this stage
      state.restDays[afterIdx] = (state.restDays[afterIdx] || 0) + 1;
      renderFullDetail();
      return;
    }

    const addRestBtnSmall = e.target.closest(".addRestBtnSmall");
    if (addRestBtnSmall) {
      const afterIdx = Number(addRestBtnSmall.dataset.afterIdx);
      // Increment the number of rest days for this stage
      state.restDays[afterIdx] = (state.restDays[afterIdx] || 0) + 1;
      renderFullDetail();
      return;
    }

    const addRestBtnLarge = e.target.closest(".addRestBtnLarge");
    if (addRestBtnLarge) {
      const afterIdx = Number(addRestBtnLarge.dataset.afterIdx);
      // Increment the number of rest days for this stage
      state.restDays[afterIdx] = (state.restDays[afterIdx] || 0) + 1;
      renderFullDetail();
      return;
    }

    const removeRestBtn = e.target.closest(".removeRestBtn");
    if (removeRestBtn) {
      const afterIdx = Number(removeRestBtn.dataset.afterIdx);
      // Decrement the number of rest days, remove key if it reaches 0
      if (state.restDays[afterIdx]) {
        state.restDays[afterIdx]--;
        if (state.restDays[afterIdx] === 0) {
          delete state.restDays[afterIdx];
        }
      }
      renderFullDetail();
      return;
    }

    const removeRestBtnSmall = e.target.closest(".removeRestBtnSmall");
    if (removeRestBtnSmall) {
      const afterIdx = Number(removeRestBtnSmall.dataset.afterIdx);
      // Decrement the number of rest days, remove key if it reaches 0
      if (state.restDays[afterIdx]) {
        state.restDays[afterIdx]--;
        if (state.restDays[afterIdx] === 0) {
          delete state.restDays[afterIdx];
        }
      }
      renderFullDetail();
      return;
    }
  });

  // Use 'input' with debounce for smoother UX
  const debouncedUpdateTarget = debounce(() => {
    const input = document.querySelector(".targetInput");
    if (input) {
      const v = parseInt(input.value, 10);
      if (Number.isFinite(v) && v > 0) {
        state.targetPerDay = v;
        savePreferences(); // Save preference
        // Don't re-render while typing - update will happen on blur
        updateTargetDisplay();
      }
    }
  });

  function updateTargetDisplay() {
    // Update the estimated days display without re-rendering
    if (state.planMode !== 'custom') return;

    const direction = state.isReversed ? 'rev' : 'fwd';
    const cacheKey = `${state.currentTrailUrl}_${direction}`;
    const gpxProfile = state.gpxCache.get(cacheKey);

    if (!gpxProfile?.totalKm) return;

    const startKm = state.startKm !== null ? state.startKm : 0;
    const endKm = state.endKm !== null ? state.endKm : gpxProfile.totalKm;
    const distanceToPlan = endKm - startKm;

    if (distanceToPlan <= 0) return;

    const numStages = Math.max(1, Math.ceil(distanceToPlan / state.targetPerDay));

    // Find and update the days stat (second <li> in custom mode)
    const statsLis = document.querySelectorAll('.stats li');
    if (statsLis.length >= 2) {
      statsLis[1].textContent = `🧭 ${numStages} dagen`;
    }
  }

  const debouncedUpdateKm = debounce(() => {
    const startInput = document.querySelector(".startKmInput");
    const endInput = document.querySelector(".endKmInput");

    if (startInput) {
      const v = parseFloat(startInput.value);
      state.startKm = Number.isFinite(v) && v >= 0 ? v : null;
    }

    if (endInput) {
      const v = parseFloat(endInput.value);
      state.endKm = Number.isFinite(v) && v > 0 ? v : null;
    }

    // Don't re-render while typing - only update the display
    updateKmRangeDisplay();
  });

  function updateKmRangeDisplay() {
    // Update the total km display without re-rendering the whole page
    const statsKm = document.querySelector('.stats li');
    if (statsKm && state.startKm !== null && state.endKm !== null) {
      const selectedDistance = state.endKm - state.startKm;
      if (selectedDistance > 0) {
        statsKm.textContent = `📍 ${formatKm(selectedDistance)} km`;
      }
    }
  }

  // ====================
  // DRAG & DROP for Trail Cards
  // ====================
  let draggedCard = null;

  app.addEventListener('dragstart', e => {
    const card = e.target.closest('.trail-card:not(.trail-card--add)');
    if (!card) return;

    draggedCard = card;
    card.classList.add('dragging');
    document.querySelector('.trails-grid')?.classList.add('dragging');

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.trailId);
  });

  app.addEventListener('dragend', e => {
    const card = e.target.closest('.trail-card');
    if (!card) return;

    card.classList.remove('dragging');
    document.querySelector('.trails-grid')?.classList.remove('dragging');
    document.querySelectorAll('.trail-card.drag-over').forEach(c => c.classList.remove('drag-over'));
    draggedCard = null;
  });

  app.addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('.trail-card:not(.trail-card--add):not(.dragging)');
    if (!card || !draggedCard) return;

    e.dataTransfer.dropEffect = 'move';

    // Remove drag-over from other cards
    document.querySelectorAll('.trail-card.drag-over').forEach(c => {
      if (c !== card) c.classList.remove('drag-over');
    });

    card.classList.add('drag-over');
  });

  app.addEventListener('dragleave', e => {
    const card = e.target.closest('.trail-card');
    if (!card) return;

    // Only remove if we're actually leaving the card (not entering a child)
    if (!card.contains(e.relatedTarget)) {
      card.classList.remove('drag-over');
    }
  });

  app.addEventListener('drop', e => {
    e.preventDefault();
    const targetCard = e.target.closest('.trail-card:not(.trail-card--add):not(.dragging)');
    if (!targetCard || !draggedCard) return;

    targetCard.classList.remove('drag-over');

    const draggedId = draggedCard.dataset.trailId;
    const targetId = targetCard.dataset.trailId;

    if (draggedId === targetId) return;

    // Find indices in userTrails
    const draggedIndex = state.userTrails.findIndex(t => t.id === draggedId);
    const targetIndex = state.userTrails.findIndex(t => t.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Reorder the array
    const [removed] = state.userTrails.splice(draggedIndex, 1);
    state.userTrails.splice(targetIndex, 0, removed);

    // Save and re-render
    savePreferences();
    const mainEl = document.getElementById('appMain');
    if (mainEl && state.currentView === 'home') {
      mainEl.innerHTML = renderHomeView(state.trailsIndex);
    }
  });

  // ====================
  // DRAG & DROP for Widgets
  // ====================
  let draggedWidget = null;
  let draggedWidgetId = null;
  let sourceColumn = null;

  // Dragstart on widget drag handle - only in edit mode
  app.addEventListener('dragstart', e => {
    if (!state.dashboardEditMode) return;

    const dragHandle = e.target.closest('.widget-drag-handle');
    if (!dragHandle) return;

    const widget = dragHandle.closest('.widget');
    if (!widget) return;

    draggedWidget = widget;
    draggedWidgetId = widget.dataset.widget;
    sourceColumn = widget.closest('.widget-column');

    widget.classList.add('widget-dragging');

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedWidgetId);

    // Add visual indicator to all columns
    document.querySelectorAll('.widget-column').forEach(col => {
      col.classList.add('widget-column--drop-zone');
    });
  });

  // Dragend for widgets
  app.addEventListener('dragend', e => {
    if (!state.dashboardEditMode) return;

    const dragHandle = e.target.closest('.widget-drag-handle');
    if (!dragHandle && !draggedWidget) return;

    if (draggedWidget) {
      draggedWidget.classList.remove('widget-dragging');
    }

    // Clean up
    document.querySelectorAll('.widget-column').forEach(col => {
      col.classList.remove('widget-column--drop-zone');
      col.classList.remove('widget-column--drag-over');
    });
    document.querySelectorAll('.widget.widget-drag-over').forEach(w => {
      w.classList.remove('widget-drag-over');
    });

    draggedWidget = null;
    draggedWidgetId = null;
    sourceColumn = null;
  });

  // Dragover for widgets
  app.addEventListener('dragover', e => {
    if (!draggedWidget) return;

    const column = e.target.closest('.widget-column');
    const targetWidget = e.target.closest('.widget:not(.widget-dragging)');

    if (column || targetWidget) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Highlight target
      document.querySelectorAll('.widget-column--drag-over').forEach(c => c.classList.remove('widget-column--drag-over'));
      document.querySelectorAll('.widget.widget-drag-over').forEach(w => w.classList.remove('widget-drag-over'));

      if (targetWidget) {
        targetWidget.classList.add('widget-drag-over');
      } else if (column) {
        column.classList.add('widget-column--drag-over');
      }
    }
  });

  // Drop for widgets
  app.addEventListener('drop', e => {
    if (!draggedWidget || !draggedWidgetId) return;

    const column = e.target.closest('.widget-column');
    const targetWidget = e.target.closest('.widget:not(.widget-dragging)');

    if (!column) return;

    e.preventDefault();

    const trailId = state.selectedTrailId;
    if (!trailId) return;

    const layout = getWidgetLayout(trailId);
    const targetColIndex = parseInt(column.dataset.column);
    const targetColKey = `column${targetColIndex}`;
    const sourceColKey = sourceColumn ? `column${sourceColumn.dataset.column}` : null;

    // Remove widget from source
    if (sourceColKey && layout[sourceColKey]) {
      layout[sourceColKey] = layout[sourceColKey].filter(w => w !== draggedWidgetId);
    }

    // Determine insert position
    let insertIndex = layout[targetColKey].length; // Default: end of column

    if (targetWidget) {
      const targetWidgetId = targetWidget.dataset.widget;
      const targetIndex = layout[targetColKey].indexOf(targetWidgetId);
      if (targetIndex !== -1) {
        // Insert before target widget
        insertIndex = targetIndex;
      }
    }

    // Insert at position
    layout[targetColKey].splice(insertIndex, 0, draggedWidgetId);

    // Save layout
    setWidgetLayout(trailId, layout);

    // Re-render dashboard
    const userTrail = state.userTrails.find(t => t.id === trailId);
    if (userTrail && state.currentTrailData) {
      renderTrailDashboard(userTrail, state.currentTrailData);
    }
  });

  app.addEventListener("change", e => {
    // Date input - handle change event (but not on mobile, we use blur there)
    if (e.target.classList.contains("startDateInput") && e.target.tagName === "INPUT") {
      const isMobile = window.innerWidth <= 1024 || /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);

      if (!isMobile) {
        const newDate = e.target.value || null;
        if (newDate !== state.startDate) {
          state.startDate = newDate;
          savePreferences();
          renderFullDetail();
        }
      }
      return;
    }

    // Stage range selectors for official mode
    if (e.target.classList.contains("startStageSelect")) {
      const v = e.target.value;
      state.startStage = v === "" ? null : parseInt(v, 10);
      renderFullDetail();
      return;
    }

    if (e.target.classList.contains("endStageSelect")) {
      const v = e.target.value;
      state.endStage = v === "" ? null : parseInt(v, 10);
      renderFullDetail();
      return;
    }

    // Trail Picker Filters
    if (e.target.id === 'filterCountry' || e.target.id === 'filterDistance' || e.target.id === 'filterSeason') {
      applyTrailPickerFilters();
      return;
    }
  });

  app.addEventListener("input", e => {
    if (e.target.classList.contains("targetInput") && e.target.tagName === "INPUT") {
      debouncedUpdateTarget();
    }

    if (e.target.classList.contains("startDateInput") && e.target.tagName === "INPUT") {
      // On desktop, update immediately on input
      const isMobile = window.innerWidth <= 1024 || /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);

      if (!isMobile) {
        const newDate = e.target.value || null;
        if (newDate !== state.startDate) {
          state.startDate = newDate;
          savePreferences();
          renderFullDetail();
        }
      }
      // On mobile/tablet, we use blur event instead (see below)
    }

    // Km range inputs for custom mode - only update state while typing
    if ((e.target.classList.contains("startKmInput") || e.target.classList.contains("endKmInput")) && e.target.tagName === "INPUT") {
      debouncedUpdateKm();
    }

    // POI distance slider
    if (e.target.classList.contains("poiDistanceSlider")) {
      const newDistance = parseFloat(e.target.value);
      state.maxPoiDistanceKm = newDistance;
      savePreferences(); // Save preference

      // Update the display value
      const valueDisplay = document.querySelector('.poiDistanceValue');
      if (valueDisplay) {
        valueDisplay.textContent = `${newDistance} km`;
      }

      // Re-render POI markers with new distance filter
      const direction = state.isReversed ? 'rev' : 'fwd';
      const cacheKey = `${state.currentTrailUrl}_${direction}`;
      const gpxProfile = state.gpxCache.get(cacheKey);

      if (gpxProfile && state.map) {
        console.log('Updating POI markers with distance:', newDistance, 'km');
        updateMapForStage(gpxProfile, null, true); // preserveView = true
      }
    }
  });

  // Re-render when user finishes editing km inputs (blur event)
  app.addEventListener("blur", e => {
    // Date input - on mobile/tablet, only save on blur (after picker closes)
    if (e.target.classList.contains("startDateInput") && e.target.tagName === "INPUT") {
      const isMobile = window.innerWidth <= 1024 || /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);

      if (isMobile) {
        const newDate = e.target.value || null;
        if (newDate !== state.startDate) {
          state.startDate = newDate;
          savePreferences();
          renderFullDetail();
        }
      }
      return;
    }

    if (e.target.classList.contains("targetInput") && e.target.tagName === "INPUT") {
      // User finished editing target - re-render to recalculate stages
      renderFullDetail();
      return;
    }

    if ((e.target.classList.contains("startKmInput") || e.target.classList.contains("endKmInput")) && e.target.tagName === "INPUT") {
      // Validate and constrain km inputs to trail length
      const direction = state.isReversed ? 'rev' : 'fwd';
      const cacheKey = `${state.currentTrailUrl}_${direction}`;
      const gpxProfile = state.gpxCache.get(cacheKey);

      if (gpxProfile?.totalKm) {
        const maxKm = gpxProfile.totalKm;

        // Constrain and round startKm
        if (state.startKm !== null) {
          if (state.startKm < 0) state.startKm = 0;
          if (state.startKm > maxKm) state.startKm = maxKm;
          // Round to 1 decimal
          state.startKm = Math.round(state.startKm * 10) / 10;
        }

        // Constrain and round endKm
        if (state.endKm !== null) {
          if (state.endKm < 0) state.endKm = 0;
          if (state.endKm > maxKm) state.endKm = maxKm;
          // Round to 1 decimal
          state.endKm = Math.round(state.endKm * 10) / 10;
        }

        // Ensure start < end
        if (state.startKm !== null && state.endKm !== null && state.startKm >= state.endKm) {
          // Swap if needed
          const tmp = state.startKm;
          state.startKm = state.endKm;
          state.endKm = tmp;
        }

        // Update the input field values with corrected/rounded values
        if (e.target.classList.contains("startKmInput") && state.startKm !== null) {
          e.target.value = state.startKm;
        }
        if (e.target.classList.contains("endKmInput") && state.endKm !== null) {
          e.target.value = state.endKm;
        }
      }

      // User finished editing - now re-render to recalculate stages
      renderFullDetail();
    }
  }, true); // Use capture phase to catch blur events

  // Document-level input handlers for modal elements
  document.addEventListener("input", e => {
    // Endpoint distance slider (in modal)
    if (e.target.classList.contains("endpointDistanceSlider")) {
      const newDistance = parseFloat(e.target.value);
      state.maxPoiDistanceKm = newDistance;

      // Update display value
      const valueDisplay = document.querySelector('.endpointDistanceValue');
      if (valueDisplay) {
        valueDisplay.textContent = `${newDistance} km`;
      }

      // Re-check POI availability with new distance
      if (state.editingStageIndex !== null) {
        // Just update the button states, don't re-render the whole modal
        const stage = state.currentStages[state.editingStageIndex];
        if (stage && stage.type === 'custom') {
          const direction = state.isReversed ? 'rev' : 'fwd';
          const cacheKey = `${state.currentTrailUrl}_${direction}`;
          const gpxProfile = state.gpxCache.get(cacheKey);

          if (gpxProfile) {
            const poiTypes = ['camping', 'hotel', 'station'];
            const modal = document.getElementById('endpointModal');

            poiTypes.forEach(type => {
              const btn = modal.querySelector(`.endpointOption[data-type="${type}"]`);
              if (btn) {
                const available = findNearestPOI(stage.rangeEndKm, type, gpxProfile);
                if (!available) {
                  btn.classList.add('disabled');
                  btn.style.opacity = '0.4';
                  btn.style.cursor = 'not-allowed';
                } else {
                  btn.classList.remove('disabled');
                  btn.style.opacity = '1';
                  btn.style.cursor = 'pointer';
                }
              }
            });
          }
        }
      }
      return;
    }
  });

  document.addEventListener("change", e => {
    // (kept for backwards compatibility if needed)
  });

  // Modal event handlers (using document instead of app)
  document.addEventListener("click", e => {
    // Fullscreen toggle - use CSS fullscreen instead of API (better iOS support)
    if (e.target.id === "fullscreenBtn" || e.target.closest("#fullscreenBtn")) {
      const mapContainer = document.getElementById("mapWithControls");
      const btn = document.getElementById("fullscreenBtn");

      const isFullscreen = mapContainer.classList.contains('is-fullscreen');

      if (!isFullscreen) {
        // Enter fullscreen (CSS-based)
        mapContainer.classList.add('is-fullscreen');
        document.body.classList.add('has-fullscreen-map');
        if (btn) btn.textContent = "✕"; // Close icon

        // Invalidate map size after entering fullscreen
        setTimeout(() => {
          if (state.map) state.map.invalidateSize();
        }, 100);

      } else {
        // Exit fullscreen
        mapContainer.classList.remove('is-fullscreen');
        document.body.classList.remove('has-fullscreen-map');
        if (btn) btn.textContent = "⛶"; // Fullscreen icon

        // Invalidate map size after exiting fullscreen
        setTimeout(() => {
          if (state.map) state.map.invalidateSize();
        }, 100);
      }
      return;
    }

    // "End stage here" button in POI popup
    if (e.target.closest(".endStageHereBtn")) {
      const btn = e.target.closest(".endStageHereBtn");
      const stageIdx = parseInt(btn.dataset.stageIdx, 10);
      const poiLat = parseFloat(btn.dataset.poiLat);
      const poiLon = parseFloat(btn.dataset.poiLon);
      const poiType = btn.dataset.poiType;
      const poiName = btn.dataset.poiName;

      console.log('🏁 End stage here clicked:', { stageIdx, poiType, poiName });

      if (!isNaN(stageIdx) && !isNaN(poiLat) && !isNaN(poiLon)) {
        adjustStageEndpointToPOI(stageIdx, poiLat, poiLon, poiType, poiName);
      }
      return;
    }

    // "Add to route" button in POI popup
    if (e.target.closest(".addToRouteBtn")) {
      const btn = e.target.closest(".addToRouteBtn");
      const stageIdx = parseInt(btn.dataset.stageIdx, 10);
      const poiLat = parseFloat(btn.dataset.poiLat);
      const poiLon = parseFloat(btn.dataset.poiLon);
      const poiType = btn.dataset.poiType;
      const poiName = btn.dataset.poiName;
      const poiKm = parseFloat(btn.dataset.poiKm) || 0;

      console.log('➕ Add to route clicked:', { stageIdx, poiType, poiName, poiKm });

      if (!isNaN(stageIdx) && !isNaN(poiLat) && !isNaN(poiLon)) {
        addStopToRoute(stageIdx, poiLat, poiLon, poiType, poiName, poiKm);
      }
      return;
    }

    // "Remove from route" button in POI popup
    if (e.target.closest(".removeFromRouteBtn")) {
      const btn = e.target.closest(".removeFromRouteBtn");
      const stageIdx = parseInt(btn.dataset.stageIdx, 10);
      const poiLat = parseFloat(btn.dataset.poiLat);
      const poiLon = parseFloat(btn.dataset.poiLon);

      console.log('✕ Remove from route clicked:', { stageIdx, poiLat, poiLon });

      if (!isNaN(stageIdx) && !isNaN(poiLat) && !isNaN(poiLon)) {
        removeStopFromRoute(stageIdx, poiLat, poiLon);
      }
      return;
    }

    // "Clear all route stops" button
    if (e.target.closest(".clearRouteStopsBtn")) {
      const btn = e.target.closest(".clearRouteStopsBtn");
      const stageIdx = parseInt(btn.dataset.stageIdx, 10);

      console.log('🗑️ Clear all route stops clicked for stage:', stageIdx);

      if (!isNaN(stageIdx)) {
        clearAllRouteStops(stageIdx);
      }
      return;
    }

    // Endpoint option selection (POI types or map)
    if (e.target.closest(".endpointOption")) {
      const btn = e.target.closest(".endpointOption");

      // Ignore disabled buttons
      if (btn.classList.contains('disabled')) {
        return;
      }

      const type = btn.dataset.type;
      console.log('Endpoint option clicked:', type, 'editing stage:', state.editingStageIndex);
      if (state.editingStageIndex !== null) {
        adjustStageEndpoint(state.editingStageIndex, type);
      }
      return;
    }

    // Close buttons
    if (e.target.closest(".mapModalClose")) {
      // Check if we're in stage editing mode
      if (state.editingStageIndex !== null) {
        closeStageMapModal();
      } else {
        closeMapModal();
      }
      return;
    }

    if (e.target.closest(".endpointModalClose")) {
      closeEndpointModal();
      return;
    }

    // Confirm selection button
    if (e.target.closest(".confirmSelectionBtn")) {
      confirmMapSelection();
      return;
    }

    // Reset selection button
    if (e.target.closest(".resetSelectionBtn")) {
      resetMapSelection();
      return;
    }

    // Click outside modal content (on overlay)
    if (e.target.classList.contains("mapModalOverlay")) {
      // Check if we're in stage editing mode
      if (state.editingStageIndex !== null) {
        closeStageMapModal();
      } else {
        closeMapModal();
      }
      return;
    }

    if (e.target.classList.contains("endpointModalOverlay")) {
      closeEndpointModal();
      return;
    }
  });

  // ESC key to close modals
  document.addEventListener("keydown", e => {
    // Debug mode toggle: Ctrl+Shift+D
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      state.debugMode = !state.debugMode;
      savePreferences();
      const message = state.debugMode ? '🐛 Debug mode ENABLED' : '✅ Debug mode DISABLED';
      console.log(`%c${message}`, 'font-size: 16px; font-weight: bold; color: ' + (state.debugMode ? '#e74c3c' : '#2ecc71'));
      return;
    }

    // Enter key on km inputs to trigger re-render
    if (e.key === 'Enter' && (e.target.classList.contains("startKmInput") || e.target.classList.contains("endKmInput") || e.target.classList.contains("targetInput"))) {
      e.target.blur(); // This will trigger the blur event handler which re-renders
      return;
    }

    if (e.key === "Escape") {
      const mapModal = document.getElementById('mapModal');
      if (mapModal && mapModal.style.display === 'flex') {
        // Check if we're in stage editing mode
        if (state.editingStageIndex !== null) {
          closeStageMapModal();
        } else {
          closeMapModal();
        }
        return;
      }

      const endpointModal = document.getElementById('endpointModal');
      if (endpointModal && endpointModal.style.display === 'flex') {
        closeEndpointModal();
        return;
      }
    }
  });
}

// --------------------
// BOOT
// --------------------
(async function boot() {
  // Load saved preferences
  loadPreferences();

  // Initialize theme - ADDED BY CLAUDE
  ThemeManager.init();

  try {
    const trails = await loadTrailsIndex();
    state.trailsIndex = trails;

    // Migrate: load images for userTrails that don't have one
    for (const ut of state.userTrails) {
      if (!ut.image) {
        try {
          const trailData = await loadJson(ut.jsonUrl);
          if (trailData.image) {
            ut.image = trailData.image;
          }
        } catch (e) {
          console.warn('Could not load trail data for image:', ut.jsonUrl);
        }
      }
    }
    savePreferences();

    installEvents();
    renderApp(trails);
  } catch (err) {
    console.warn("Boot failed:", err);
    app.innerHTML = `
      <div class="wrap">
        <header class="top">
          <h1>Hike5 Trail Companion</h1>
        </header>
        <section class="card">
          ${renderErrorCard("Boot error", err, "Controleer /data/trails/index.json en je deploy.")}
        </section>
      </div>
    `;
  }
})()