import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icons disappearing in React-Leaflet - Vite's asset
// bundling breaks Leaflet's default icon path resolution unless the icon
// URLs are imported and reassigned explicitly like this.
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// React-Leaflet's <MapContainer center> prop only applies on the initial
// mount - it does NOT recenter the map when lat/lon change on a later
// render. Without this, searching a second IP/domain after the first
// still shows the FIRST result's location, since Home.jsx keeps the same
// MapView instance mounted across searches. This uses the imperative
// useMap() handle to explicitly recenter whenever lat/lon change.
//
// It also calls invalidateSize() shortly after mount: Leaflet measures
// its container once on load, and since this map sits inside a CSS grid
// card, that measurement can happen before the grid finishes laying out -
// the classic symptom is a map that renders partially grey until the
// window is resized.
function MapController({ lat, lon, zoom }) {
  const map = useMap();

  useEffect(() => {
    map.setView([lat, lon], zoom);
  }, [lat, lon, zoom, map]);

  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(timer);
  }, [map]);

  return null;
}

export default function MapView({ lat, lon, city, country, isp, zoom = 10 }) {
  const latNum = Number(lat);
  const lonNum = Number(lon);

  // Number.isFinite (rather than the original `!lat || !lon` truthy check)
  // is deliberate: a falsy check treats lat=0 or lon=0 as "missing," but 0
  // is a real, valid coordinate - e.g. anywhere near the Greenwich meridian
  // (lon≈0) or the equator (lat≈0). The one case that genuinely IS
  // "unknown location" is exactly (0,0) together, which ip-api.com and
  // similar geolocation APIs use as their unresolved-location sentinel -
  // so that specific combination is excluded on purpose, but a real 0 in
  // just one field is not.
  const isValidCoordinate =
    Number.isFinite(latNum) && Number.isFinite(lonNum) && !(latNum === 0 && lonNum === 0);

  if (!isValidCoordinate) {
    return (
      <div className="h-64 w-full mt-4 border border-slate-700 rounded-lg flex items-center justify-center text-slate-500 text-sm">
        Location data unavailable for this result.
      </div>
    );
  }

  return (
    <div className="h-64 w-full mt-4 border border-slate-700 rounded-lg overflow-hidden relative z-0">
      {/* relative + z-0 here deliberately creates a new stacking context.
          Leaflet's internal panes use z-index values in the hundreds,
          which without this can bleed through and render on top of
          unrelated fixed/absolute-positioned UI elsewhere on the page
          (dropdowns, modals, sticky headers, etc). */}
      <MapContainer
        center={[latNum, lonNum]}
        zoom={zoom}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CartoDB</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <Marker position={[latNum, lonNum]}>
          <Popup>
            <strong>{city}, {country}</strong><br />
            ISP: {isp || 'Unknown'}
          </Popup>
        </Marker>
        <MapController lat={latNum} lon={lonNum} zoom={zoom} />
      </MapContainer>

      {/* Leaflet popups render outside Tailwind's reach (they're plain DOM
          nodes Leaflet manages itself), so the default white popup clashed
          with the app's dark theme. This themes it to match. */}
      <style>{`
        .leaflet-popup-content-wrapper, .leaflet-popup-tip {
          background: #0f172a;
          color: #e2e8f0;
        }
        .leaflet-popup-content { margin: 10px 12px; font-family: inherit; }
        .leaflet-container a.leaflet-popup-close-button { color: #94a3b8; }
      `}</style>
    </div>
  );
}