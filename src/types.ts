export interface BusLine {
  id: string;
  name: string;
  path: [number, number][];
  stops: BusStop[];
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
