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
};

export type TravelStage = "planning" | "before" | "traveling" | "wrapping" | "done";

export type TravelTab = "overview" | "schedule";
