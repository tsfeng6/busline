import type { OfflineQuestion } from './offlineGame';

export type RankedPuzzle = {
  id: string;
  number: number;
  options: string[];
  isFillIn: boolean;
  promptText: string;
  drawing: {
    path: string;
    stops: [number, number][];
    target?: [number, number];
    terminals: { first: [number, number]; last: [number, number] }[];
    county: boolean;
  };
  remainingMs: number;
  hints: number;
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
