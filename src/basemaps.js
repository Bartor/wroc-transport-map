// The data layers are the point, so the basemap has to stay quiet and still be
// legible. CARTO's dark styles are near-black (median tile luminance ~9/255),
// which reads as a void behind the data; Esri's Dark Gray Canvas sits around 75
// and is purpose-built for exactly this, with street labels as a separate
// overlay you can switch off.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas'
const ESRI_ATTR = 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ'
const CARTO_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

export const BASEMAPS = {
  darkGray: {
    label: 'Ciemnoszara z nazwami',
    url: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTR, dark: true, maxZoom: 16,
  },
  darkGrayPlain: {
    label: 'Ciemnoszara, bez nazw',
    url: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTR, dark: true, maxZoom: 16,
  },
  lightGray: {
    label: 'Jasnoszara z nazwami',
    url: `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTR, dark: false, maxZoom: 16,
  },
  black: {
    label: 'Czarna (CARTO)',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTR, dark: true, maxZoom: 19,
  },
  osm: {
    label: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    dark: false, maxZoom: 19,
  },
}

export const DEFAULT_BASEMAP = 'darkGray'
