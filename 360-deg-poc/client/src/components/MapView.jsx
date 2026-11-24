import { useEffect } from 'react';
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';

// Keeps the map centered on whichever frame is currently showing in the
// panorama, without fighting the user's own pan/zoom (panTo only, no
// setView/zoom reset).
function FollowCurrentFrame({ frame }) {
  const map = useMap();
  useEffect(() => {
    if (frame) map.panTo([frame.lat, frame.lon]);
  }, [map, frame]);
  return null;
}

export default function MapView({ frames, properties, currentIndex, onFrameClick, onPropertyClick }) {
  if (!frames.length) return null;

  const path = frames.map((f) => [f.lat, f.lon]);
  const currentFrame = frames[currentIndex];

  return (
    <MapContainer center={[frames[0].lat, frames[0].lon]} zoom={18} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={20}
        attribution="&copy; OpenStreetMap contributors"
      />

      <Polyline positions={path} pathOptions={{ color: '#2563eb', weight: 3, opacity: 0.6 }} />

      {frames.map((f, i) => (
        <CircleMarker
          key={f.file}
          center={[f.lat, f.lon]}
          radius={6}
          pathOptions={{
            color: 'white',
            weight: 1,
            fillColor: i === currentIndex ? '#ff3b30' : '#2563eb',
            fillOpacity: 1,
          }}
          eventHandlers={{ click: () => onFrameClick(i) }}
        />
      ))}

      {properties.map((p) =>
        p.polygon ? (
          <Polygon
            key={p.id}
            positions={p.polygon}
            pathOptions={{ color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.35 }}
            eventHandlers={{ click: () => onPropertyClick(p) }}
          >
            <Tooltip>{p.name || 'Property'}</Tooltip>
          </Polygon>
        ) : (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={8}
            pathOptions={{ color: 'white', weight: 2, fillColor: '#f59e0b', fillOpacity: 1 }}
            eventHandlers={{ click: () => onPropertyClick(p) }}
          >
            <Tooltip>{p.name || 'Property'}</Tooltip>
          </CircleMarker>
        ),
      )}

      <FollowCurrentFrame frame={currentFrame} />
    </MapContainer>
  );
}
