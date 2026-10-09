import exifr from 'exifr';

const validPoint = (latitude, longitude) => Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;

export async function imageGps(bytes) {
  try {
    const { latitude, longitude } = await exifr.gps(Buffer.from(bytes));
    return validPoint(latitude, longitude) ? { lat: latitude, lng: longitude, source: 'image metadata' } : null;
  } catch {
    return null;
  }
}

export function videoMetadata(bytes) {
  // ponytail: read QuickTime ISO-6709 and mvhd only; add a media parser if other containers become required.
  const buffer = Buffer.from(bytes);
  const text = buffer.toString('latin1');
  const location = text.match(/([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)([+-]\d+(?:\.\d+)?\/)/);
  let gps = null;
  if (location) {
    const lat = Number(location[1]);
    const lng = Number(location[2]);
    if (validPoint(lat, lng)) gps = { lat, lng, source: 'video metadata' };
  }

  let durationSeconds = null;
  const marker = buffer.indexOf(Buffer.from('mvhd'));
  if (marker >= 0 && marker + 36 <= buffer.length) {
    const version = buffer[marker + 4];
    const timescaleOffset = marker + (version === 1 ? 24 : 16);
    const durationOffset = marker + (version === 1 ? 28 : 20);
    const timescale = buffer.readUInt32BE(timescaleOffset);
    const duration = version === 1 ? Number(buffer.readBigUInt64BE(durationOffset)) : buffer.readUInt32BE(durationOffset);
    if (timescale > 0 && Number.isFinite(duration)) durationSeconds = duration / timescale;
  }
  return { gps, durationSeconds };
}
