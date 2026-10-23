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

const SALAMA_CENTER: [number, number] = [-15.3939986, 28.3896533];
const SALAMA_BOUNDARY: [number, number][] = [
  [-15.4040027, 28.3836026],
  [-15.4040027, 28.3946927],
  [-15.3829609, 28.3946927],
  [-15.3829609, 28.3836026],
];

function sizeFor(count: number, max: number): number {
  if (max <= 0) return 8;
  const ratio = Math.sqrt(count) / Math.sqrt(max);
  return 8 + ratio * 18;
}

export function AdminGeoMap() {
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const stats = useGetAdminGeoStreetStats({
    query: { queryKey: ['admin-geo-street-stats', verifiedOnly ? 'verified' : 'all'] },
    ...(verifiedOnly ? { verifiedOnly: 'true' } : { includeAll: 'true' }),
  });

  const streets = stats.data?.streets ?? [];
  const maxCount = useMemo(() => Math.max(1, ...streets.map((s) => s.count)), [streets]);
  const total = useMemo(() => streets.reduce((sum, s) => sum + s.count, 0), [streets]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e1dfd8] bg-white p-5">
        <div>
          <h2 className="font-semibold text-[#1c2e44]">Population spread by area</h2>
          <p className="mt-1 text-sm text-[#687486]">
            Street-level counts for {verifiedOnly ? 'verified' : 'non-rejected'} applications. No individual addresses are shown.
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

      <div className="overflow-hidden rounded-2xl border border-[#e1dfd8] bg-white">
        <MapContainer center={SALAMA_CENTER} zoom={15} className="h-[520px] w-full" scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png"
            subdomains={['a', 'b', 'c']}
          />
          <Polygon positions={SALAMA_BOUNDARY} pathOptions={{ color: '#315f43', weight: 2, fillColor: '#6a9c71', fillOpacity: 0.08 }} />
          {streets.map((street) => {
            const lat = street.lat ?? SALAMA_CENTER[0] + (Math.random() - 0.5) * 0.002;
            const lng = street.lng ?? SALAMA_CENTER[1] + (Math.random() - 0.5) * 0.002;
            const r = sizeFor(street.count, maxCount);
            return (
              <CircleMarker key={street.key} center={[lat, lng]} radius={r} pathOptions={{ color: '#315f43', fillColor: '#315f43', fillOpacity: 0.7 }}>
                <Popup>
                  <div className="text-sm">
                    <div className="font-semibold">{street.label}</div>
                    <div>{street.count} {verifiedOnly ? 'verified' : 'applications'}</div>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>

      {streets.length === 0 && !stats.isLoading && (
        <div className="rounded-xl border border-dashed border-[#cfd5cd] bg-[#fbfaf6] p-5 text-sm text-[#687486]">
          No street data found yet. Add streets to the registration dropdown and applications will appear here.
        </div>
      )}
    </div>
  );
}
