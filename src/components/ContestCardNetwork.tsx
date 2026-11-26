import { motion, useReducedMotion } from 'motion/react';
import type { ContestRegionId } from './GameLobby';

const diagrams: Record<ContestRegionId, { routes: string[]; stops: [number, number][] }> = {
  beijing: {
    routes: [
      'M29 142V53Q29 45 37 45H170Q179 45 179 54V139Q179 148 170 148H41Q29 148 29 136',
      'M55 122V70Q55 64 62 64H147Q154 64 154 71V123Q154 130 147 130H62Q55 130 55 122Z',
      'M-10 96H235M101 173V3M5 167L60 111H122L165 69V18L192 -9',
      'M12 22L68 77V113L94 139H138L170 171M-8 130H39L65 104H147L205 48H245',
    ],
    stops: [[29,96],[55,96],[101,45],[101,96],[101,130],[154,64],[179,96],[68,113],[147,104]],
  },
  shanghai: {
    routes: [
      'M-5 140L45 117H87L124 79H166L231 34',
      'M2 69H61L96 99H170L230 67M28 -5L56 39V85L108 134H145L199 177',
      'M100 -9V41L81 66V111L61 136V176M203 -8L157 34V60L135 83V139L111 171',
      'M15 157L75 96L103 68H128L169 25V-5M52 3L92 34H131L159 58H223',
    ],
    stops: [[56,85],[81,111],[96,99],[124,79],[135,99],[157,34],[145,134],[100,41],[75,96]],
  },
  nationwide: {
    routes: [
      'M-8 97H49L81 65H114L160 19H223M30 173L67 136H111L150 97H228',
      'M3 33H46L81 65V101L111 136V178M114 65V100L145 131H186L227 157',
      'M44 -9L72 19H160L185 44V76L150 111V177M-7 141H34L67 108H143L185 66H225',
    ],
    stops: [[49,97],[81,65],[114,65],[160,19],[150,97],[111,136],[185,66],[67,136],[145,131]],
  },
  hebei: {
    routes: [
      'M40 176L65 147V125L99 91V63L142 24H182L225 -12',
      'M13 149H65L94 120H124L150 94V56L184 27V-8',
      'M36 176H96L126 145V124L161 89H225M-6 121H44L68 97V74L118 24V-8',
      'M27 43H67L99 73H132L151 55H215M99 91L125 111H167L211 69V34',
    ],
    stops: [[65,147],[99,91],[99,73],[142,24],[124,120],[150,94],[184,27],[68,97],[126,145]],
  },
};

export function ContestCardNetwork({ region }: { region: ContestRegionId }) {
  const reducedMotion = useReducedMotion();
  const { routes, stops } = diagrams[region];
  return <motion.div aria-hidden="true" layoutId={reducedMotion ? undefined : `network-${region}`}
    className="contest-card-network">
    <svg viewBox="0 0 225 168" preserveAspectRatio="xMidYMid slice" fill="none">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {routes.map((route, index) => <path key={route} d={route} opacity={index === 0 ? .86 : .44} strokeWidth={index === 0 ? 1.6 : 1.15} />)}
        {stops.map(([x, y]) => <circle key={`${x},${y}`} cx={x} cy={y} r="2.7" fill="#3269aa" strokeWidth="1.15" />)}
      </g>
    </svg>
  </motion.div>;
}
