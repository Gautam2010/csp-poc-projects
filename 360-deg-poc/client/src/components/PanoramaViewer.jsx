import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { angleDiff, sceneYawToWorld, worldToSceneYaw } from '../lib/geo';

const LANDING_PITCH = 0; // level view after navigating
const SNAP_ZONE_DEG = 55; // how far the cursor can be from a target bearing
                           // and still have the nav arrow snap onto it
const DRAG_THRESHOLD_PX = 6; // movement beyond this counts as a drag, not a tap

// Imperative Pannellum wrapper: ported from the original vanilla-JS POC with
// no logic changes, just restructured around React's lifecycle. Exposes
// `goToIndex(index, opts)` via ref so the map/property-click UI can drive
// navigation, and calls `onIndexChange` whenever a navigation is actually
// applied so the rest of the app (map highlighting) can follow along.
const PanoramaViewer = forwardRef(function PanoramaViewer(
  { frames, forwardBearing, backwardBearing, onIndexChange },
  ref,
) {
  const containerRef = useRef(null);
  const panoRef = useRef(null);
  const navArrowRef = useRef(null);
  const navArrowGlyphRef = useRef(null);
  const psvRef = useRef(null);

  // Mutable navigation state lives in a ref, not React state: it's read and
  // written from event handlers and Pannellum callbacks far more often than
  // it should ever trigger a re-render (React state for it would also race
  // with goToIndex's own closures across renders).
  const stateRef = useRef({
    currentIndex: 0,
    viewerReady: false,
    transitioning: false, // a scene fade is currently in progress
    pendingNavigation: null,
  });

  function currentView(frame) {
    try {
      const pitch = psvRef.current.getPitch();
      const worldYaw = sceneYawToWorld(frame, psvRef.current.getYaw());
      const hfov = psvRef.current.getHfov();
      return [pitch, worldYaw, hfov];
    } catch (err) {
      return [0, 0, 100];
    }
  }

  function flushPendingNavigation() {
    const s = stateRef.current;
    if (s.pendingNavigation) {
      const { index, opts } = s.pendingNavigation;
      s.pendingNavigation = null;
      goToIndex(index, opts);
    }
  }

  function goToIndex(index, opts = {}) {
    const s = stateRef.current;
    const psv = psvRef.current;

    if (!psv || !s.viewerReady || s.transitioning) {
      // Either the viewer's initial panorama hasn't finished loading yet
      // (loadScene() is ignored until then), or a previous scene-fade
      // transition is still playing (overlapping loadScene() calls can land
      // mid-transition at the wrong end state). Defer this whole call so
      // nothing gets out of sync with whichever navigation actually ends
      // up applied.
      s.pendingNavigation = { index, opts };
      return;
    }

    const fromFrame = frames[s.currentIndex];
    const [pitch, worldYaw, hfov] = currentView(fromFrame);

    s.currentIndex = (index + frames.length) % frames.length;
    const f = frames[s.currentIndex];

    const targetPitch = opts.targetPitch !== undefined ? opts.targetPitch : pitch;
    const targetWorldYaw = opts.targetYaw !== undefined ? opts.targetYaw : worldYaw;
    const targetYaw = worldToSceneYaw(f, targetWorldYaw);

    s.transitioning = true;
    psv.loadScene(`frame${s.currentIndex}`, targetPitch, targetYaw, hfov);

    onIndexChange?.(s.currentIndex);
  }

  useImperativeHandle(ref, () => ({ goToIndex }));

  // Pointer-driven "ground arrow" that snaps toward the next/previous
  // frame's real bearing - see geo.js for how forwardBearing/backwardBearing
  // are computed. Pointer Events + setPointerCapture (rather than separate
  // mouse/touch handlers plus a window-level mouseup) guarantee the release
  // for a drag started on #pano is reported back to #pano even if it ends
  // up outside the element, so dragging to look around never gets
  // misinterpreted as a tap, and a click starting elsewhere (e.g. the map)
  // can never reach this handler at all.
  function setupNavArrow() {
    const pano = panoRef.current;
    const navArrow = navArrowRef.current;
    const navArrowGlyph = navArrowGlyphRef.current;
    const psv = psvRef.current;
    let activeDirection = null;
    let pointerDown = false;
    let dragged = false;
    let startX = 0;
    let startY = 0;

    function hide() {
      activeDirection = null;
      navArrow.style.display = 'none';
    }

    function updateArrow(clientX, clientY) {
      let coords;
      try {
        coords = psv.mouseEventToCoords({ clientX, clientY });
      } catch (err) {
        return;
      }
      const s = stateRef.current;
      const worldYaw = sceneYawToWorld(frames[s.currentIndex], coords[1]);

      const fwdDiff = Math.abs(angleDiff(worldYaw, forwardBearing[s.currentIndex]));
      const backDiff = Math.abs(angleDiff(worldYaw, backwardBearing[s.currentIndex]));

      let direction = null;
      if (fwdDiff <= backDiff && fwdDiff < SNAP_ZONE_DEG) direction = 'forward';
      else if (backDiff < SNAP_ZONE_DEG) direction = 'backward';

      if (!direction) {
        hide();
        return;
      }

      activeDirection = direction;
      const rect = pano.getBoundingClientRect();
      navArrow.style.left = `${clientX - rect.left}px`;
      navArrow.style.top = `${clientY - rect.top}px`;
      navArrow.style.display = 'block';
      navArrowGlyph.className = `nav-arrow ${direction}`;

      const diff = direction === 'forward' ? fwdDiff : backDiff;
      const snapAmount = 1 - diff / SNAP_ZONE_DEG;
      navArrowGlyph.style.opacity = String(0.6 + 0.4 * snapAmount);
    }

    function navigate() {
      if (!activeDirection) return;
      const s = stateRef.current;
      const n = frames.length;
      if (activeDirection === 'forward') {
        const next = (s.currentIndex + 1) % n;
        goToIndex(next, { targetYaw: forwardBearing[next], targetPitch: LANDING_PITCH });
      } else {
        const prev = (s.currentIndex - 1 + n) % n;
        goToIndex(prev, { targetYaw: backwardBearing[prev], targetPitch: LANDING_PITCH });
      }
      hide();
    }

    function onPointerDown(e) {
      pointerDown = true;
      dragged = false;
      startX = e.clientX;
      startY = e.clientY;
      try {
        pano.setPointerCapture(e.pointerId);
      } catch (err) {
        // best-effort guarantee, not required to work
      }
    }
    function onPointerMove(e) {
      if (!pointerDown) {
        updateArrow(e.clientX, e.clientY); // hover preview
        return;
      }
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_THRESHOLD_PX) dragged = true;
    }
    function onPointerUp(e) {
      const wasDown = pointerDown;
      const wasDrag = dragged;
      pointerDown = false;
      dragged = false;
      if (wasDown && !wasDrag) {
        updateArrow(e.clientX, e.clientY);
        navigate();
      }
    }
    function onPointerCancel() {
      pointerDown = false;
      dragged = false;
    }
    function onPointerLeave() {
      if (!pointerDown) hide();
    }

    pano.addEventListener('pointerdown', onPointerDown);
    pano.addEventListener('pointermove', onPointerMove);
    pano.addEventListener('pointerup', onPointerUp);
    pano.addEventListener('pointercancel', onPointerCancel);
    pano.addEventListener('pointerleave', onPointerLeave);

    return () => {
      pano.removeEventListener('pointerdown', onPointerDown);
      pano.removeEventListener('pointermove', onPointerMove);
      pano.removeEventListener('pointerup', onPointerUp);
      pano.removeEventListener('pointercancel', onPointerCancel);
      pano.removeEventListener('pointerleave', onPointerLeave);
    };
  }

  useEffect(() => {
    if (!frames.length || !window.pannellum) return undefined;

    const scenes = {};
    frames.forEach((f, i) => {
      scenes[`frame${i}`] = { type: 'equirectangular', panorama: f.src };
    });

    const psv = window.pannellum.viewer(containerRef.current, {
      default: { firstScene: 'frame0' },
      scenes,
      autoLoad: true,
      showZoomCtrl: true,
      showFullscreenCtrl: true,
      compass: false,
      sceneFadeDuration: 800,
    });
    psvRef.current = psv;

    // loadScene() silently does nothing until the viewer's initial panorama
    // has finished loading - queue anything requested before that.
    psv.on('load', () => {
      stateRef.current.viewerReady = true;
      flushPendingNavigation();
    });
    psv.on('scenechange', () => {
      stateRef.current.transitioning = false;
      flushPendingNavigation();
    });

    const cleanupNavArrow = setupNavArrow();

    function onKeyDown(e) {
      const s = stateRef.current;
      const n = frames.length;
      if (e.key === 'ArrowRight') {
        const next = (s.currentIndex + 1) % n;
        goToIndex(next, { targetYaw: forwardBearing[next], targetPitch: LANDING_PITCH });
      } else if (e.key === 'ArrowLeft') {
        const prev = (s.currentIndex - 1 + n) % n;
        goToIndex(prev, { targetYaw: backwardBearing[prev], targetPitch: LANDING_PITCH });
      }
    }
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      cleanupNavArrow();
      psv.destroy();
      psvRef.current = null;
    };
    // Intentionally only re-initializes if the frame list itself changes
    // (e.g. after the initial API fetch resolves), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames]);

  return (
    <div className="pano" ref={panoRef}>
      <div className="pano-viewer" ref={containerRef} />
      <div className="nav-hotspot" ref={navArrowRef}>
        <div className="nav-arrow forward" ref={navArrowGlyphRef} />
      </div>
    </div>
  );
});

export default PanoramaViewer;
