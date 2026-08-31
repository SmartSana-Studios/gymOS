// Story 11.7 (Task 3): TaraMoney's confirmed mobile-money country/operator
// list, live-fetched from https://dikalosarl.mintlify.site/'s /api/mobile-pay
// docs (2026-08-30, matching this story's own pre-researched list exactly).
//
// Informational only, driving phone-input formatting/validation UX -- NEVER
// sent to TaraMoney as an API parameter. TaraMoneyProvider.initiate() already
// sends `network: ""` on every call (TaraMoneyProvider.ts:197) --
// TaraMoney auto-detects the operator from the phone number server-side
// (packages/types/src/schemas/payment.ts's own initiatePaymentSchema
// comment documents this identically for Flow A). Wiring a selected country/
// operator into initiate()/createHostedCheckoutLink()'s call bodies would be
// new, untested, unrequested behavior -- this story's Context/Dev Notes
// section re-states this explicitly as the single easiest mistake here.
export interface TaraMoneySupportedCountry {
  /** ISO 3166-1 alpha-2. */
  code: string;
  name: string;
  /** E.164 calling code, no leading '+'. */
  callingCode: string;
  /** Informational only -- never sent to TaraMoney. */
  operators: string[];
}

export const TARAMONEY_SUPPORTED_COUNTRIES: TaraMoneySupportedCountry[] = [
  { code: "BJ", name: "Benin", callingCode: "229", operators: ["MTN", "Moov"] },
  { code: "BF", name: "Burkina Faso", callingCode: "226", operators: ["Moov", "Orange"] },
  { code: "CM", name: "Cameroon", callingCode: "237", operators: ["MTN", "Orange"] },
  { code: "CG", name: "Congo-Brazzaville", callingCode: "242", operators: ["Airtel", "MTN"] },
  { code: "CD", name: "Congo-Kinshasa", callingCode: "243", operators: ["Vodacom", "Airtel", "Orange"] },
  { code: "CI", name: "Côte d'Ivoire", callingCode: "225", operators: ["MTN", "Orange", "Wave"] },
  { code: "GA", name: "Gabon", callingCode: "241", operators: ["Airtel"] },
  { code: "GH", name: "Ghana", callingCode: "233", operators: ["MTN", "AirtelTigo", "Vodafone"] },
  { code: "KE", name: "Kenya", callingCode: "254", operators: ["M-Pesa"] },
  { code: "RW", name: "Rwanda", callingCode: "250", operators: ["Airtel", "MTN"] },
  { code: "SN", name: "Senegal", callingCode: "221", operators: ["Free", "Orange", "Wave"] },
  { code: "SL", name: "Sierra Leone", callingCode: "232", operators: ["Orange"] },
  { code: "TZ", name: "Tanzania", callingCode: "255", operators: ["Airtel", "Vodacom", "Tigo", "Halotel"] },
  { code: "UG", name: "Uganda", callingCode: "256", operators: ["Airtel", "MTN"] },
  { code: "ZM", name: "Zambia", callingCode: "260", operators: [] },
];
