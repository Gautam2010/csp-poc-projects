import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');
const DESCRIPTION_PATH = path.join(OUTPUT_DIR, 'mapillary_image_description.json');
const PROPERTIES_PATH = path.join(__dirname, 'data', 'properties.json');

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());

// Equirectangular frame images, served as /media/<video folder>/<frame>.jpg
app.use('/media', express.static(OUTPUT_DIR));

// Mapillary_tools writes one description entry per image, with its capture
// time, GPS position, and compass heading. This reshapes that into exactly
// what the viewer needs: a sorted, de-duplicated frame list with web-servable
// image paths instead of the absolute filesystem paths mapillary_tools wrote.
function loadFrames() {
  const entries = JSON.parse(fs.readFileSync(DESCRIPTION_PATH, 'utf-8'));

  const frames = entries
    .filter((e) => e.filetype === 'image')
    .map((e) => {
      const parentDir = path.basename(path.dirname(e.filename));
      return {
        file: e.MAPFilename,
        src: `/media/${parentDir}/${e.MAPFilename}`,
        lat: e.MAPLatitude,
        lon: e.MAPLongitude,
        altitude: e.MAPAltitude,
        heading: e.MAPCompassHeading.TrueHeading,
        time: e.MAPCaptureTime,
        sequence: e.MAPSequenceUUID,
      };
    });

  frames.sort((a, b) => a.time.localeCompare(b.time));
  return frames;
}

app.get('/api/frames', (req, res) => {
  try {
    res.json(loadFrames());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not read frame data. Has mapillary_tools been run yet?' });
  }
});

app.get('/api/properties', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(PROPERTIES_PATH, 'utf-8')));
  } catch (err) {
    res.json([]); // properties are optional
  }
});

app.listen(PORT, () => {
  console.log(`Street view API listening on http://localhost:${PORT}`);
});
