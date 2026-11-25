"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TablePagination } from "@/components/TablePagination";
import { useClientPagination } from "@/hooks/use-table-pagination";
import { RowActions } from "../../support/components/RowActions";
import { mapGymToCity, type CitiesPageData, type CityRow, type UnmappedGymRow } from "../actions";
import { CityModal } from "./CityModal";

/** Story 25.1: the Cities screen. Owner decision 2026-11-25: the main towns of the Sub-Saharan target countries are seeded (0195), so this is a table to read, not a list to
 * build: country and town in alphabetical order with the number of gyms, a filter, "only towns with gyms", and the exception path (add a missing town, edit one) plus the panel of
 * gyms that still carry only legacy text. */
export function CitiesPageClient({ data }: { data: CitiesPageData }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CityRow | null>(null);
  const [country, setCountry] = useState("");
  const [search, setSearch] = useState("");
  const [withGymsOnly, setWithGymsOnly] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  const french = i18n.language.toLowerCase().startsWith("fr");
  const countryName = useMemo(() => {
    const m = new Map(data.countries.map((c) => [c.code, french ? c.nameFr : c.nameEn]));
    return (code: string) => m.get(code) ?? code;
  }, [data.countries, french]);

  const countriesWithCities = useMemo(() => [...new Set(data.cities.map((c) => c.countryCode))].sort((a, b) => countryName(a).localeCompare(countryName(b), i18n.language)), [data.cities, countryName, i18n.language]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.cities
      .filter(
        (c) =>
          (country === "" || c.countryCode === country) &&
          (!withGymsOnly || c.gymCount > 0) &&
          (q === "" || c.name.toLowerCase().includes(q) || c.slug.includes(q) || c.aliases.some((a) => a.toLowerCase().includes(q))),
      )
      .sort((x, y) => countryName(x.countryCode).localeCompare(countryName(y.countryCode), i18n.language) || x.name.localeCompare(y.name, i18n.language));
  }, [data.cities, country, search, withGymsOnly, countryName, i18n.language]);

  const pagination = useClientPagination(shown, 25);
  const withGyms = useMemo(() => data.cities.filter((c) => c.gymCount > 0).length, [data.cities]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("cities.title")}</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          {t("cities.addCity")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t("cities.intro")}</p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span>{t("cities.filterCountry")}</span>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">{t("cities.allCountries")}</option>
            {countriesWithCities.map((code) => (
              <option key={code} value={code}>
                {countryName(code)}
              </option>
            ))}
          </select>
        </label>
        <Input className="max-w-xs" aria-label={t("cities.search")} placeholder={t("cities.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withGymsOnly} onChange={(e) => setWithGymsOnly(e.target.checked)} />
          <span>{t("cities.onlyWithGyms")}</span>
        </label>
      </div>

      <p className="text-sm text-muted-foreground" data-testid="city-summary">
        {t("cities.summary", { count: data.cities.length, withGyms })}
      </p>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">{data.cities.length === 0 ? t("cities.emptyNone") : t("cities.emptyFiltered")}</p>
        </div>
      ) : (
        <>
          <TablePagination compact page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} onPageChange={pagination.onPageChange} onPageSizeChange={pagination.onPageSizeChange} />
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm" data-testid="city-list">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="p-3 font-medium">{t("cities.table.country")}</th>
                  <th className="p-3 font-medium">{t("cities.table.town")}</th>
                  <th className="p-3 text-right font-medium">{t("cities.table.gyms")}</th>
                  <th className="p-3 font-medium">{t("cities.table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {pagination.pageItems.map((city) => (
                  <tr key={city.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-3 text-muted-foreground">{countryName(city.countryCode)}</td>
                    <td className="p-3 font-medium">{city.name}</td>
                    <td className="p-3 text-right tabular-nums">{city.gymCount}</td>
                    <td className="p-3">
                      <RowActions
                        name={city.name}
                        actions={[
                          {
                            key: "edit",
                            label: t("cities.edit"),
                            icon: <Pencil size={14} />,
                            onSelect: () => {
                              setEditing(city);
                              setModalOpen(true);
                            },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} onPageChange={pagination.onPageChange} onPageSizeChange={pagination.onPageSizeChange} />
        </>
      )}

      <UnmappedPanel data={data} countryName={countryName} onMapped={() => { showToast(t("cities.unmapped.mapped")); router.refresh(); }} />

      <CityModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          showToast(t("cities.saved"));
          router.refresh();
        }}
        editing={editing}
        countries={data.countries}
        defaultCountry={country}
        language={i18n.language}
      />

      {toast && (
        <div role="status" className="fixed bottom-4 right-4 z-50 rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function UnmappedPanel({ data, countryName, onMapped }: { data: CitiesPageData; countryName: (code: string) => string; onMapped: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3" aria-labelledby="unmapped-title" data-testid="unmapped-panel">
      <h2 id="unmapped-title" className="text-lg font-semibold">
        {t("cities.unmapped.title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("cities.unmapped.intro")}</p>
      {data.unmapped.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{t("cities.unmapped.none")}</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {data.unmapped.map((g) => (
            <UnmappedRow key={g.gymId} gym={g} cities={data.cities.filter((c) => c.countryCode === g.country)} countryName={countryName} onMapped={onMapped} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UnmappedRow({ gym, cities, countryName, onMapped }: { gym: UnmappedGymRow; cities: CityRow[]; countryName: (code: string) => string; onMapped: () => void }) {
  const { t } = useTranslation();
  const [cityId, setCityId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function map() {
    if (cityId === "") return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await mapGymToCity({ gymId: gym.gymId, country: gym.country, cityId });
      if (err) setError(err.message);
      else onMapped();
    } catch {
      setError(t("common.somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="font-medium">{gym.gymName}</p>
        <p className="text-sm text-muted-foreground">{t("cities.unmapped.detail", { country: countryName(gym.country), text: gym.legacyCity })}</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
      <div className="flex items-center gap-2">
        <select aria-label={t("cities.unmapped.pick", { gym: gym.gymName })} className="h-9 rounded-md border bg-background px-3 text-sm" value={cityId} onChange={(e) => setCityId(e.target.value)} disabled={busy}>
          <option value="">{cities.length === 0 ? t("cities.unmapped.noCities") : t("cities.unmapped.choose")}</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" disabled={busy || cityId === ""} onClick={() => void map()}>
          {busy ? t("common.saving") : t("cities.unmapped.map")}
        </Button>
      </div>
    </li>
  );
}
