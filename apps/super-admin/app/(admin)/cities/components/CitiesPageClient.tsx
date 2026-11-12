"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mapGymToCity, type CitiesPageData, type CityRow, type UnmappedGymRow } from "../actions";
import { CityModal } from "./CityModal";

/** Story 25.1: the Cities screen. A list with a filter, an add/edit modal, and the panel of gyms that still carry only legacy text. */
export function CitiesPageClient({ data }: { data: CitiesPageData }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CityRow | null>(null);
  const [country, setCountry] = useState("");
  const [search, setSearch] = useState("");
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
    return data.cities.filter((c) => (country === "" || c.countryCode === country) && (q === "" || c.name.toLowerCase().includes(q) || c.slug.includes(q) || c.aliases.some((a) => a.toLowerCase().includes(q))));
  }, [data.cities, country, search]);

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
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">{data.cities.length === 0 ? t("cities.emptyNone") : t("cities.emptyFiltered")}</p>
        </div>
      ) : (
        <div className="divide-y rounded-md border bg-card" data-testid="city-list">
          {shown.map((city) => (
            <div key={city.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium">
                  {city.name} <span className="font-normal text-muted-foreground">{countryName(city.countryCode)}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("cities.rowDetail", { slug: city.slug, gyms: city.gymCount })}
                  {city.lat !== null && city.lng !== null ? ` · ${city.lat}, ${city.lng}` : ` · ${t("cities.noPosition")}`}
                </p>
                {city.aliases.length > 0 && <p className="text-sm text-muted-foreground">{t("cities.aliasesLine", { aliases: city.aliases.join(", ") })}</p>}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(city);
                  setModalOpen(true);
                }}
              >
                {t("cities.edit")}
              </Button>
            </div>
          ))}
        </div>
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
