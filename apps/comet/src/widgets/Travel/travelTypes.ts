export type Travel = {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  currency: string;
  budget: number;
  envelopeId?: string;
  finished: boolean;
};

export type TravelPlan = {
  id: string;
  travelId: string;
  kind: "plan" | "move";
  date: string;
  time?: string;
  title: string;
  place: string;
  memo: string;
  arriveDate?: string;
  arriveTime?: string;
  departZone?: string;
  arriveZone?: string;
  /** Microdegrees. */
  lat?: number;
  lng?: number;
  bookingId?: string;
};

export type BookingKind = "flight" | "train" | "bus" | "stay" | "car" | "ticket" | "food" | "other";
export type BookingStatus = "paid" | "onsite" | "unpaid";
export type Voucher = { id: string; name: string; file: string };

export type Booking = {
  id: string;
  travelId: string;
  kind: BookingKind;
  title: string;
  vendor: string;
  confirmation: string;
  status: BookingStatus;
  /** Minor units of `currency` (won and yen have none, most others hundredths). */
  amount: number;
  currency: string;
  /** Won per one unit, times 10,000. */
  rate: number;
  category: string;
  paidDate?: string;
  startDate: string;
  startTime?: string;
  startZone?: string;
  endDate?: string;
  endTime?: string;
  endZone?: string;
  place: string;
  destination: string;
  cancelDate?: string;
  cancelTime?: string;
  link: string;
  memo: string;
  vouchers: Voucher[];
};

export type Share = { person: string; weight: number };

export type Expense = {
  id: string;
  travelId: string;
  title: string;
  date: string;
  amount: number;
  currency: string;
  rate: number;
  category: string;
  paid: boolean;
  payer: string;
  shares: Share[];
  memo: string;
  bookingId?: string;
  ledgerEntryId?: string;
};

export type Person = { id: string; travelId: string; name: string; color: string };
export type Transfer = {
  id: string;
  travelId: string;
  from: string;
  to: string;
  amount: number;
  date: string;
};
export type Photo = {
  id: string;
  travelId: string;
  path: string;
  thumb?: string;
  takenAt?: string;
  date?: string;
  lat?: number;
  lng?: number;
  planId?: string;
  cover: boolean;
};
export type TravelSettings = { mapTiles: boolean; addressSearch: boolean };

export type TravelStage = "planning" | "before" | "traveling" | "wrapping" | "done";

export type TravelTab = "overview" | "schedule" | "bookings" | "costs" | "people" | "map" | "photos";

/** Everything one trip owns, already filtered from the diary state. */
export type TripData = {
  travel: Travel;
  plans: TravelPlan[];
  bookings: Booking[];
  expenses: Expense[];
  people: Person[];
  transfers: Transfer[];
  photos: Photo[];
};
