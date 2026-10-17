export interface BusLine {
  id: string;
  name: string;
  path: [number, number][];
  stops: BusStop[];
  start_stop?: string;
  end_stop?: string;
  via_stops?: any[];
  stime?: string;
  etime?: string;
  isUserSubmitted?: boolean;
  creatorNickname?: string;
  district?: string;
  city?: string;
  status?: string;
}

export interface BusStop {
  id: string;
  name: string;
  location: [number, number];
  lines: string[];
}

export interface LineSegment {
  id: string;
  start: [number, number];
  end: [number, number];
  lineNames: string[];
}
