import { useMemo, useRef, useState } from 'react';
import MapView from './components/MapView';
import PanoramaViewer from './components/PanoramaViewer';
import { useApiData } from './hooks/useApiData';
import { computeBearings, nearestFrameForProperty } from './lib/geo';

export default function App() {
  const { data: frames, loading: framesLoading, error: framesError } = useApiData('/api/frames', []);
  const { data: properties } = useApiData('/api/properties', []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const panoramaRef = useRef(null);

  const { forwardBearing, backwardBearing } = useMemo(() => computeBearings(frames), [frames]);

  function handleFrameClick(index) {
    panoramaRef.current?.goToIndex(index);
  }

  function handlePropertyClick(property) {
    const { index, yaw } = nearestFrameForProperty(frames, property);
    panoramaRef.current?.goToIndex(index, { targetYaw: yaw, targetPitch: 0 });
  }

  if (framesError) {
    return <div className="status">Could not load frame data: {framesError.message}</div>;
  }
  if (framesLoading) {
    return <div className="status">Loading...</div>;
  }
  if (!frames.length) {
    return <div className="status">No frames found. Run mapillary_tools first.</div>;
  }

  const current = frames[currentIndex];

  return (
    <div className="app">
      <div className="map-pane">
        <MapView
          frames={frames}
          properties={properties}
          currentIndex={currentIndex}
          onFrameClick={handleFrameClick}
          onPropertyClick={handlePropertyClick}
        />
      </div>
      <div className="pano-pane">
        <PanoramaViewer
          ref={panoramaRef}
          frames={frames}
          forwardBearing={forwardBearing}
          backwardBearing={backwardBearing}
          onIndexChange={setCurrentIndex}
        />
        <div className="info">
          {currentIndex + 1} / {frames.length} | {current.file} | lat {current.lat.toFixed(6)}, lon{' '}
          {current.lon.toFixed(6)} | heading {Math.round(current.heading)}°
        </div>
      </div>
    </div>
  );
}
