import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icons disappearing in React-Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

export default function MapView({ lat, lon, city, country, isp }) {
  if (!lat || !lon) return null;

  return (
    <div className="h-64 w-full mt-4 border border-slate-700 rounded-lg overflow-hidden relative z-0">
      <MapContainer center={[lat, lon]} zoom={10} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CartoDB</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <Marker position={[lat, lon]}>
          <Popup className="text-slate-900">
            <strong>{city}, {country}</strong><br />
            ISP: {isp}
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}