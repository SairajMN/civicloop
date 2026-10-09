import wardData from './data/gba-wards.json' with { type: 'json' };

function ringContains(ring, firstCoordinate, secondCoordinate) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > secondCoordinate) !== (yj > secondCoordinate) && firstCoordinate < (xj - xi) * (secondCoordinate - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonContains(rings, firstCoordinate, secondCoordinate) {
  return ringContains(rings[0] || [], firstCoordinate, secondCoordinate) && !rings.slice(1).some((ring) => ringContains(ring, firstCoordinate, secondCoordinate));
}

function geometryContains(geometry, firstCoordinate, secondCoordinate) {
  if (geometry.type === 'Polygon') return polygonContains(geometry.coordinates, firstCoordinate, secondCoordinate);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((polygon) => polygonContains(polygon, firstCoordinate, secondCoordinate));
  if (geometry.type === 'GeometryCollection') return geometry.geometries.some((item) => geometryContains(item, firstCoordinate, secondCoordinate));
  return false;
}

export function findBengaluruWard(latitude, longitude) {
  // The GBA GeoJSON source stores latitude before longitude; preserve its source order here.
  const feature = wardData.features.find(({ geometry }) => geometryContains(geometry, latitude, longitude));
  if (!feature) return null;
  const { Corporation, corporation_id: corporationId, ward_id: number, ward_name: name } = feature.properties;
  return { number, name, corporation: `Bengaluru ${Corporation} City Corporation`, corporationId };
}
