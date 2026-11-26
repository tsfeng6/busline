import { motion, useReducedMotion } from 'motion/react';
import { contestOutlines } from '../data/contestOutlines';
import type { ContestRegionId } from './GameLobby';

export function ContestCardOutline({ region }: { region: ContestRegionId }) {
  const reducedMotion = useReducedMotion();
  return <motion.div aria-hidden="true" layoutId={reducedMotion ? undefined : `network-${region}`}
    className="contest-card-outline">
    <svg viewBox="0 0 260 210" fill="none">
      <path d={contestOutlines[region]} stroke="white" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  </motion.div>;
}
