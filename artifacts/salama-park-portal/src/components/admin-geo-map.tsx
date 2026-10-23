import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polygon } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useGetAdminGeoStreetStats } from '@workspace/api-client-react';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

/** Approximate centre of Salama Park, Avondale, Lusaka. */
const SALAMA_CENTER: [number, number] = [-15.3939986, 28.3896533];
const SALAMA_BOUNDARY: [number, number][] = [
  [-15.4040027, 28.3836026],
  [-15.4040027, 28.3946927],
  [-15.3829609, 28.3946927],
  [-15.3829609, 28.3836026],
];

/**
 * Spread markers that have no real coordinates around the neighbourhood centre.
 *
 * Street coordinates are not collected yet, so every marker would otherwise sit
 * on the same point. A deterministic spiral keeps them readable and, unlike a
 * random offset, does not move the markers each time the data is refetched.
 * These positions are placeholders, not surveyed locations — the caption says so.
 */
function placeholderPosition(index: number): [number, number] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const angle = index * goldenAngle;
  const radius = 0.0016 + Math.min(index, 24) * 0.00018;
  return [
    SALAMA_CENTER[0] + Math.sin(angle) * radius,
    SALAMA_CENTER[1] + Math.cos(angle) * radius,
  ];
}

function radiusFor(count: number, max: number): number {
  if (max <= 0) return 8;
  return 8 + (Math.sqrt(count) / Math.sqrt(max)) * 18;
}

export function AdminGeoMap() {
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const stats = useGetAdminGeoStreetStats(
    verifiedOnly ? { verifiedOnly: 'true' } : { includeAll: 'true' },
    { query: { queryKey: ['admin-geo-street-stats', verifiedOnly ? 'verified' : 'all'] } },
  );

  const streets = useMemo(() => {
    const list = stats.data?.streets ?? [];
    // Largest area first: the spiral then grows outward predictably.
    return [...list].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [stats.data]);

  const maxCount = useMemo(() => Math.max(1, ...streets.map((s) => s.count)), [streets]);
  const total = useMemo(() => streets.reduce((sum, s) => sum + s.count, 0), [streets]);
  const anyApproximate = streets.some((s) => s.lat === null || s.lng === null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e1dfd8] bg-white p-5">
        <div>
          <h2 className="font-semibold text-[#1c2e44]">Population spread by area</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#687486]">
            Street-level counts for {verifiedOnly ? 'verified applications' : 'all non-rejected applications'}.
            Only area totals are shown — no names, house numbers or individual addresses.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2 text-[#47566a]">
            <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />
            Verified only
          </label>
          <div className="rounded-lg bg-[#f1f5ef] px-3 py-1.5 text-[#315f43]">
            {streets.length} area{streets.length === 1 ? '' : 's'} · {total} member{total === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {stats.isError && (
        <div className="rounded-xl border border-[#e8caca] bg-[#fcf1ef] px-4 py-3 text-sm text-[#8a3737]">
          The area totals could not be loaded.{' '}
          <button onClick={() => stats.refetch()} className="font-semibold underline">Try again</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="overflow-hidden rounded-2xl border border-[#e1dfd8] bg-white">
          <MapContainer center={SALAMA_CENTER} zoom={15} className="h-[520px] w-full" scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png"
              subdomains={['a', 'b', 'c']}
            />
            <Polygon
              positions={SALAMA_BOUNDARY}
              pathOptions={{ color: '#315f43', weight: 2, fillColor: '#6a9c71', fillOpacity: 0.08 }}
            />
            {streets.map((street, index) => {
              const position: [number, number] =
                street.lat !== null && street.lng !== null
                  ? [street.lat, street.lng]
                  : placeholderPosition(index);
              return (
                <CircleMarker
                  key={street.key}
                  center={position}
                  radius={radiusFor(street.count, maxCount)}
                  pathOptions={{ color: '#315f43', fillColor: '#315f43', fillOpacity: 0.7 }}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-semibold">{street.label}</div>
                      <div>{street.count} {verifiedOnly ? 'verified' : 'application(s)'}</div>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>

        <div className="rounded-2xl border border-[#e1dfd8] bg-white p-5">
          <h3 className="text-sm font-semibold text-[#1c2e44]">Areas</h3>
          {stats.isLoading ? (
            <p className="mt-3 text-sm text-[#687486]">Loading…</p>
          ) : streets.length === 0 ? (
            <p className="mt-3 text-sm leading-6 text-[#687486]">
              No applications carry a street or zone yet, so there is nothing to map.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {streets.map((street) => (
                <div key={street.key}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-[#33445a]" title={street.label}>{street.label}</span>
                    <span className="shrink-0 text-[#687486]">{street.count}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#eceee9]">
                    <div
                      className="h-full rounded-full bg-[#315f43]"
                      style={{ width: `${Math.max(6, (street.count / maxCount) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {anyApproximate && streets.length > 0 && (
        <p className="text-xs leading-5 text-[#87918e]">
          Marker positions are approximate. Exact street coordinates have not been captured yet, so areas are
          arranged around the neighbourhood centre. The counts themselves are exact and come from the register.
        </p>
      )}
    </div>
  );
}
