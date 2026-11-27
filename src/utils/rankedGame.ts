import type { OfflineQuestion } from './offlineGame';

export type RankedPuzzle = {
  id: string;
  number: number;
  answerTicket?: string;
  options: string[];
  isFillIn: boolean;
  promptText: string;
  drawing: {
    path: string;
    coloredRoutes?: { path: string; color: string }[];
    raster?: string;
    basemap?: string;
    frames?: { path: string; stops: [number, number][] }[];
    arrows?: [number, number, number][];
    stops: [number, number][];
    target?: [number, number];
    terminals: { first: [number, number]; last: [number, number] }[];
    county: boolean;
  };
  remainingMs: number;
  hints: number;
  hintLimit: number;
};

export type RankedResult = {
  question: OfflineQuestion;
  number: number;
  answer: string;
  correct: boolean;
  timedOut: boolean;
  score: number;
  finished: boolean;
};
