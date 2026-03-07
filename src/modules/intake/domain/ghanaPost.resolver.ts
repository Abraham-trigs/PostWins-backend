export async function resolveGhanaPostAddress(digitalAddress: string): Promise<{
  digitalAddress: string;
  lat: number;
  lng: number;
  bounds: [[number, number], [number, number]];
}> {
  if (!/^[A-Z]{2}-\d{3}-\d{4}$/i.test(digitalAddress)) {
    throw new Error("INVALID_ADDRESS");
  }

  const apiKey = process.env.GHANAPOST_API_KEY;
  const apiUrl = process.env.GHANAPOST_API_URL;

  if (!apiKey || !apiUrl) {
    throw new Error("GHANAPOST_CONFIG_MISSING");
  }

  const url = `${apiUrl}?digitalAddress=${encodeURIComponent(digitalAddress)}`;

  const res = await fetch(url, {
    headers: {
      "X-API-KEY": apiKey,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error("GHANAPOST_NOT_FOUND");
  }

  const data: unknown = await res.json();

  if (typeof data !== "object" || data === null || !("Table" in data)) {
    throw new Error("GHANAPOST_NOT_FOUND");
  }

  const record = (data as any)?.Table?.[0];

  if (!record) {
    throw new Error("GHANAPOST_NOT_FOUND");
  }

  const lat = Number(record.Latitude);
  const lng = Number(record.Longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("GHANAPOST_NOT_FOUND");
  }

  const delta = 0.0005;

  return {
    digitalAddress,
    lat,
    lng,
    bounds: [
      [lat - delta, lng - delta],
      [lat + delta, lng + delta],
    ],
  };
}
