export const TIMEZONE_OPTIONS = [
  { value: "Africa/Douala", label: "Africa/Douala (GMT+1)" },
  { value: "Africa/Lagos", label: "Africa/Lagos (GMT+1)" },
  { value: "Africa/Bangui", label: "Africa/Bangui (GMT+1)" },
  { value: "Africa/Kinshasa", label: "Africa/Kinshasa (GMT+1)" },
  { value: "UTC", label: "UTC" },
] as const;

export const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export interface FieldErrors {
  gymName?: string;
  primaryColor?: string;
  timezone?: string;
  defaultLanguage?: string;
  country?: string;
  gracePeriodDays?: string;
  capacity?: string;
  alertAutoDismissMinutes?: string;
  checkinTimeoutHours?: string;
  openingTime?: string;
  closingTime?: string;
}

export interface SettingsFormState {
  gymName: string;
  primaryColor: string;
  timezone: string;
  defaultLanguage: string;
  country: string;
  gracePeriodDays: string;
  capacity: string;
  alertAutoDismissMinutes: string;
  checkinTimeoutHours: string;
  /** "HH:MM" or "" (not set). */
  openingTime: string;
  closingTime: string;
}
